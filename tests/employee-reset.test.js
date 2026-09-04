'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { allocateEmployeeCode, migrateMasterdata } = require('../lib/masterdata');
const { migrateRosterData } = require('../lib/roster-data');
const { purgeEmployeeData } = require('../lib/employee-reset');

function database() {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

test('employee reset leegt werknemersdata maar bewaart accounts, locaties en roosterstructuur', async () => {
    const db = database();
    try {
        await migrateMasterdata(db);
        await migrateRosterData(db);

        const user = await run(db, `INSERT INTO users (username, display_name, password_hash, role, is_active)
            VALUES ('reset-admin', 'Reset Admin', 'x', 'admin', 1)`);
        const ave = await get(db, "SELECT id FROM locations WHERE code='AVE'");
        await run(db, `INSERT INTO user_location_scopes
            (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            VALUES (?, ?, 0, 0, '2026-09-01')`, [user.lastID, ave.id]);

        const employee = await run(db, `INSERT INTO employees (employee_code, display_name)
            VALUES ('EMP-0042', 'Reset Test')`);
        const employment = await run(db, `INSERT INTO employment_periods
            (employee_id, employment_type, starts_on, known_from)
            VALUES (?, 'contract', '2026-09-01', '2026-09-01')`, [employee.lastID]);
        await run(db, `INSERT INTO contract_terms
            (employment_period_id, effective_from, weekly_minutes)
            VALUES (?, '2026-09-01', 1920)`, [employment.lastID]);
        await run(db, `INSERT INTO employee_location_eligibility
            (employee_id, location_id, effective_from, is_primary, can_be_scheduled)
            VALUES (?, ?, '2026-09-01', 1, 1)`, [employee.lastID, ave.id]);
        await run(db, `INSERT INTO user_employee_links (user_id, employee_id)
            VALUES (?, ?)`, [user.lastID, employee.lastID]);
        await run(db, `INSERT INTO employee_availability_patterns
            (employee_id, weekday, slot_code, availability_state, effective_from)
            VALUES (?, 1, 'EVENING', 'available', '2026-09-01')`, [employee.lastID]);
        await run(db, `INSERT INTO employee_availability_exceptions
            (employee_id, availability_date, slot_code, availability_state)
            VALUES (?, '2026-09-14', 'EVENING', 'unavailable')`, [employee.lastID]);

        const pattern = await run(db, `INSERT INTO roster_patterns
            (pattern_uid, employee_id, location_id, shift_type, weekday, start_time, end_time,
             anchor_week_start, effective_from)
            VALUES ('RESET-PATTERN', ?, ?, 'floor', 1, '18:30', '21:00', '2026-09-14', '2026-09-14')`,
        [employee.lastID, ave.id]);
        const period = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
            VALUES (?, '2026-09-14', '2026-09-20')`, [ave.id]);
        const version = await run(db, `INSERT INTO roster_versions (period_id, version_no, state)
            VALUES (?, 1, 'draft')`, [period.lastID]);
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc,
             shift_type, source_pattern_id, source_pattern_revision)
            VALUES ('RESET-SHIFT', ?, ?, ?, '2026-09-14T16:30:00Z', '2026-09-14T19:00:00Z',
                    'floor', ?, 1)`, [version.lastID, employee.lastID, ave.id, pattern.lastID]);
        await run(db, `UPDATE roster_versions SET state='published', published_at=CURRENT_TIMESTAMP WHERE id=?`, [version.lastID]);

        await run(db, `CREATE TABLE hour_employee_settings (
            employee_name TEXT PRIMARY KEY COLLATE NOCASE,
            contract_type TEXT NOT NULL,
            weekly_contract_hours REAL NOT NULL,
            opening_bank_hours REAL NOT NULL,
            opening_bank_month TEXT NOT NULL,
            active_from TEXT NOT NULL,
            is_active INTEGER NOT NULL
        )`);
        await run(db, `CREATE TABLE hour_contract_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT NOT NULL COLLATE NOCASE,
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            weekly_hours REAL NOT NULL,
            created_by TEXT NOT NULL,
            FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name) ON DELETE CASCADE
        )`);
        await run(db, `CREATE TABLE hour_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT NOT NULL COLLATE NOCASE,
            adjustment_date TEXT NOT NULL,
            adjustment_type TEXT NOT NULL,
            hours REAL NOT NULL,
            created_by TEXT NOT NULL,
            FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name) ON DELETE CASCADE
        )`);
        await run(db, `INSERT INTO hour_employee_settings
            VALUES ('Reset Test', 'contract', 32, 0, '2026-09', '2026-09-01', 1)`);
        await run(db, `INSERT INTO hour_contract_periods
            (employee_name, effective_from, weekly_hours, created_by)
            VALUES ('Reset Test', '2026-09-01', 32, 'test')`);
        await run(db, `INSERT INTO hour_adjustments
            (employee_name, adjustment_date, adjustment_type, hours, created_by)
            VALUES ('Reset Test', '2026-09-14', 'credited', 1, 'test')`);

        await run(db, `CREATE TABLE excel_hour_periods (
            period_key TEXT PRIMARY KEY, sheet_name TEXT NOT NULL, date_count INTEGER NOT NULL,
            week_count REAL NOT NULL, issues_json TEXT NOT NULL DEFAULT '[]'
        )`);
        await run(db, `CREATE TABLE excel_hour_summaries (
            period_key TEXT NOT NULL, employee_name TEXT NOT NULL COLLATE NOCASE,
            PRIMARY KEY (period_key, employee_name)
        )`);
        await run(db, `CREATE TABLE excel_hour_overrides (
            period_key TEXT NOT NULL, employee_name TEXT NOT NULL COLLATE NOCASE,
            PRIMARY KEY (period_key, employee_name)
        )`);
        await run(db, `INSERT INTO excel_hour_periods VALUES ('2026-09', 'Sep 26', 28, 4, '[]')`);
        await run(db, `INSERT INTO excel_hour_summaries VALUES ('2026-09', 'Reset Test')`);
        await run(db, `INSERT INTO excel_hour_overrides VALUES ('2026-09', 'Reset Test')`);
        await run(db, `INSERT INTO legacy_employee_aliases
            (alias_name, canonical_name, canonical_from) VALUES ('Oude Reset', 'Reset Test', '2026-09-01')`);
        await run(db, `INSERT INTO masterdata_access_seeds
            (principal_name, target_role, location_code) VALUES ('Reset Test', 'manager', 'AVE')`);

        const result = await purgeEmployeeData(db);

        assert.equal(result.before.employees, 1);
        assert.equal(result.after.employees, 0);
        assert.equal(result.detachedRosterShifts, 1);
        assert.equal(result.deletedRosterPatterns, 1);

        for (const table of [
            'employees', 'employment_periods', 'contract_terms', 'employee_location_eligibility',
            'user_employee_links', 'employee_availability_patterns', 'employee_availability_exceptions',
            'hour_employee_settings', 'hour_contract_periods', 'hour_adjustments',
            'excel_hour_periods', 'excel_hour_summaries', 'excel_hour_overrides',
            'legacy_employee_aliases', 'masterdata_access_seeds'
        ]) {
            assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM ${table}`)).count), 0, table);
        }

        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM users')).count), 1);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM locations')).count), 5);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM user_location_scopes')).count), 1);
        assert.deepEqual(await get(db, `SELECT employee_id AS employeeId, source_pattern_id AS sourcePatternId
            FROM roster_shifts WHERE shift_uid='RESET-SHIFT'`), { employeeId: null, sourcePatternId: null });
        assert.equal((await get(db, `SELECT state FROM roster_versions WHERE id=?`, [version.lastID])).state, 'published');
        assert.ok(await get(db, `SELECT 1 AS present FROM sqlite_master
            WHERE type='trigger' AND name='roster_shifts_no_update_published'`));
        assert.deepEqual(await all(db, 'PRAGMA foreign_key_check'), []);
        assert.equal(await allocateEmployeeCode(db), 'EMP-0001');
    } finally {
        await close(db);
    }
});
