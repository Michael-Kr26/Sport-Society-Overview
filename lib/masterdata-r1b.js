'use strict';

// R1B is retired from production. It remains only as an in-memory fixture bridge
// for the historic R1-R9 regression tests. The employee dataset itself lives under
// tests/fixtures and can never be applied to a persistent database.
const {
    PLANNING_BASELINE,
    allocateEmployeeCode,
    migrateMasterdata,
    normalizeIdentity
} = require('./masterdata');
const fixture = require('../tests/fixtures/employee-baseline.json');

const EMPLOYEE_BASELINE = Object.freeze(fixture.map((item) => Object.freeze({ ...item })));

function assertInMemoryFixtureDatabase(db) {
    if (db?.filename !== ':memory:') {
        const error = new Error('R1B medewerkerbaseline is test-only en mag niet op een persistente database worden toegepast.');
        error.code = 'R1B_RETIRED';
        throw error;
    }
}

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

function identityKeys(seed) {
    return new Set([seed.displayName, seed.sourceName].map(normalizeIdentity).filter(Boolean));
}

function validateEmployeeBaseline() {
    const names = new Set();
    const allowedLocations = new Set(['AVE', 'BVE', 'VHU', 'WEK', 'HAR']);
    const allowedRoles = new Set(['employee', 'manager', 'admin']);
    for (const seed of EMPLOYEE_BASELINE) {
        const key = normalizeIdentity(seed.displayName);
        if (!key || names.has(key)) throw new Error(`Dubbele of lege testmedewerker: ${seed.displayName}`);
        names.add(key);
        if (!['contract', 'flex'].includes(seed.employmentType)) throw new Error(`Ongeldig testdienstverband voor ${seed.displayName}.`);
        if (!Number.isInteger(seed.weeklyMinutes) || seed.weeklyMinutes < 0) throw new Error(`Ongeldige testcontractminuten voor ${seed.displayName}.`);
        if (!allowedRoles.has(seed.targetRole)) throw new Error(`Ongeldige testrol voor ${seed.displayName}.`);
        if (!seed.eligibleLocationCodes.includes(seed.primaryLocationCode)) throw new Error(`Primaire testlocatie ontbreekt voor ${seed.displayName}.`);
        if (new Set(seed.eligibleLocationCodes).size !== seed.eligibleLocationCodes.length) throw new Error(`Dubbele testlocatie voor ${seed.displayName}.`);
        if (seed.eligibleLocationCodes.some((code) => !allowedLocations.has(code))) throw new Error(`Onbekende testlocatie voor ${seed.displayName}.`);
    }
}

async function createEmployee(db, displayName) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const employeeCode = await allocateEmployeeCode(db);
        try {
            const inserted = await run(db, `INSERT INTO employees (employee_code, display_name) VALUES (?, ?)`, [employeeCode, displayName]);
            return { id: inserted.lastID, employeeCode, displayName };
        } catch (error) {
            if (String(error.message).includes('employees.employee_code')) continue;
            throw error;
        }
    }
    throw new Error(`Kon geen vrije test-employee-code reserveren voor ${displayName}.`);
}

async function ensureEmployee(db, seed, result) {
    const candidates = (await all(db, 'SELECT id, employee_code AS employeeCode, display_name AS displayName FROM employees'))
        .filter((employee) => identityKeys(seed).has(normalizeIdentity(employee.displayName)));
    if (candidates.length > 1) throw new Error(`Meerdere testrecords passen op ${seed.displayName}.`);
    if (!candidates.length) {
        const employee = await createEmployee(db, seed.displayName);
        result.createdEmployees.push(employee.displayName);
        return employee;
    }
    const employee = candidates[0];
    if (employee.displayName !== seed.displayName) {
        await run(db, 'UPDATE employees SET display_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [seed.displayName, employee.id]);
        result.normalizedNames.push({ from: employee.displayName, to: seed.displayName });
        employee.displayName = seed.displayName;
    }
    return employee;
}

async function ensureEmploymentPeriod(db, employee, seed, result) {
    const existing = await get(db, `SELECT id, employment_type AS employmentType
        FROM employment_periods WHERE employee_id=? AND known_from=? ORDER BY id LIMIT 1`,
    [employee.id, PLANNING_BASELINE]);
    if (existing) return existing;
    const inserted = await run(db, `INSERT INTO employment_periods
        (employee_id, employment_type, starts_on, ends_on, known_from, note)
        VALUES (?, ?, NULL, NULL, ?, 'Testfixture R1B')`,
    [employee.id, seed.employmentType, PLANNING_BASELINE]);
    result.createdEmploymentPeriods.push(seed.displayName);
    return { id: inserted.lastID, employmentType: seed.employmentType };
}

async function ensureContractTerm(db, period, seed, result) {
    const existing = await get(db, `SELECT id, weekly_minutes AS weeklyMinutes
        FROM contract_terms WHERE employment_period_id=? AND effective_from=?`, [period.id, PLANNING_BASELINE]);
    if (existing) return existing;
    const inserted = await run(db, `INSERT INTO contract_terms
        (employment_period_id, effective_from, effective_to, weekly_minutes, note)
        VALUES (?, ?, NULL, ?, 'Testfixture R1B')`, [period.id, PLANNING_BASELINE, seed.weeklyMinutes]);
    result.createdContractTerms.push(seed.displayName);
    return { id: inserted.lastID, weeklyMinutes: seed.weeklyMinutes };
}

async function ensureEligibility(db, employee, seed, locations, result) {
    for (const locationCode of seed.eligibleLocationCodes) {
        const location = locations.get(locationCode);
        if (!location) throw new Error(`Testlocatie ${locationCode} ontbreekt.`);
        const isPrimary = locationCode === seed.primaryLocationCode ? 1 : 0;
        const existing = await get(db, `SELECT id FROM employee_location_eligibility
            WHERE employee_id=? AND location_id=? AND effective_from=?`,
        [employee.id, location.id, PLANNING_BASELINE]);
        if (existing) continue;
        await run(db, `INSERT INTO employee_location_eligibility
            (employee_id, location_id, effective_from, effective_to, is_primary, can_be_scheduled, note)
            VALUES (?, ?, ?, NULL, ?, 1, 'Testfixture R1B')`,
        [employee.id, location.id, PLANNING_BASELINE, isPrimary]);
        result.createdEligibility.push({ employee: seed.displayName, locationCode, isPrimary: Boolean(isPrimary) });
    }
}

async function seedEmployeeBaseline(db) {
    assertInMemoryFixtureDatabase(db);
    validateEmployeeBaseline();
    const result = {
        createdEmployees: [],
        normalizedNames: [],
        createdEmploymentPeriods: [],
        createdContractTerms: [],
        createdEligibility: [],
        dataMismatches: []
    };
    const locations = new Map((await all(db, 'SELECT id, code FROM locations')).map((location) => [location.code, location]));
    for (const seed of EMPLOYEE_BASELINE) {
        const employee = await ensureEmployee(db, seed, result);
        const period = await ensureEmploymentPeriod(db, employee, seed, result);
        await ensureContractTerm(db, period, seed, result);
        await ensureEligibility(db, employee, seed, locations, result);
    }
    return result;
}

async function applyEmployeeAccountLinks(db) {
    assertInMemoryFixtureDatabase(db);
    const result = { linked: [], unresolved: [], ambiguous: [], conflicts: [], roleMismatches: [] };
    const users = await all(db, `SELECT id, username, display_name AS displayName, role FROM users WHERE is_active=1`);
    const employees = await all(db, 'SELECT id, employee_code AS employeeCode, display_name AS displayName FROM employees');
    const employeeByIdentity = new Map(employees.map((employee) => [normalizeIdentity(employee.displayName), employee]));
    const identityToUsers = new Map();
    for (const user of users) {
        for (const value of [user.displayName, user.username]) {
            const key = normalizeIdentity(value);
            if (!key) continue;
            if (!identityToUsers.has(key)) identityToUsers.set(key, new Map());
            identityToUsers.get(key).set(user.id, user);
        }
    }

    for (const seed of EMPLOYEE_BASELINE) {
        const employee = employeeByIdentity.get(normalizeIdentity(seed.displayName));
        if (!employee) continue;
        const candidates = new Map();
        for (const key of identityKeys(seed)) {
            for (const [id, user] of identityToUsers.get(key) || []) candidates.set(id, user);
        }
        if (!candidates.size) {
            result.unresolved.push({ employee: seed.displayName, reason: 'geen testaccount gevonden' });
            continue;
        }
        if (candidates.size > 1) {
            result.ambiguous.push({ employee: seed.displayName, userIds: [...candidates.keys()] });
            continue;
        }
        const user = [...candidates.values()][0];
        const existingLinks = await all(db, 'SELECT user_id AS userId, employee_id AS employeeId FROM user_employee_links WHERE user_id=? OR employee_id=?', [user.id, employee.id]);
        const conflicting = existingLinks.find((link) => link.userId !== user.id || link.employeeId !== employee.id);
        if (conflicting) {
            result.conflicts.push({ employee: seed.displayName, userId: user.id, existing: conflicting });
            continue;
        }
        if (!existingLinks.length) {
            await run(db, 'INSERT INTO user_employee_links (user_id, employee_id, linked_by_user_id) VALUES (?, ?, NULL)', [user.id, employee.id]);
        }
        result.linked.push({ employee: seed.displayName, employeeCode: employee.employeeCode, userId: user.id, role: user.role });
        if (user.role !== seed.targetRole) {
            result.roleMismatches.push({ employee: seed.displayName, userId: user.id, currentRole: user.role, targetRole: seed.targetRole });
        }
        if (user.role === 'manager' && seed.targetRole === 'manager') {
            const location = await get(db, 'SELECT id FROM locations WHERE code=? COLLATE NOCASE', [seed.primaryLocationCode]);
            if (location) {
                await run(db, `INSERT INTO user_location_scopes
                    (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
                    VALUES (?, ?, 1, 0, ?)
                    ON CONFLICT(user_id, location_id, effective_from) DO UPDATE SET can_edit_roster=1`,
                [user.id, location.id, PLANNING_BASELINE]);
            }
        }
    }
    return result;
}

async function employeeBaselineReport(db) {
    assertInMemoryFixtureDatabase(db);
    const rows = [];
    for (const seed of EMPLOYEE_BASELINE) {
        const employee = await get(db, `SELECT id, employee_code AS employeeCode, display_name AS displayName FROM employees WHERE display_name=? COLLATE NOCASE`, [seed.displayName]);
        if (!employee) {
            rows.push({ ...seed, present: false });
            continue;
        }
        const period = await get(db, `SELECT id, employment_type AS employmentType, starts_on AS startsOn, known_from AS knownFrom
            FROM employment_periods WHERE employee_id=? AND known_from=? ORDER BY id LIMIT 1`, [employee.id, PLANNING_BASELINE]);
        const term = period ? await get(db, `SELECT weekly_minutes AS weeklyMinutes FROM contract_terms WHERE employment_period_id=? AND effective_from=?`, [period.id, PLANNING_BASELINE]) : null;
        const eligibility = await all(db, `SELECT l.code AS locationCode, el.is_primary AS isPrimary
            FROM employee_location_eligibility el JOIN locations l ON l.id=el.location_id
            WHERE el.employee_id=? AND el.effective_from=? AND el.can_be_scheduled=1
            ORDER BY el.is_primary DESC, l.sort_order`, [employee.id, PLANNING_BASELINE]);
        const account = await get(db, `SELECT u.id AS userId, u.username, u.role FROM user_employee_links link JOIN users u ON u.id=link.user_id WHERE link.employee_id=?`, [employee.id]);
        rows.push({
            present: true,
            employeeCode: employee.employeeCode,
            displayName: employee.displayName,
            employmentType: period?.employmentType || null,
            startsOn: period?.startsOn || null,
            knownFrom: period?.knownFrom || null,
            weeklyMinutes: term ? Number(term.weeklyMinutes) : null,
            primaryLocationCode: eligibility.find((item) => Number(item.isPrimary) === 1)?.locationCode || null,
            eligibleLocationCodes: eligibility.map((item) => item.locationCode),
            targetRole: seed.targetRole,
            account: account || null
        });
    }
    return rows;
}

async function migrateR1Masterdata(db) {
    assertInMemoryFixtureDatabase(db);
    const foundation = await migrateMasterdata(db);
    const baseline = await seedEmployeeBaseline(db);
    const employeeLinks = await applyEmployeeAccountLinks(db);
    return { ...foundation, baseline, employeeLinks, employees: await employeeBaselineReport(db) };
}

module.exports = {
    EMPLOYEE_BASELINE,
    applyEmployeeAccountLinks,
    employeeBaselineReport,
    migrateR1Masterdata,
    seedEmployeeBaseline,
    validateEmployeeBaseline
};
