'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const {
    AVAILABILITY_SLOTS,
    DEFAULT_SETTINGS,
    SHIFT_TYPES,
    bumpDraftRevision,
    migrateRosterData
} = require('../lib/roster-data');

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

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    return db;
}

async function locationId(db, code) {
    return (await get(db, 'SELECT id FROM locations WHERE code=?', [code])).id;
}

async function employeeId(db, name = 'Michael') {
    return (await get(db, 'SELECT id FROM employees WHERE display_name=?', [name])).id;
}

test('R2 seedt vaste roosterinstellingen en beschikbaarheidscategorieën idempotent', async () => {
    const db = await readyDb();
    try {
        await migrateRosterData(db);
        const settings = await get(db, `SELECT minimum_published_horizon_weeks AS minimumWeeks,
            target_published_horizon_weeks AS targetWeeks, generation_horizon_weeks AS generationWeeks,
            publication_role AS publicationRole, availability_conflict_policy AS availabilityPolicy,
            location_eligibility_policy AS locationPolicy, pattern_propagation_policy AS patternPolicy,
            published_pattern_policy AS publishedPatternPolicy, contract_variance_policy AS contractPolicy
            FROM roster_settings WHERE id=1`);
        assert.deepEqual(settings, {
            minimumWeeks: 6,
            targetWeeks: 12,
            generationWeeks: 24,
            publicationRole: 'admin',
            availabilityPolicy: 'warning',
            locationPolicy: 'warning',
            patternPolicy: 'auto_future',
            publishedPatternPolicy: 'admin_compound_republish',
            contractPolicy: 'hour_bank'
        });
        const slots = await all(db, 'SELECT code FROM availability_slots ORDER BY sort_order');
        assert.deepEqual(slots.map((row) => row.code), AVAILABILITY_SLOTS.map((slot) => slot.code));
        assert.deepEqual(SHIFT_TYPES, ['floor', 'administration', 'internship']);
        assert.equal(DEFAULT_SETTINGS.weekStartsOn, 1);
    } finally {
        await close(db);
    }
});

test('R2 staat maximaal één actief concept per locatie-week toe', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const period = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
            VALUES (?, '2026-09-07', '2026-09-13')`, [ave]);
        await run(db, `INSERT INTO roster_versions (period_id, version_no, state) VALUES (?, 1, 'draft')`, [period.lastID]);
        await assert.rejects(
            run(db, `INSERT INTO roster_versions (period_id, version_no, state) VALUES (?, 2, 'draft')`, [period.lastID]),
            /UNIQUE constraint failed/
        );
        await run(db, `UPDATE roster_versions SET state='abandoned' WHERE period_id=? AND version_no=1`, [period.lastID]);
        await run(db, `INSERT INTO roster_versions (period_id, version_no, state) VALUES (?, 2, 'draft')`, [period.lastID]);
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_versions WHERE period_id=? AND state='draft'`, [period.lastID])).count), 1);
    } finally {
        await close(db);
    }
});

test('R2 maakt gepubliceerde shifts en versies immutable', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const period = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
            VALUES (?, '2026-09-07', '2026-09-13')`, [ave]);
        const version = await run(db, `INSERT INTO roster_versions (period_id, version_no, state) VALUES (?, 1, 'draft')`, [period.lastID]);
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type)
            VALUES ('SHIFT-1', ?, ?, ?, '2026-09-07T16:30:00Z', '2026-09-07T19:00:00Z', 'floor')`,
        [version.lastID, michael, ave]);
        await run(db, `UPDATE roster_versions SET state='published', published_at=CURRENT_TIMESTAMP WHERE id=?`, [version.lastID]);
        await assert.rejects(run(db, `UPDATE roster_shifts SET note='gewijzigd' WHERE version_id=?`, [version.lastID]), /immutable/);
        await assert.rejects(run(db, `DELETE FROM roster_shifts WHERE version_id=?`, [version.lastID]), /immutable/);
        await assert.rejects(run(db, `UPDATE roster_versions SET change_note='x' WHERE id=?`, [version.lastID]), /immutable/);
    } finally {
        await close(db);
    }
});

test('R2 optimistic locking verhoogt alleen de verwachte draft-revision', async () => {
    const db = await readyDb();
    try {
        const bve = await locationId(db, 'BVE');
        const period = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
            VALUES (?, '2026-09-14', '2026-09-20')`, [bve]);
        const version = await run(db, `INSERT INTO roster_versions (period_id, version_no, state, revision)
            VALUES (?, 1, 'draft', 1)`, [period.lastID]);
        const updated = await bumpDraftRevision(db, version.lastID, 1);
        assert.equal(updated.revision, 2);
        await assert.rejects(
            bumpDraftRevision(db, version.lastID, 1),
            (error) => error && error.code === 'ROSTER_VERSION_CONFLICT'
        );
    } finally {
        await close(db);
    }
});

test('R2 ondersteunt onbeperkte weekintervallen en pattern-revisions voor automatische propagatie', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        await run(db, `INSERT INTO roster_patterns
            (pattern_uid, employee_id, location_id, shift_type, weekday, start_time, end_time,
             repeat_interval_weeks, anchor_week_start, effective_from, revision)
            VALUES ('PAT-1', ?, ?, 'administration', 1, '07:00', '08:30', 12, '2026-09-07', '2026-09-07', 3)`,
        [michael, ave]);
        const row = await get(db, `SELECT repeat_interval_weeks AS repeatWeeks, revision FROM roster_patterns WHERE pattern_uid='PAT-1'`);
        assert.deepEqual(row, { repeatWeeks: 12, revision: 3 });
        await run(db, `INSERT INTO roster_pattern_sync_queue
            (pattern_id, pattern_revision, effective_from, affected_through)
            SELECT id, revision, effective_from, '2027-02-21' FROM roster_patterns WHERE pattern_uid='PAT-1'`);
        assert.equal((await get(db, `SELECT status FROM roster_pattern_sync_queue`)).status, 'pending');
    } finally {
        await close(db);
    }
});

test('R2 behandelt ontbrekende beschikbaarheid als onbekend en ondersteunt afgesproken uitzonderingen', async () => {
    const db = await readyDb();
    try {
        const olav = await employeeId(db, 'Olav');
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM employee_availability_patterns WHERE employee_id=?`, [olav])).count), 0);
        await run(db, `INSERT INTO employee_availability_patterns
            (employee_id, weekday, slot_code, availability_state, effective_from)
            VALUES (?, 1, 'AFTERNOON', 'available', '2026-09-01')`, [olav]);
        await run(db, `INSERT INTO employee_availability_exceptions
            (employee_id, availability_date, slot_code, availability_state, reason)
            VALUES (?, '2026-09-21', 'AFTERNOON', 'unavailable', 'Afgesproken uitzondering')`, [olav]);
        const exception = await get(db, `SELECT availability_state AS state, reason
            FROM employee_availability_exceptions WHERE employee_id=? AND availability_date='2026-09-21'`, [olav]);
        assert.deepEqual(exception, { state: 'unavailable', reason: 'Afgesproken uitzondering' });
    } finally {
        await close(db);
    }
});

test('R2 batch-publicatie kan meerdere locaties en weken in één publicatie koppelen', async () => {
    const db = await readyDb();
    try {
        const admin = await run(db, `INSERT INTO users (username, display_name, password_hash, role)
            VALUES ('r2-admin', 'R2 Admin', 'x', 'admin')`);
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const p1 = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end) VALUES (?, '2026-09-07', '2026-09-13')`, [ave]);
        const p2 = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end) VALUES (?, '2026-09-14', '2026-09-20')`, [bve]);
        const v1 = await run(db, `INSERT INTO roster_versions (period_id, version_no, state, published_by_user_id, published_at) VALUES (?, 1, 'published', ?, CURRENT_TIMESTAMP)`, [p1.lastID, admin.lastID]);
        const v2 = await run(db, `INSERT INTO roster_versions (period_id, version_no, state, published_by_user_id, published_at) VALUES (?, 1, 'published', ?, CURRENT_TIMESTAMP)`, [p2.lastID, admin.lastID]);
        const publication = await run(db, `INSERT INTO roster_publications (publication_uid, published_by_user_id, note)
            VALUES ('PUB-R2-1', ?, 'meerdere weken/locaties')`, [admin.lastID]);
        await run(db, `INSERT INTO roster_publication_versions (publication_id, version_id) VALUES (?, ?)`, [publication.lastID, v1.lastID]);
        await run(db, `INSERT INTO roster_publication_versions (publication_id, version_id) VALUES (?, ?)`, [publication.lastID, v2.lastID]);
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_publication_versions WHERE publication_id=?`, [publication.lastID])).count), 2);
    } finally {
        await close(db);
    }
});
