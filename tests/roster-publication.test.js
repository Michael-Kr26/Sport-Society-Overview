'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { createRosterDomain, migrateRosterDomain } = require('../lib/roster-domain');
const { createRosterPublicationWorkflow, migrateRosterPublication } = require('../lib/roster-publication');

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
    await migrateRosterPublication(db);
    await run(db, `CREATE TABLE changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        change_date TEXT NOT NULL,
        reported_date TEXT NOT NULL,
        location TEXT NOT NULL,
        employee_1 TEXT NOT NULL,
        employee_2 TEXT,
        change_type TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    return db;
}

async function id(db, sql, params = []) {
    return (await get(db, sql, params)).id;
}

async function user(db, username, role) {
    return (await run(db, `INSERT INTO users (username, display_name, password_hash, role, is_active)
        VALUES (?, ?, 'x', ?, 1)`, [username, username, role])).lastID;
}

async function addOneShiftDraft(db, domain, adminId, locationId, weekStart, employeeId, end = '2026-09-14T19:00:00.000Z') {
    const created = await domain.DraftService.ensureDraft({
        locationId,
        weekStart,
        actorUserId: adminId,
        changeNote: 'R6 test'
    });
    return domain.DraftService.addShift({
        versionId: created.version.id,
        expectedRevision: created.version.revision,
        actorUserId: adminId,
        employeeId,
        startsAtUtc: '2026-09-14T16:30:00.000Z',
        endsAtUtc: end,
        shiftType: 'floor'
    });
}

async function createRepublishDraft(domain, admin, locationId) {
    const cloned = await domain.DraftService.ensureDraft({
        locationId,
        weekStart: '2026-09-14',
        actorUserId: admin,
        changeNote: 'Tijd aangepast'
    });
    return domain.DraftService.updateShift({
        versionId: cloned.version.id,
        shiftUid: cloned.shifts[0].shiftUid,
        expectedRevision: cloned.version.revision,
        actorUserId: admin,
        startsAtUtc: '2026-09-14T16:00:00.000Z',
        endsAtUtc: '2026-09-14T19:00:00.000Z',
        shiftType: 'floor'
    });
}

test('R6 preview en eerste publicatie maken published waarheid en notificatie-outbox', async () => {
    const db = await readyDb();
    try {
        const admin = await user(db, 'admin-r6-first', 'admin');
        const ave = await id(db, "SELECT id FROM locations WHERE code='AVE'");
        const michael = await id(db, "SELECT id FROM employees WHERE display_name='Michael'");
        const domain = createRosterDomain(db);
        await domain.ready;
        const workflow = await createRosterPublicationWorkflow(db);
        const draft = await addOneShiftDraft(db, domain, admin, ave, '2026-09-14', michael);

        const preview = await workflow.prepare({
            actorUserId: admin,
            versionIds: [draft.id],
            referenceWeekStart: '2026-09-07'
        });
        assert.equal(preview.canPublish, true);
        assert.equal(preview.reasonRequired, false);
        assert.equal(preview.totals.added, 1);
        assert.equal(preview.totals.errors, 0);

        const result = await workflow.publish({
            actorUserId: admin,
            versionIds: [draft.id],
            referenceWeekStart: '2026-09-07'
        });
        assert.equal(result.versions.length, 1);
        assert.equal((await get(db, 'SELECT state FROM roster_versions WHERE id=?', [draft.id])).state, 'published');
        assert.equal(Number((await get(db, "SELECT COUNT(*) AS count FROM roster_notification_outbox WHERE event_type='roster_published'")).count), 1);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_publication_cml_links')).count), 0);
        const horizon = await workflow.horizon({ referenceWeekStart: '2026-09-07' });
        assert.equal(horizon.locations.find((item) => item.code === 'AVE').futurePublishedWeeks, 1);
    } finally {
        await close(db);
    }
});

test('R6 republish vereist reden, projecteert naar immutable CML en bewaart historie', async () => {
    const db = await readyDb();
    try {
        const admin = await user(db, 'admin-r6-republish', 'admin');
        const ave = await id(db, "SELECT id FROM locations WHERE code='AVE'");
        const michael = await id(db, "SELECT id FROM employees WHERE display_name='Michael'");
        const domain = createRosterDomain(db);
        await domain.ready;
        const workflow = await createRosterPublicationWorkflow(db);
        const initialDraft = await addOneShiftDraft(db, domain, admin, ave, '2026-09-14', michael);
        await workflow.publish({ actorUserId: admin, versionIds: [initialDraft.id], referenceWeekStart: '2026-09-07' });

        const changed = await createRepublishDraft(domain, admin, ave);
        const preview = await workflow.prepare({
            actorUserId: admin,
            versionIds: [changed.id],
            referenceWeekStart: '2026-09-07'
        });
        assert.equal(preview.reasonRequired, true);
        assert.equal(preview.totals.modified, 1);

        await assert.rejects(
            workflow.publish({ actorUserId: admin, versionIds: [changed.id], referenceWeekStart: '2026-09-07' }),
            (error) => error && error.code === 'PUBLICATION_REASON_REQUIRED'
        );

        const result = await workflow.publish({
            actorUserId: admin,
            versionIds: [changed.id],
            reason: 'Afgestemd met medewerker',
            referenceWeekStart: '2026-09-07'
        });
        assert.equal(result.sideEffects.status, 'complete');
        const cml = await get(db, `SELECT id, change_type AS type, location, reason, status
            FROM changes WHERE change_type='Roosterpublicatie'`);
        assert.equal(cml.type, 'Roosterpublicatie');
        assert.equal(cml.location, 'Achterveld');
        assert.equal(cml.status, 'Afgerond');
        assert.match(cml.reason, /Afgestemd met medewerker/);
        assert.match(cml.reason, /1 gewijzigd/);
        assert.equal(Number((await get(db, "SELECT COUNT(*) AS count FROM roster_notification_outbox WHERE event_type='roster_changed'")).count), 1);
        assert.equal(Number((await get(db, "SELECT COUNT(*) AS count FROM roster_versions WHERE state='published'")).count), 2);

        await assert.rejects(run(db, "UPDATE changes SET status='Open' WHERE id=?", [cml.id]), /immutable/);
        await assert.rejects(run(db, 'DELETE FROM changes WHERE id=?', [cml.id]), /immutable/);

        const history = await workflow.history({ limit: 10 });
        assert.equal(history.length, 2);
        assert.equal(history[0].changeCount, 1);
        assert.equal(history[0].note, 'Afgestemd met medewerker');
    } finally {
        await close(db);
    }
});

test('R6 kan CML-projectie overslaan maar notificaties behouden voor wijzigingsformulier', async () => {
    const db = await readyDb();
    try {
        const admin = await user(db, 'admin-r6-form', 'admin');
        const ave = await id(db, "SELECT id FROM locations WHERE code='AVE'");
        const michael = await id(db, "SELECT id FROM employees WHERE display_name='Michael'");
        const domain = createRosterDomain(db);
        await domain.ready;
        const workflow = await createRosterPublicationWorkflow(db);
        const initialDraft = await addOneShiftDraft(db, domain, admin, ave, '2026-09-14', michael);
        await workflow.publish({ actorUserId: admin, versionIds: [initialDraft.id], referenceWeekStart: '2026-09-07' });
        const changed = await createRepublishDraft(domain, admin, ave);

        const result = await workflow.publish({
            actorUserId: admin,
            versionIds: [changed.id],
            reason: 'Reeds vastgelegd door wijzigingsformulier',
            referenceWeekStart: '2026-09-07',
            projectCml: false
        });
        assert.equal(result.sideEffects.status, 'complete');
        assert.equal(result.sideEffects.cml.status, 'skipped');
        assert.equal(result.sideEffects.cml.reason, 'already_recorded_by_change_workflow');
        assert.equal(Number((await get(db, "SELECT COUNT(*) AS count FROM changes WHERE change_type='Roosterpublicatie'")).count), 0);
        assert.equal(Number((await get(db, "SELECT COUNT(*) AS count FROM roster_notification_outbox WHERE event_type='roster_changed'")).count), 1);
    } finally {
        await close(db);
    }
});

test('R6 ondersteunt batchpublicatie en blokkeert Manager-publicatie', async () => {
    const db = await readyDb();
    try {
        const admin = await user(db, 'admin-r6-batch', 'admin');
        const manager = await user(db, 'manager-r6-batch', 'manager');
        const ave = await id(db, "SELECT id FROM locations WHERE code='AVE'");
        const bve = await id(db, "SELECT id FROM locations WHERE code='BVE'");
        const michael = await id(db, "SELECT id FROM employees WHERE display_name='Michael'");
        const domain = createRosterDomain(db);
        await domain.ready;
        const workflow = await createRosterPublicationWorkflow(db);
        const aveDraft = await addOneShiftDraft(db, domain, admin, ave, '2026-09-14', michael);
        const bveCreated = await domain.DraftService.ensureDraft({ locationId: bve, weekStart: '2026-09-14', actorUserId: admin });
        const bveDraft = await domain.DraftService.addShift({
            versionId: bveCreated.version.id,
            expectedRevision: bveCreated.version.revision,
            actorUserId: admin,
            employeeId: null,
            startsAtUtc: '2026-09-14T16:30:00.000Z',
            endsAtUtc: '2026-09-14T19:30:00.000Z',
            shiftType: 'floor'
        });

        const candidates = await workflow.listCandidates({ actorUserId: admin, fromWeekStart: '2026-09-07', weeks: 4 });
        assert.equal(candidates.items.length, 2);
        const result = await workflow.publish({
            actorUserId: admin,
            versionIds: [aveDraft.id, bveDraft.id],
            referenceWeekStart: '2026-09-07'
        });
        assert.equal(result.versions.length, 2);

        await assert.rejects(
            workflow.listCandidates({ actorUserId: manager, fromWeekStart: '2026-09-07', weeks: 4 }),
            (error) => error && error.code === 'ROSTER_PUBLISH_FORBIDDEN'
        );
    } finally {
        await close(db);
    }
});
