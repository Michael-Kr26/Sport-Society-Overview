'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { createRosterDomain, migrateRosterDomain } = require('../lib/roster-domain');
const {
    migrateRosterAccess,
    minimumRoleForApi,
    minimumRoleForPage,
    roleAllows
} = require('../lib/roster-access');

const database = () => {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
};
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve({ lastID: this.lastID, changes: this.changes });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    await migrateRosterDomain(db);
    await migrateRosterAccess(db);
    return db;
}

async function locationId(db, code) {
    return (await get(db, 'SELECT id FROM locations WHERE code=?', [code])).id;
}

async function user(db, username, role, location = null) {
    return (await run(db, `INSERT INTO users
        (username, display_name, password_hash, role, is_active, location)
        VALUES (?, ?, 'x', ?, 1, ?)`, [username, username, role, location])).lastID;
}

test('R7 policy: Guest deny, Employee published, Manager planner en Admin publicatie', () => {
    assert.equal(roleAllows('guest', 'employee'), false);
    assert.equal(roleAllows('employee', 'employee'), true);
    assert.equal(roleAllows('employee', 'manager'), false);
    assert.equal(roleAllows('manager', 'manager'), true);
    assert.equal(roleAllows('manager', 'admin'), false);
    assert.equal(roleAllows('admin', 'admin'), true);

    assert.equal(minimumRoleForPage('/roster.html'), 'employee');
    assert.equal(minimumRoleForPage('/planner.html'), 'manager');
    assert.equal(minimumRoleForApi('/api/roster-planner/context'), 'employee');
    assert.equal(minimumRoleForApi('/api/roster-effective'), 'employee');
    assert.equal(minimumRoleForApi('/api/roster-publication/publish'), 'admin');
    assert.equal(minimumRoleForApi('/api/change-workflow'), 'admin');
});

test('R7 gebruikt effective-dated user_location_scopes als Manager edit-autoriteit', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const managerId = await user(db, 'manager-r7', 'manager');
        const employeeId = await user(db, 'employee-r7', 'employee');
        const adminId = await user(db, 'admin-r7', 'admin');
        const domain = createRosterDomain(db);
        await domain.ready;

        await run(db, `INSERT INTO user_location_scopes
            (user_id, location_id, can_edit_roster, can_publish_roster, effective_from, effective_to)
            VALUES (?, ?, 1, 0, '2026-10-01', '2026-10-31')`, [managerId, ave]);

        assert.equal(await domain.AuthorizationService.canViewPublishedRoster(employeeId), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(employeeId, ave, '2026-10-10'), false);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, ave, '2026-09-30'), false);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, ave, '2026-10-10'), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, ave, '2026-11-01'), false);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, bve, '2026-10-10'), false);
        assert.equal(await domain.AuthorizationService.canEditLocation(adminId, bve, '2026-10-10'), true);
        assert.equal(await domain.AuthorizationService.canPublish(managerId), false);
        assert.equal(await domain.AuthorizationService.canPublish(adminId), true);
    } finally {
        await close(db);
    }
});

test('R7 maakt voor nieuwe legacy Manager-accountkoppeling automatisch canonical scope', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const managerId = await user(db, 'manager-trigger-r7', 'manager', 'Achterveld');
        const scope = await get(db, `SELECT location_id AS locationId, can_edit_roster AS canEdit,
            can_publish_roster AS canPublish, effective_from AS effectiveFrom
            FROM user_location_scopes WHERE user_id=? ORDER BY id DESC LIMIT 1`, [managerId]);
        assert.equal(scope.locationId, ave);
        assert.equal(scope.canEdit, 1);
        assert.equal(scope.canPublish, 0);
        assert.match(scope.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);

        await run(db, "UPDATE users SET role='employee' WHERE id=?", [managerId]);
        const domain = createRosterDomain(db);
        await domain.ready;
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, ave, new Date().toISOString().slice(0, 10)), false);
    } finally {
        await close(db);
    }
});

test('R7 serverstart loopt via toegangsbootstrap en niet rechtstreeks via planner', () => {
    const root = path.join(__dirname, '..');
    const startServer = fs.readFileSync(path.join(root, 'start-server.js'), 'utf8');
    const accessBootstrap = fs.readFileSync(path.join(root, 'r7-access-bootstrap.js'), 'utf8');
    assert.match(startServer, /require\('\.\/r7-access-bootstrap'\)/);
    assert.doesNotMatch(startServer, /require\('\.\/roster-planner-bootstrap'\)/);
    assert.match(accessBootstrap, /minimumRoleForPage/);
    assert.match(accessBootstrap, /minimumRoleForApi/);
    assert.match(accessBootstrap, /app\.use\(accessGuard\)/);
});
