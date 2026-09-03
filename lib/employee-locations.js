'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function requestError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function amsterdamToday() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date()).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeEmployeeId(value) {
    const employeeId = Number(value);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw requestError(400, 'Ongeldige medewerker.', 'INVALID_EMPLOYEE');
    }
    return employeeId;
}

function normalizeLocationCodes(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

async function listEmployeeLocations(db, employeeId, effectiveDate = amsterdamToday()) {
    if (!db) throw new TypeError('db is verplicht');
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    if (!DATE_RE.test(String(effectiveDate || ''))) {
        throw requestError(400, 'Ongeldige ingangsdatum.', 'INVALID_EFFECTIVE_DATE');
    }

    const employee = await get(db, `SELECT id, employee_code AS employeeCode, display_name AS employeeName
        FROM employees WHERE id=? AND archived_at IS NULL`, [normalizedEmployeeId]);
    if (!employee) throw requestError(404, 'Medewerker niet gevonden.', 'EMPLOYEE_NOT_FOUND');

    const locations = await all(db, `SELECT id, code, name, sort_order AS sortOrder
        FROM locations WHERE is_active=1 ORDER BY sort_order, name`);
    const eligibility = await all(db, `SELECT l.code, l.name, el.is_primary AS isPrimary,
            el.can_be_scheduled AS canBeScheduled, el.effective_from AS effectiveFrom,
            el.effective_to AS effectiveTo
        FROM employee_location_eligibility el
        INNER JOIN locations l ON l.id=el.location_id
        WHERE el.employee_id=?
          AND date(el.effective_from)<=date(?)
          AND (el.effective_to IS NULL OR date(el.effective_to)>=date(?))
        ORDER BY el.is_primary DESC, l.sort_order, l.name`,
    [normalizedEmployeeId, effectiveDate, effectiveDate]);

    const schedulable = eligibility.filter((row) => Number(row.canBeScheduled) === 1);
    const primary = schedulable.find((row) => Number(row.isPrimary) === 1) || null;
    return {
        employee,
        effectiveDate,
        primaryLocationCode: primary?.code || null,
        eligibleLocationCodes: schedulable.map((row) => row.code),
        locations: locations.map((location) => ({
            id: location.id,
            code: location.code,
            name: location.name,
            sortOrder: Number(location.sortOrder || 0)
        }))
    };
}

async function replaceEmployeeLocations(db, {
    employeeId,
    primaryLocationCode,
    eligibleLocationCodes,
    effectiveFrom = amsterdamToday(),
    note = 'Gewijzigd via Medewerkerinstellingen'
} = {}) {
    if (!db) throw new TypeError('db is verplicht');
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);
    const primaryCode = String(primaryLocationCode || '').trim().toUpperCase();
    const eligibleCodes = normalizeLocationCodes(eligibleLocationCodes);

    if (!DATE_RE.test(String(effectiveFrom || ''))) {
        throw requestError(400, 'Ongeldige ingangsdatum.', 'INVALID_EFFECTIVE_DATE');
    }
    if (!primaryCode) throw requestError(400, 'Kies een primaire locatie.', 'PRIMARY_LOCATION_REQUIRED');
    if (!eligibleCodes.length) throw requestError(400, 'Kies minimaal één inzetbare locatie.', 'ELIGIBLE_LOCATION_REQUIRED');
    if (!eligibleCodes.includes(primaryCode)) {
        throw requestError(400, 'De primaire locatie moet ook als inzetbare locatie zijn geselecteerd.', 'PRIMARY_NOT_ELIGIBLE');
    }

    const employee = await get(db, 'SELECT id FROM employees WHERE id=? AND archived_at IS NULL', [normalizedEmployeeId]);
    if (!employee) throw requestError(404, 'Medewerker niet gevonden.', 'EMPLOYEE_NOT_FOUND');

    const locations = await all(db, `SELECT id, code, name FROM locations WHERE is_active=1`);
    const byCode = new Map(locations.map((location) => [String(location.code).toUpperCase(), location]));
    const invalidCodes = eligibleCodes.filter((code) => !byCode.has(code));
    if (invalidCodes.length || !byCode.has(primaryCode)) {
        throw requestError(400, 'Eén of meer gekozen locaties bestaan niet.', 'LOCATION_NOT_FOUND');
    }

    await run(db, 'BEGIN IMMEDIATE');
    try {
        // De nieuwe configuratie vervangt alles vanaf de gekozen ingangsdatum,
        // maar laat de historie vóór die datum intact.
        await run(db, `DELETE FROM employee_location_eligibility
            WHERE employee_id=? AND date(effective_from)>=date(?)`,
        [normalizedEmployeeId, effectiveFrom]);
        await run(db, `UPDATE employee_location_eligibility
            SET effective_to=date(?, '-1 day')
            WHERE employee_id=?
              AND date(effective_from)<date(?)
              AND (effective_to IS NULL OR date(effective_to)>=date(?))`,
        [effectiveFrom, normalizedEmployeeId, effectiveFrom, effectiveFrom]);

        for (const code of eligibleCodes) {
            const location = byCode.get(code);
            await run(db, `INSERT INTO employee_location_eligibility
                (employee_id, location_id, effective_from, effective_to, is_primary, can_be_scheduled, note)
                VALUES (?, ?, ?, NULL, ?, 1, ?)`,
            [normalizedEmployeeId, location.id, effectiveFrom, code === primaryCode ? 1 : 0, String(note || '').slice(0, 500)]);
        }
        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    }

    return listEmployeeLocations(db, normalizedEmployeeId, effectiveFrom);
}

module.exports = {
    amsterdamToday,
    listEmployeeLocations,
    replaceEmployeeLocations
};
