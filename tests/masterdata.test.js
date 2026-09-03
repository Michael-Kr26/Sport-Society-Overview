'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const {
    PLANNING_BASELINE,
    allocateEmployeeCode,
    canonicalEmployeeName,
    migrateMasterdata
} = require('../lib/masterdata');

function database() {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

test('R1A seedt alleen de vijf canonieke locaties en blijft idempotent', async () => {
    const db = database();
    try {
        await migrateMasterdata(db);
        await migrateMasterdata(db);
        const rows = await all(db, 'SELECT code, name FROM locations ORDER BY sort_order');
        assert.deepEqual(rows, [
            { code: 'AVE', name: 'Achterveld' },
            { code: 'BVE', name: 'Barneveld' },
            { code: 'VHU', name: 'Voorthuizen' },
            { code: 'WEK', name: 'Wekerom' },
            { code: 'HAR', name: 'Harskamp' }
        ]);
        const meta = await get(db, 'SELECT planning_baseline AS planningBaseline FROM masterdata_meta WHERE id=1');
        assert.equal(meta.planningBaseline, PLANNING_BASELINE);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employees')).count), 0);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM legacy_employee_aliases')).count), 0);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM masterdata_access_seeds')).count), 0);
    } finally {
        await close(db);
    }
});

test('medewerkernamen worden niet meer door persoonsgebonden code-aliases herschreven', () => {
    assert.equal(canonicalEmployeeName('  Voorbeeld Medewerker  '), 'Voorbeeld Medewerker');
    assert.equal(canonicalEmployeeName('Naam   Met   Spaties'), 'Naam Met Spaties');
});

test('contract- en dienstverbandmodel staat onbekende oude startdatum toe', async () => {
    const db = database();
    try {
        await migrateMasterdata(db);
        const employeeCode = await allocateEmployeeCode(db);
        await exec(db, `INSERT INTO employees (employee_code, display_name) VALUES ('${employeeCode}', 'Test Medewerker');`);
        const employee = await get(db, "SELECT id FROM employees WHERE display_name='Test Medewerker'");
        await exec(db, `INSERT INTO employment_periods
            (employee_id, employment_type, starts_on, ends_on, known_from, note)
            VALUES (${employee.id}, 'contract', NULL, NULL, '${PLANNING_BASELINE}', 'Oudere startdatum onbekend');`);
        const period = await get(db, 'SELECT id, starts_on AS startsOn, known_from AS knownFrom FROM employment_periods WHERE employee_id=?', [employee.id]);
        assert.equal(period.startsOn, null);
        assert.equal(period.knownFrom, PLANNING_BASELINE);
        await exec(db, `INSERT INTO contract_terms
            (employment_period_id, effective_from, weekly_minutes, note)
            VALUES (${period.id}, '${PLANNING_BASELINE}', 1920, 'Bekende baseline vanaf september');`);
        const terms = await get(db, 'SELECT weekly_minutes AS weeklyMinutes FROM contract_terms WHERE employment_period_id=?', [period.id]);
        assert.equal(terms.weeklyMinutes, 1920);
    } finally {
        await close(db);
    }
});

test('employee codes zijn stabiele oplopende EMP-codes', async () => {
    const db = database();
    try {
        await migrateMasterdata(db);
        assert.equal(await allocateEmployeeCode(db), 'EMP-0001');
        assert.equal(await allocateEmployeeCode(db), 'EMP-0002');
    } finally {
        await close(db);
    }
});

test('masterdatamigratie leidt geen account-scopes af uit namen', async () => {
    const db = database();
    try {
        await exec(db, `CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL DEFAULT 'x',
            role TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO users (username, display_name, role) VALUES
            ('manager-test', 'Manager Test', 'manager'),
            ('admin-test', 'Admin Test', 'admin');`);
        const report = await migrateMasterdata(db);
        assert.deepEqual(await all(db, 'SELECT * FROM user_location_scopes'), []);
        assert.deepEqual(report.access, { applied: [], unresolved: [], roleMismatches: [] });
    } finally {
        await close(db);
    }
});
