'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const sqlite3 = require('sqlite3').verbose();
const { EMPLOYEE_BASELINE, migrateR1Masterdata } = require('../lib/masterdata-r1b');

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

function get(db, sql) {
    return new Promise((resolve, reject) => db.get(sql, (error, row) => error ? reject(error) : resolve(row || null)));
}

test('historische R1B-medewerkers bestaan uitsluitend als in-memory testfixture', async () => {
    const db = new sqlite3.Database(':memory:');
    try {
        const report = await migrateR1Masterdata(db);
        assert.equal(EMPLOYEE_BASELINE.length, 22);
        assert.equal(report.baseline.createdEmployees.length, 22);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employees')).count), 22);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employee_location_eligibility')).count), 34);
        await migrateR1Masterdata(db);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM employees')).count), 22);
    } finally {
        await close(db);
    }
});

test('R1B employee-fixture kan niet op een persistente productdatabase worden toegepast', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-r1b-'));
    const file = path.join(directory, 'test.db');
    const db = new sqlite3.Database(file);
    try {
        await assert.rejects(
            migrateR1Masterdata(db),
            (error) => error?.code === 'R1B_RETIRED'
        );
    } finally {
        await close(db);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
