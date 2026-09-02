'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { createRosterDomain, migrateRosterDomain } = require('../lib/roster-domain');
const { migrateRosterAccess } = require('../lib/roster-access');
const { createRosterPlanner } = require('../lib/roster-planner');

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

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    await migrateRosterDomain(db);
    return db;
}

async function createUser(db, username, displayName, role) {
    const result = await run(db, `INSERT INTO users (username, display_name, password_hash, role)
        VALUES (?, ?, 'x', ?)`, [username, displayName, role]);
    return result.lastID;
}

async function employeeId(db, name) {
    return (await get(db, 'SELECT id FROM employees WHERE display_name=?', [name])).id;
}

async function locationId(db, code) {
    return (await get(db, 'SELECT id FROM locations WHERE code=?', [code])).id;
}

test('R5 weekplanner maakt concept en beheert diensten in lokale Amsterdam-tijd', async () => {
    const db = await readyDb();
    try {
        const adminId = await createUser(db, 'r5-admin', 'R5 Admin', 'admin');
        const michaelId = await employeeId(db, 'Michael');
        const planner = await createRosterPlanner(db);

        let context = await planner.ensureDraft({
            userId: adminId,
            locationCode: 'AVE',
            weekStart: '2026-09-07'
        });
        assert.equal(context.views.selected, 'draft');
        assert.equal(context.selectedVersion.state, 'draft');
        assert.equal(context.permissions.canEdit, true);

        context = await planner.addShift({
            userId: adminId,
            versionId: context.selectedVersion.id,
            expectedRevision: context.selectedVersion.revision,
            employeeId: michaelId,
            date: '2026-09-07',
            startTime: '18:30',
            endTime: '21:00',
            shiftType: 'floor',
            note: 'R5 testdienst'
        });
        assert.equal(context.selectedVersion.shifts.length, 1);
        const shift = context.selectedVersion.shifts[0];
        assert.equal(shift.date, '2026-09-07');
        assert.equal(shift.startTime, '18:30');
        assert.equal(shift.endTime, '21:00');
        assert.equal(shift.startsAtUtc, '2026-09-07T16:30:00.000Z');
        assert.equal(shift.employeeName, 'Michael');
        assert.equal(context.summary.plannedMinutes, 150);

        context = await planner.updateShift({
            userId: adminId,
            versionId: context.selectedVersion.id,
            shiftUid: shift.shiftUid,
            expectedRevision: context.selectedVersion.revision,
            employeeId: michaelId,
            date: '2026-09-07',
            startTime: '18:00',
            endTime: '21:30',
            shiftType: 'administration',
            note: 'Aangepast'
        });
        assert.equal(context.selectedVersion.shifts[0].startTime, '18:00');
        assert.equal(context.selectedVersion.shifts[0].shiftType, 'administration');

        context = await planner.removeShift({
            userId: adminId,
            versionId: context.selectedVersion.id,
            shiftUid: shift.shiftUid,
            expectedRevision: context.selectedVersion.revision,
            reason: 'Test verwijderen'
        });
        assert.equal(context.selectedVersion.shifts.length, 0);
    } finally {
        await close(db);
    }
});

test('R5 ondersteunt open diensten en retourneert validatiewaarschuwing', async () => {
    const db = await readyDb();
    try {
        const adminId = await createUser(db, 'r5-open-admin', 'R5 Open Admin', 'admin');
        const planner = await createRosterPlanner(db);
        let context = await planner.ensureDraft({ userId: adminId, locationCode: 'BVE', weekStart: '2026-09-07' });
        context = await planner.addShift({
            userId: adminId,
            versionId: context.selectedVersion.id,
            expectedRevision: context.selectedVersion.revision,
            employeeId: null,
            date: '2026-09-08',
            startTime: '16:00',
            endTime: '21:30',
            shiftType: 'floor',
            note: 'Nog invullen'
        });
        assert.equal(context.summary.openShiftCount, 1);
        assert.equal(context.selectedVersion.shifts[0].open, true);
        assert.ok(context.validation.warnings.some((warning) => warning.code === 'OPEN_SHIFT'));
    } finally {
        await close(db);
    }
});

test('R5 optimistic locking weigert een mutatie met verouderde revision', async () => {
    const db = await readyDb();
    try {
        const adminId = await createUser(db, 'r5-lock-admin', 'R5 Lock Admin', 'admin');
        const michaelId = await employeeId(db, 'Michael');
        const planner = await createRosterPlanner(db);
        let context = await planner.ensureDraft({ userId: adminId, locationCode: 'AVE', weekStart: '2026-09-14' });
        const oldRevision = context.selectedVersion.revision;
        context = await planner.addShift({
            userId: adminId,
            versionId: context.selectedVersion.id,
            expectedRevision: oldRevision,
            employeeId: michaelId,
            date: '2026-09-14',
            startTime: '18:30',
            endTime: '21:00',
            shiftType: 'floor'
        });
        await assert.rejects(
            planner.addShift({
                userId: adminId,
                versionId: context.selectedVersion.id,
                expectedRevision: oldRevision,
                employeeId: michaelId,
                date: '2026-09-15',
                startTime: '18:30',
                endTime: '21:00',
                shiftType: 'floor'
            }),
            (error) => error && error.code === 'ROSTER_VERSION_CONFLICT'
        );
    } finally {
        await close(db);
    }
});

test('R7 Manager ziet gepubliceerd rooster maar kan de Planner niet gebruiken of wijzigen', async () => {
    const db = await readyDb();
    try {
        const managerId = await createUser(db, 'r7-manager', 'R7 Manager', 'manager');
        const bve = await locationId(db, 'BVE');
        await run(db, `INSERT INTO user_location_scopes
            (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            VALUES (?, ?, 1, 0, '2026-09-01')`, [managerId, bve]);
        await migrateRosterAccess(db);

        const planner = await createRosterPlanner(db);
        const bveContext = await planner.buildContext({
            userId: managerId,
            locationCode: 'BVE',
            weekStart: '2026-09-07'
        });
        assert.equal(bveContext.permissions.canEdit, false);
        assert.equal(bveContext.permissions.canPublish, false);
        assert.equal(bveContext.permissions.canViewDraft, false);
        assert.equal(bveContext.locations.length, 5);
        assert.ok(bveContext.locations.every((location) => location.canEdit === false));

        await assert.rejects(
            planner.ensureDraft({ userId: managerId, locationCode: 'BVE', weekStart: '2026-09-07' }),
            (error) => error && error.code === 'ROSTER_EDIT_FORBIDDEN'
        );
    } finally {
        await close(db);
    }
});

test('R5 Employee krijgt alleen de nieuwste gepubliceerde week en geen draftdata', async () => {
    const db = await readyDb();
    try {
        const adminId = await createUser(db, 'r5-pub-admin', 'R5 Pub Admin', 'admin');
        const employeeUserId = await createUser(db, 'r5-employee', 'R5 Employee', 'employee');
        const michaelId = await employeeId(db, 'Michael');
        const planner = await createRosterPlanner(db);
        let context = await planner.ensureDraft({ userId: adminId, locationCode: 'AVE', weekStart: '2026-09-21' });
        context = await planner.addShift({
            userId: adminId,
            versionId: context.selectedVersion.id,
            expectedRevision: context.selectedVersion.revision,
            employeeId: michaelId,
            date: '2026-09-21',
            startTime: '18:30',
            endTime: '21:00',
            shiftType: 'floor'
        });
        const domain = createRosterDomain(db);
        await domain.ready;
        await domain.PublicationService.publish({
            versionIds: [context.selectedVersion.id],
            actorUserId: adminId,
            reason: 'Eerste R5 publicatie'
        });

        const employeeContext = await planner.buildContext({
            userId: employeeUserId,
            locationCode: 'AVE',
            weekStart: '2026-09-21',
            view: 'draft'
        });
        assert.equal(employeeContext.permissions.canEdit, false);
        assert.equal(employeeContext.views.selected, 'published');
        assert.equal(employeeContext.selectedVersion.state, 'published');
        assert.equal(employeeContext.selectedVersion.shifts.length, 1);
        assert.equal(employeeContext.employees.length, 0);
    } finally {
        await close(db);
    }
});
