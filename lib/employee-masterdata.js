'use strict';

const { allocateEmployeeCode, normalizeIdentity } = require('./masterdata');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMPLOYMENT_TYPES = new Set(['contract', 'flex', 'unknown']);

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

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function amsterdamToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function cleanName(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function findEmployeeByName(db, displayName) {
    const key = normalizeIdentity(displayName);
    if (!key) return null;
    const employees = await all(db, `SELECT id, employee_code AS employeeCode, display_name AS displayName,
        archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt
        FROM employees`);
    return employees.find((employee) => normalizeIdentity(employee.displayName) === key) || null;
}

async function createEmployee(db, input = {}) {
    const displayName = cleanName(input.displayName);
    const employmentType = String(input.employmentType || 'flex').trim().toLowerCase();
    const startsOn = String(input.startsOn || '').trim() || null;
    const endsOn = String(input.endsOn || '').trim() || null;
    const weeklyHours = Number(input.weeklyHours ?? 0);
    const actorUserId = Number.isInteger(Number(input.actorUserId)) ? Number(input.actorUserId) : null;

    if (!displayName || displayName.length > 120) {
        throw requestError(400, 'INVALID_EMPLOYEE_NAME', 'Vul een geldige medewerkernaam in.');
    }
    if (!EMPLOYMENT_TYPES.has(employmentType)) {
        throw requestError(400, 'INVALID_EMPLOYMENT_TYPE', 'Kies een geldig dienstverbandtype.');
    }
    if (startsOn && !DATE_RE.test(startsOn)) {
        throw requestError(400, 'INVALID_START_DATE', 'Vul een geldige startdatum in.');
    }
    if (endsOn && !DATE_RE.test(endsOn)) {
        throw requestError(400, 'INVALID_END_DATE', 'Vul een geldige einddatum in.');
    }
    if (startsOn && endsOn && endsOn < startsOn) {
        throw requestError(400, 'INVALID_EMPLOYMENT_RANGE', 'De einddatum mag niet vóór de startdatum liggen.');
    }
    if (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 60) {
        throw requestError(400, 'INVALID_WEEKLY_HOURS', 'Contracturen moeten tussen 0 en 60 uur per week liggen.');
    }
    if (employmentType === 'contract' && weeklyHours <= 0) {
        throw requestError(400, 'CONTRACT_HOURS_REQUIRED', 'Vul voor een contractmedewerker contracturen in.');
    }

    const existing = await findEmployeeByName(db, displayName);
    if (existing) return { created: false, employee: existing };

    const employeeCode = await allocateEmployeeCode(db);
    await run(db, 'BEGIN IMMEDIATE');
    try {
        const duplicate = await findEmployeeByName(db, displayName);
        if (duplicate) {
            await run(db, 'COMMIT');
            return { created: false, employee: duplicate };
        }
        const inserted = await run(db, `INSERT INTO employees (employee_code, display_name)
            VALUES (?, ?)`, [employeeCode, displayName]);
        const employeeId = inserted.lastID;
        const knownFrom = amsterdamToday();
        const period = await run(db, `INSERT INTO employment_periods
            (employee_id, employment_type, starts_on, ends_on, known_from, note)
            VALUES (?, ?, ?, ?, ?, ?)`, [
            employeeId,
            employmentType,
            startsOn,
            endsOn,
            knownFrom,
            'Handmatig aangemaakt via Medewerkers'
        ]);
        if (employmentType === 'contract') {
            await run(db, `INSERT INTO contract_terms
                (employment_period_id, effective_from, effective_to, weekly_minutes, note, created_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?)`, [
                period.lastID,
                startsOn || knownFrom,
                endsOn,
                Math.round(weeklyHours * 60),
                'Initiële contractomvang via Medewerkers',
                actorUserId
            ]);
        }
        await run(db, 'COMMIT');
        return {
            created: true,
            employee: {
                id: employeeId,
                employeeId,
                employeeCode,
                displayName,
                employeeName: displayName,
                archivedAt: null
            }
        };
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    }
}

async function listEmployees(db, effectiveDate = amsterdamToday()) {
    const date = DATE_RE.test(String(effectiveDate || '')) ? String(effectiveDate) : amsterdamToday();
    const employees = await all(db, `SELECT id AS employeeId, employee_code AS employeeCode,
        display_name AS employeeName, archived_at AS archivedAt, created_at AS createdAt,
        updated_at AS updatedAt
        FROM employees ORDER BY archived_at IS NOT NULL, LOWER(display_name), id`);
    const eligibility = await all(db, `SELECT el.employee_id AS employeeId, l.code AS locationCode,
        l.name AS locationName, el.is_primary AS isPrimary, el.can_be_scheduled AS canBeScheduled
        FROM employee_location_eligibility el
        INNER JOIN locations l ON l.id=el.location_id
        WHERE date(el.effective_from) <= date(?)
          AND (el.effective_to IS NULL OR date(el.effective_to) >= date(?))
          AND l.is_active=1
        ORDER BY el.employee_id, el.is_primary DESC, l.sort_order, l.name`, [date, date]);
    const byEmployee = new Map();
    for (const row of eligibility) {
        if (!byEmployee.has(row.employeeId)) byEmployee.set(row.employeeId, []);
        byEmployee.get(row.employeeId).push(row);
    }
    return employees.map((employee) => {
        const rows = byEmployee.get(employee.employeeId) || [];
        return {
            ...employee,
            primaryLocationCode: rows.find((row) => Number(row.isPrimary) === 1)?.locationCode || null,
            eligibleLocationCodes: rows.filter((row) => Number(row.canBeScheduled) === 1).map((row) => row.locationCode),
            locations: rows.filter((row) => Number(row.canBeScheduled) === 1).map((row) => row.locationName)
        };
    });
}

module.exports = {
    amsterdamToday,
    createEmployee,
    findEmployeeByName,
    listEmployees
};
