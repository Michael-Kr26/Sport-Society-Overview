'use strict';

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
}

function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (error) => error ? reject(error) : resolve());
    });
}

async function tableExists(db, tableName) {
    return Boolean(await get(db, "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [tableName]));
}

async function deleteAll(db, tableName, result) {
    if (!await tableExists(db, tableName)) return 0;
    const deleted = await run(db, `DELETE FROM ${tableName}`);
    result.deleted[tableName] = Number(deleted.changes || 0);
    return Number(deleted.changes || 0);
}

async function countRows(db, tableName) {
    if (!await tableExists(db, tableName)) return null;
    return Number((await get(db, `SELECT COUNT(*) AS count FROM ${tableName}`))?.count || 0);
}

async function purgeEmployeeData(db) {
    if (!await tableExists(db, 'employees')) {
        throw new Error('employees-tabel ontbreekt; dit lijkt niet op een geïnitialiseerde Sport Society database.');
    }

    await exec(db, 'PRAGMA foreign_keys = ON;');

    const result = {
        before: {
            employees: await countRows(db, 'employees'),
            hourEmployees: await countRows(db, 'hour_employee_settings'),
            excelHourSummaries: await countRows(db, 'excel_hour_summaries')
        },
        deleted: {},
        detachedRosterShifts: 0,
        deletedRosterPatterns: 0,
        employeeCodeSequenceReset: false
    };

    const publishedShiftTrigger = await get(db, `SELECT sql FROM sqlite_master
        WHERE type='trigger' AND name='roster_shifts_no_update_published'`);

    await run(db, 'BEGIN IMMEDIATE');
    try {
        // Een employee reset mag published roosterhistorie niet verwijderen. We halen alleen
        // de employee-koppeling weg. De immutable-update-trigger moet daarvoor tijdelijk uit.
        if (publishedShiftTrigger?.sql) {
            await exec(db, 'DROP TRIGGER IF EXISTS roster_shifts_no_update_published;');
        }

        if (await tableExists(db, 'roster_patterns')) {
            const patterns = await run(db, 'DELETE FROM roster_patterns WHERE employee_id IS NOT NULL');
            result.deletedRosterPatterns = Number(patterns.changes || 0);
        }
        if (await tableExists(db, 'roster_shifts')) {
            const shifts = await run(db, 'UPDATE roster_shifts SET employee_id=NULL WHERE employee_id IS NOT NULL');
            result.detachedRosterShifts = Number(shifts.changes || 0);
        }

        // Legacy uren-/Exceladministratie is onderdeel van de werknemersadministratie en
        // wordt eveneens geleegd, zodat de Medewerkers-pagina niet via oude bronnen terugvult.
        for (const table of [
            'excel_hour_overrides',
            'excel_hour_summaries',
            'excel_hour_periods',
            'hour_adjustments',
            'hour_contract_periods',
            'hour_employee_settings',
            'hour_seed_state'
        ]) {
            await deleteAll(db, table, result);
        }

        // Canonieke employee-afhankelijke masterdata.
        for (const table of [
            'employee_availability_exceptions',
            'employee_availability_patterns',
            'user_employee_links',
            'employee_location_eligibility',
            'contract_terms',
            'employment_periods',
            'legacy_employee_aliases',
            'masterdata_access_seeds'
        ]) {
            await deleteAll(db, table, result);
        }

        await deleteAll(db, 'employees', result);

        if (await tableExists(db, 'employee_code_sequence')) {
            await run(db, 'UPDATE employee_code_sequence SET next_value=1 WHERE id=1');
            result.employeeCodeSequenceReset = true;
        }

        // AUTOINCREMENT-sequences van uitsluitend employee-gerelateerde tabellen terugzetten.
        if (await tableExists(db, 'sqlite_sequence')) {
            const sequenceTables = [
                'employees',
                'employment_periods',
                'contract_terms',
                'employee_location_eligibility',
                'employee_availability_patterns',
                'employee_availability_exceptions',
                'hour_contract_periods',
                'hour_adjustments'
            ];
            for (const tableName of sequenceTables) {
                await run(db, 'DELETE FROM sqlite_sequence WHERE name=?', [tableName]);
            }
        }

        if (publishedShiftTrigger?.sql) await exec(db, `${publishedShiftTrigger.sql};`);

        const foreignKeyProblems = await all(db, 'PRAGMA foreign_key_check');
        if (foreignKeyProblems.length) {
            throw new Error(`Employee reset zou ${foreignKeyProblems.length} foreign-keyfout(en) achterlaten.`);
        }

        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        // Een DROP TRIGGER binnen de mislukte transactie wordt door SQLite eveneens teruggedraaid.
        throw error;
    }

    result.after = {
        employees: await countRows(db, 'employees'),
        hourEmployees: await countRows(db, 'hour_employee_settings'),
        excelHourSummaries: await countRows(db, 'excel_hour_summaries')
    };
    return result;
}

module.exports = {
    purgeEmployeeData
};
