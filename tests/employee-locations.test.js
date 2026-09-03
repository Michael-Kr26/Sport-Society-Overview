'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { listEmployeeLocations, replaceEmployeeLocations } = require('../lib/employee-locations');

function openDb() {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

test('medewerkerlocaties bewaren historie en sturen primaire/inzetbare locaties', async () => {
    const db = openDb();
    try {
        await migrateR1Masterdata(db);
        const michael = await get(db, `SELECT id FROM employees WHERE display_name='Michael'`);
        assert.ok(michael?.id);

        const baseline = await listEmployeeLocations(db, michael.id, '2026-09-02');
        assert.equal(baseline.primaryLocationCode, 'AVE');
        assert.deepEqual(new Set(baseline.eligibleLocationCodes), new Set(['AVE', 'HAR']));

        const updated = await replaceEmployeeLocations(db, {
            employeeId: michael.id,
            primaryLocationCode: 'BVE',
            eligibleLocationCodes: ['BVE', 'VHU'],
            effectiveFrom: '2026-09-03'
        });
        assert.equal(updated.primaryLocationCode, 'BVE');
        assert.deepEqual(new Set(updated.eligibleLocationCodes), new Set(['BVE', 'VHU']));

        const history = await listEmployeeLocations(db, michael.id, '2026-09-02');
        assert.equal(history.primaryLocationCode, 'AVE');
        assert.deepEqual(new Set(history.eligibleLocationCodes), new Set(['AVE', 'HAR']));
    } finally {
        await close(db);
    }
});

test('primaire locatie moet ook inzetbaar zijn', async () => {
    const db = openDb();
    try {
        await migrateR1Masterdata(db);
        const michael = await get(db, `SELECT id FROM employees WHERE display_name='Michael'`);
        await assert.rejects(
            replaceEmployeeLocations(db, {
                employeeId: michael.id,
                primaryLocationCode: 'AVE',
                eligibleLocationCodes: ['HAR'],
                effectiveFrom: '2026-09-03'
            }),
            (error) => error.status === 400 && error.code === 'PRIMARY_NOT_ELIGIBLE'
        );
    } finally {
        await close(db);
    }
});

test('medewerkerdetail laadt locatie-editor en server exposeert Admin-API', () => {
    const root = path.join(__dirname, '..');
    const startServer = fs.readFileSync(path.join(root, 'start-server.js'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(root, 'employee-location-bootstrap.js'), 'utf8');
    const viewModel = fs.readFileSync(path.join(root, 'employee-view-model.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'employee-location-ui.js'), 'utf8');

    assert.match(startServer, /require\('\.\/employee-location-bootstrap'\)/);
    assert.match(bootstrap, /app\.get\('\/api\/employee-locations\/:employeeId'/);
    assert.match(bootstrap, /app\.put\('\/api\/employee-locations\/:employeeId'/);
    assert.match(bootstrap, /user\.role !== 'admin'/);
    assert.match(viewModel, /employee-location-ui\.js/);
    assert.match(ui, /Primaire locatie/);
    assert.match(ui, /Inzetbaar op/);
    assert.match(ui, /eligibleLocationCodes/);
});
