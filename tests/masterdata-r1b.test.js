'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { PLANNING_BASELINE } = require('../lib/masterdata');
const { EMPLOYEE_BASELINE, migrateR1Masterdata } = require('../lib/masterdata-r1b');

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

test('R1B seedt 22 medewerkers, contractbaseline en 34 locatie-eligibilities idempotent', async () => {
    const db = database();
    try {
        assert.equal(EMPLOYEE_BASELINE.length, 22);
        assert.equal(EMPLOYEE_BASELINE.reduce((total, employee) => total + employee.eligibleLocationCodes.length, 0), 34);

        await migrateR1Masterdata(db);
        await migrateR1Masterdata(db);

        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employees')).count), 22);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employment_periods')).count), 22);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM contract_terms')).count), 22);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employee_location_eligibility')).count), 34);

        const unknownStarts = await get(db, `SELECT COUNT(*) AS count FROM employment_periods
            WHERE starts_on IS NULL AND known_from=?`, [PLANNING_BASELINE]);
        assert.equal(Number(unknownStarts.count), 22);

        const names = await all(db, 'SELECT display_name AS displayName FROM employees ORDER BY display_name');
        assert.ok(names.some((row) => row.displayName === 'Lucas L'));
        assert.ok(!names.some((row) => row.displayName === 'Lucas Leeuwis'));

        const selected = await all(db, `SELECT e.display_name AS displayName, ct.weekly_minutes AS weeklyMinutes
            FROM employees e
            JOIN employment_periods ep ON ep.employee_id=e.id AND ep.known_from=?
            JOIN contract_terms ct ON ct.employment_period_id=ep.id AND ct.effective_from=?
            WHERE e.display_name IN ('Leroy', 'Michael', 'Denise', 'Olav')
            ORDER BY e.display_name`, [PLANNING_BASELINE, PLANNING_BASELINE]);
        assert.deepEqual(selected, [
            { displayName: 'Denise', weeklyMinutes: 1080 },
            { displayName: 'Leroy', weeklyMinutes: 2130 },
            { displayName: 'Michael', weeklyMinutes: 2040 },
            { displayName: 'Olav', weeklyMinutes: 0 }
        ]);

        const michaelLocations = await all(db, `SELECT l.code, el.is_primary AS isPrimary
            FROM employees e
            JOIN employee_location_eligibility el ON el.employee_id=e.id AND el.effective_from=?
            JOIN locations l ON l.id=el.location_id
            WHERE e.display_name='Michael' ORDER BY el.is_primary DESC, l.code`, [PLANNING_BASELINE]);
        assert.deepEqual(michaelLocations, [
            { code: 'AVE', isPrimary: 1 },
            { code: 'HAR', isPrimary: 0 }
        ]);
    } finally {
        await close(db);
    }
});

test('R1B koppelt exact herkenbare accounts maar past afwijkende rollen niet stil aan', async () => {
    const db = database();
    try {
        await exec(db, `CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO users (username, display_name, role) VALUES
            ('lucasv', 'Lucas V', 'manager'),
            ('michael', 'Michael', 'admin'),
            ('olav', 'Olav', 'employee'),
            ('leroy', 'Leroy', 'employee');`);

        const report = await migrateR1Masterdata(db);
        const links = await all(db, `SELECT e.display_name AS displayName, u.role
            FROM user_employee_links link
            JOIN employees e ON e.id=link.employee_id
            JOIN users u ON u.id=link.user_id
            ORDER BY e.display_name`);
        assert.deepEqual(links, [
            { displayName: 'Leroy', role: 'employee' },
            { displayName: 'Lucas V', role: 'manager' },
            { displayName: 'Michael', role: 'admin' },
            { displayName: 'Olav', role: 'employee' }
        ]);
        assert.ok(report.employeeLinks.roleMismatches.some((item) =>
            item.employee === 'Leroy' && item.currentRole === 'employee' && item.targetRole === 'manager'));
        const leroy = await get(db, "SELECT role FROM users WHERE display_name='Leroy'");
        assert.equal(leroy.role, 'employee');

        const managerScopes = await all(db, `SELECT u.display_name AS displayName, l.code
            FROM user_location_scopes s
            JOIN users u ON u.id=s.user_id
            JOIN locations l ON l.id=s.location_id
            ORDER BY u.display_name`);
        assert.deepEqual(managerScopes, [{ displayName: 'Lucas V', code: 'BVE' }]);
    } finally {
        await close(db);
    }
});

test('R1B overschrijft latere handmatige correcties niet bij opnieuw migreren', async () => {
    const db = database();
    try {
        await migrateR1Masterdata(db);
        await exec(db, `UPDATE employment_periods
            SET starts_on='2025-09-15'
            WHERE employee_id=(SELECT id FROM employees WHERE display_name='Michael')
              AND known_from='2026-09-01';
        UPDATE contract_terms
            SET weekly_minutes=2100
            WHERE employment_period_id=(
                SELECT ep.id FROM employment_periods ep JOIN employees e ON e.id=ep.employee_id
                WHERE e.display_name='Michael' AND ep.known_from='2026-09-01'
            ) AND effective_from='2026-09-01';`);

        const report = await migrateR1Masterdata(db);
        const michael = await get(db, `SELECT ep.starts_on AS startsOn, ct.weekly_minutes AS weeklyMinutes
            FROM employees e
            JOIN employment_periods ep ON ep.employee_id=e.id AND ep.known_from='2026-09-01'
            JOIN contract_terms ct ON ct.employment_period_id=ep.id AND ct.effective_from='2026-09-01'
            WHERE e.display_name='Michael'`);
        assert.deepEqual(michael, { startsOn: '2025-09-15', weeklyMinutes: 2100 });
        assert.ok(report.baseline.dataMismatches.some((item) =>
            item.employee === 'Michael' && item.field === 'weeklyMinutes' && item.expected === 2040 && item.actual === 2100));
    } finally {
        await close(db);
    }
});
