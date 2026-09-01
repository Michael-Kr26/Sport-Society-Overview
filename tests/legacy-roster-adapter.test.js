'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { migrateRosterDomain } = require('../lib/roster-domain');
const {
    importLegacyRosterToCanonical,
    migrateLegacyRosterAdapter
} = require('../lib/legacy-roster-adapter');

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

async function createLegacyTables(db) {
    await run(db, `CREATE TABLE roster_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_file TEXT,
        status TEXT NOT NULL,
        items_found INTEGER NOT NULL DEFAULT 0
    )`);
    await run(db, `CREATE TABLE roster_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER,
        roster_date TEXT NOT NULL,
        day_name TEXT,
        employee_name TEXT NOT NULL,
        source_slot_employee TEXT,
        item_type TEXT NOT NULL,
        location TEXT,
        start_time TEXT,
        end_time TEXT,
        status TEXT NOT NULL,
        note TEXT,
        source_sheet TEXT,
        source_cell TEXT,
        source_hash TEXT
    )`);
    await run(db, `CREATE TABLE roster_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        change_id INTEGER NOT NULL UNIQUE,
        source_hash TEXT,
        action TEXT NOT NULL,
        roster_date TEXT NOT NULL,
        day_name TEXT,
        employee_name TEXT NOT NULL,
        source_slot_employee TEXT,
        item_type TEXT NOT NULL,
        location TEXT,
        start_time TEXT,
        end_time TEXT,
        status TEXT NOT NULL,
        note TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'test'
    )`);
    await run(db, `INSERT INTO roster_imports (source_type, source_file, status, items_found)
        VALUES ('test_excel', 'fixture.xlsx', 'success', 0)`);
}

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    await migrateRosterDomain(db);
    await createLegacyTables(db);
    await migrateLegacyRosterAdapter(db);
    return db;
}

async function insertShift(db, {
    hash = 'BASE-1',
    date = '2026-09-07',
    employee = 'Michael',
    location = 'Barneveld',
    start = '18:30',
    end = '21:00',
    note = null
} = {}) {
    return run(db, `INSERT INTO roster_items
        (import_id, roster_date, day_name, employee_name, source_slot_employee, item_type,
         location, start_time, end_time, status, note, source_sheet, source_cell, source_hash)
        VALUES (1, ?, 'maandag', ?, ?, 'shift', ?, ?, ?, 'Werkdienst', ?, 'Sep 26', 'C2', ?)`, [
        date, employee, employee, location, start, end, note, hash
    ]);
}

test('R4 vertaalt het effectieve legacy-rooster inclusief override naar een canonical draft', async () => {
    const db = await readyDb();
    try {
        await insertShift(db, { hash: 'BASE-1', employee: 'Michael' });
        await run(db, `INSERT INTO roster_overrides
            (change_id, source_hash, action, roster_date, day_name, employee_name,
             source_slot_employee, item_type, location, start_time, end_time, status, note, is_deleted)
            VALUES (1, 'BASE-1', 'replace', '2026-09-07', 'maandag', 'Olav',
                    'Michael', 'shift', 'Barneveld', '18:30', '21:00', 'Werkdienst', 'Vervanging', 0)`);

        const report = await importLegacyRosterToCanonical(db);
        assert.equal(report.parityStatus, 'match');
        assert.equal(report.totals.sourceShiftItems, 1);
        assert.equal(report.totals.mappedShiftItems, 1);

        const row = await get(db, `SELECT e.display_name AS employeeName, s.legacy_source_hash AS legacySourceHash,
            v.state, p.week_start AS weekStart
            FROM roster_shifts s
            INNER JOIN roster_versions v ON v.id=s.version_id
            INNER JOIN roster_periods p ON p.id=v.period_id
            LEFT JOIN employees e ON e.id=s.employee_id
            WHERE v.state='draft'`);
        assert.deepEqual(row, {
            employeeName: 'Olav',
            legacySourceHash: 'BASE-1',
            state: 'draft',
            weekStart: '2026-09-07'
        });
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_versions WHERE state='published'`)).count), 0);
    } finally {
        await close(db);
    }
});

test('R4 is idempotent als dezelfde legacybron opnieuw wordt aangeboden', async () => {
    const db = await readyDb();
    try {
        await insertShift(db);
        await importLegacyRosterToCanonical(db);
        const before = await get(db, `SELECT id, revision FROM roster_versions WHERE state='draft'`);
        const second = await importLegacyRosterToCanonical(db);
        const after = await get(db, `SELECT id, revision FROM roster_versions WHERE state='draft'`);

        assert.deepEqual(after, before);
        assert.equal(second.periods[0].action, 'matched_draft');
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_versions WHERE state='draft'`)).count), 1);
    } finally {
        await close(db);
    }
});

test('R4 beschermt een draft zodra die handmatige data bevat', async () => {
    const db = await readyDb();
    try {
        await insertShift(db);
        await importLegacyRosterToCanonical(db);
        const draft = await get(db, `SELECT v.id, p.location_id AS locationId FROM roster_versions v
            INNER JOIN roster_periods p ON p.id=v.period_id WHERE v.state='draft'`);
        const michael = await get(db, `SELECT id FROM employees WHERE display_name='Michael'`);
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type, note)
            VALUES ('MANUAL-1', ?, ?, ?, '2026-09-08T16:30:00Z', '2026-09-08T19:00:00Z', 'floor', 'Handmatig')`,
        [draft.id, michael.id, draft.locationId]);
        await run(db, `UPDATE roster_items SET end_time='22:00' WHERE source_hash='BASE-1'`);

        const report = await importLegacyRosterToCanonical(db);
        assert.equal(report.parityStatus, 'attention');
        assert.equal(report.totals.protectedPeriods, 1);
        assert.equal(report.periods[0].action, 'protected_draft');
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_shifts WHERE version_id=?`, [draft.id])).count), 2);
    } finally {
        await close(db);
    }
});

test('R4 wijzigt published nooit en maakt bij bronverschil een nieuwe draft', async () => {
    const db = await readyDb();
    try {
        await insertShift(db, { end: '21:00' });
        await importLegacyRosterToCanonical(db);
        const firstDraft = await get(db, `SELECT id FROM roster_versions WHERE state='draft'`);
        await run(db, `UPDATE roster_versions SET state='published', published_at=CURRENT_TIMESTAMP WHERE id=?`, [firstDraft.id]);
        const publishedBefore = await get(db, `SELECT ends_at_utc AS endsAtUtc FROM roster_shifts WHERE version_id=?`, [firstDraft.id]);

        await run(db, `UPDATE roster_items SET end_time='22:00', source_hash='BASE-2' WHERE source_hash='BASE-1'`);
        const report = await importLegacyRosterToCanonical(db);
        const newDraft = await get(db, `SELECT id, based_on_version_id AS basedOnVersionId FROM roster_versions WHERE state='draft'`);
        const publishedAfter = await get(db, `SELECT ends_at_utc AS endsAtUtc FROM roster_shifts WHERE version_id=?`, [firstDraft.id]);
        const draftShift = await get(db, `SELECT ends_at_utc AS endsAtUtc FROM roster_shifts WHERE version_id=?`, [newDraft.id]);

        assert.equal(report.periods[0].action, 'created_draft');
        assert.equal(newDraft.basedOnVersionId, firstDraft.id);
        assert.deepEqual(publishedAfter, publishedBefore);
        assert.notEqual(draftShift.endsAtUtc, publishedBefore.endsAtUtc);
    } finally {
        await close(db);
    }
});

test('R4 stageert afwezigheid apart en rapporteert onbekende medewerkers zonder te gokken', async () => {
    const db = await readyDb();
    try {
        await run(db, `INSERT INTO roster_items
            (import_id, roster_date, day_name, employee_name, source_slot_employee, item_type,
             location, start_time, end_time, status, note, source_sheet, source_cell, source_hash)
            VALUES (1, '2026-09-08', 'dinsdag', 'Michael', 'Michael', 'absence',
                    NULL, NULL, NULL, 'Ziek', NULL, 'Sep 26', 'C3', 'ABS-1')`);
        await insertShift(db, { hash: 'UNKNOWN-1', date: '2026-09-08', employee: 'Niet Bestaand' });

        const report = await importLegacyRosterToCanonical(db);
        assert.equal(report.parityStatus, 'attention');
        assert.equal(report.totals.stagedNonshiftItems, 1);
        assert.equal(report.totals.unresolvedItems, 1);
        assert.equal(report.unresolved[0].reasonCode, 'EMPLOYEE_NOT_FOUND');
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_legacy_nonshift_items`)).count), 1);
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_shifts`)).count), 0);
    } finally {
        await close(db);
    }
});

test('R4 verwerkt een uit Excel verwijderde dienst als lege import-draft zonder historie te wissen', async () => {
    const db = await readyDb();
    try {
        await insertShift(db);
        await importLegacyRosterToCanonical(db);
        const draft = await get(db, `SELECT id, revision FROM roster_versions WHERE state='draft'`);
        await run(db, `DELETE FROM roster_items`);

        const report = await importLegacyRosterToCanonical(db);
        const after = await get(db, `SELECT revision FROM roster_versions WHERE id=?`, [draft.id]);
        assert.equal(report.periods[0].action, 'reconciled_draft');
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_shifts WHERE version_id=?`, [draft.id])).count), 0);
        assert.equal(after.revision, draft.revision + 1);
    } finally {
        await close(db);
    }
});
