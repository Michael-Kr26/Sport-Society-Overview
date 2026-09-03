'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterAccess, minimumRoleForApi, minimumRoleForPage, roleAllows } = require('../lib/roster-access');
const { createRosterDomain } = require('../lib/roster-domain');

function openDb() {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
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

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

async function prepareUsers(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
}

test('R7/R9 policy: published read-only, Admin planning en Manager published exportdownload', () => {
    assert.equal(minimumRoleForPage('/roster.html'), 'employee');
    assert.equal(minimumRoleForPage('/planner.html'), 'admin');
    assert.equal(minimumRoleForPage('/cml.html'), 'manager');
    assert.equal(minimumRoleForPage('/cf.html'), 'admin');
    assert.equal(minimumRoleForApi('/api/roster-planner/context'), 'employee');
    assert.equal(minimumRoleForApi('/api/roster-publication/preview'), 'admin');
    assert.equal(minimumRoleForApi('/api/roster-operations/staffing'), 'manager');
    assert.equal(minimumRoleForApi('/api/roster-export/month'), 'manager');
    assert.equal(minimumRoleForApi('/api/roster-export/sharepoint'), 'admin');
    assert.equal(roleAllows('employee', 'employee'), true);
    assert.equal(roleAllows('employee', 'manager'), false);
    assert.equal(roleAllows('manager', 'employee'), true);
    assert.equal(roleAllows('manager', 'admin'), false);
    assert.equal(roleAllows('admin', 'admin'), true);
});

test('R7 neutraliseert Manager-roosterscopes en laat alleen Admin wijzigen', async () => {
    const db = openDb();
    try {
        await prepareUsers(db);
        await migrateR1Masterdata(db);
        const manager = await get(db, `SELECT id FROM users WHERE username='manager-r7'`);
        const managerId = manager?.id || (await run(db, `INSERT INTO users (username, display_name, role) VALUES ('manager-r7','Manager R7','manager')`)).lastID;
        const adminId = (await run(db, `INSERT INTO users (username, display_name, role) VALUES ('admin-r7','Admin R7','admin')`)).lastID;
        const ave = (await get(db, `SELECT id FROM locations WHERE code='AVE'`)).id;
        await run(db, `INSERT INTO user_location_scopes
            (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            VALUES (?, ?, 1, 1, '2026-09-01')`, [managerId, ave]);

        await migrateRosterAccess(db);
        const scope = await get(db, `SELECT can_edit_roster AS canEdit, can_publish_roster AS canPublish
            FROM user_location_scopes WHERE user_id=? AND location_id=?`, [managerId, ave]);
        assert.equal(Number(scope.canEdit), 0);
        assert.equal(Number(scope.canPublish), 0);

        const domain = createRosterDomain(db);
        await domain.ready;
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, ave, '2026-09-01'), false);
        assert.equal(await domain.AuthorizationService.canEditLocation(adminId, ave, '2026-09-01'), true);
        assert.equal(await domain.AuthorizationService.canPublish(managerId), false);
        assert.equal(await domain.AuthorizationService.canPublish(adminId), true);
    } finally {
        await close(db);
    }
});

test('R7 maakt voor Manager-account alleen organisatorische locatie-scope zonder roosterrechten', async () => {
    const db = openDb();
    try {
        await prepareUsers(db);
        await migrateR1Masterdata(db);
        // R7 voegt users.location toe; de fixture mag die kolom pas daarna gebruiken.
        await migrateRosterAccess(db);
        const ave = (await get(db, `SELECT id FROM locations WHERE code='AVE'`)).id;
        const managerId = (await run(db, `INSERT INTO users (username, display_name, role, location)
            VALUES ('manager-new','Manager New','manager','Achterveld')`)).lastID;
        await migrateRosterAccess(db);
        const scopes = await all(db, `SELECT can_edit_roster AS canEdit, can_publish_roster AS canPublish
            FROM user_location_scopes WHERE user_id=? AND location_id=?`, [managerId, ave]);
        assert.equal(scopes.length, 1);
        assert.equal(Number(scopes[0].canEdit), 0);
        assert.equal(Number(scopes[0].canPublish), 0);

        const domain = createRosterDomain(db);
        await domain.ready;
        assert.equal(await domain.AuthorizationService.canViewPublishedRoster(managerId), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerId, ave, new Date().toISOString().slice(0, 10)), false);
    } finally {
        await close(db);
    }
});

test('R7-R9 serverstart houdt Planner Admin-only en stapelt export boven operations/access', () => {
    const root = path.join(__dirname, '..');
    const startServer = fs.readFileSync(path.join(root, 'start-server.js'), 'utf8');
    const exportBootstrap = fs.readFileSync(path.join(root, 'r9-export-bootstrap.js'), 'utf8');
    const operationsBootstrap = fs.readFileSync(path.join(root, 'r8-operations-bootstrap.js'), 'utf8');
    const accessBootstrap = fs.readFileSync(path.join(root, 'r7-access-bootstrap.js'), 'utf8');
    const authUi = fs.readFileSync(path.join(root, 'auth-ui.js'), 'utf8');
    assert.match(startServer, /require\('\.\/r9-export-bootstrap'\)/);
    assert.doesNotMatch(startServer, /require\('\.\/roster-planner-bootstrap'\)/);
    assert.match(exportBootstrap, /require\('\.\/r8-operations-bootstrap'\)/);
    assert.match(operationsBootstrap, /require\('\.\/r7-access-bootstrap'\)/);
    assert.match(accessBootstrap, /minimumRoleForPage/);
    assert.match(accessBootstrap, /minimumRoleForApi/);
    assert.match(accessBootstrap, /canOpenPlanner: user\.role === 'admin'/);
    assert.match(accessBootstrap, /app\.use\(accessGuard\)/);
    assert.match(authUi, /'planner\.html': 'admin'/);
    assert.match(authUi, /navigationItem\('planner\.html', 'calendar', 'Planner', 'admin'\)/);
});
