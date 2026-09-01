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

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    await migrateRosterDomain(db);
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
        VALUES ('test_excel', 'fixture.xlsx', 'success', 1)`);
    await migrateLegacyRosterAdapter(db);
    return db;
}

test('R5 handmatige override-marker voorkomt dat een latere Excel-import de draft overschrijft', async () => {
    const db = await readyDb();
    try {
        await run(db, `INSERT INTO roster_items
            (import_id, roster_date, day_name, employee_name, source_slot_employee, item_type,
             location, start_time, end_time, status, source_sheet, source_cell, source_hash)
            VALUES (1, '2026-09-07', 'maandag', 'Michael', 'Michael', 'shift',
                    'Achterveld', '18:30', '21:00', 'Werkdienst', 'Sep 26', 'C2', 'BASE-R5')`);
        await importLegacyRosterToCanonical(db);

        const draft = await get(db, `SELECT v.id FROM roster_versions v
            WHERE v.state='draft' LIMIT 1`);
        const legacyShift = await get(db, `SELECT shift_uid AS shiftUid FROM roster_shifts
            WHERE version_id=?`, [draft.id]);
        await run(db, `UPDATE roster_shifts SET ends_at_utc='2026-09-07T19:30:00.000Z'
            WHERE version_id=? AND shift_uid=?`, [draft.id, legacyShift.shiftUid]);
        await run(db, `INSERT INTO roster_pattern_exceptions
            (version_id, shift_uid, pattern_id, exception_type, note)
            VALUES (?, ?, NULL, 'override', 'Handmatig gewijzigd via weekplanner')`,
        [draft.id, legacyShift.shiftUid]);

        await run(db, `UPDATE roster_items SET end_time='22:00' WHERE source_hash='BASE-R5'`);
        const report = await importLegacyRosterToCanonical(db);
        const preserved = await get(db, `SELECT ends_at_utc AS endsAtUtc FROM roster_shifts
            WHERE version_id=? AND shift_uid=?`, [draft.id, legacyShift.shiftUid]);

        assert.equal(report.parityStatus, 'attention');
        assert.equal(report.periods[0].action, 'protected_draft');
        assert.equal(preserved.endsAtUtc, '2026-09-07T19:30:00.000Z');
    } finally {
        await close(db);
    }
});

test('R5 suppress-marker voorkomt dat een handmatig verwijderde legacy-dienst terugkomt', async () => {
    const db = await readyDb();
    try {
        await run(db, `INSERT INTO roster_items
            (import_id, roster_date, day_name, employee_name, source_slot_employee, item_type,
             location, start_time, end_time, status, source_sheet, source_cell, source_hash)
            VALUES (1, '2026-09-07', 'maandag', 'Michael', 'Michael', 'shift',
                    'Achterveld', '18:30', '21:00', 'Werkdienst', 'Sep 26', 'C2', 'BASE-R5-REMOVE')`);
        await importLegacyRosterToCanonical(db);

        const draft = await get(db, `SELECT v.id FROM roster_versions v WHERE v.state='draft' LIMIT 1`);
        const shift = await get(db, `SELECT shift_uid AS shiftUid FROM roster_shifts WHERE version_id=?`, [draft.id]);
        await run(db, 'DELETE FROM roster_shifts WHERE version_id=? AND shift_uid=?', [draft.id, shift.shiftUid]);
        await run(db, `INSERT INTO roster_pattern_exceptions
            (version_id, shift_uid, pattern_id, exception_type, note)
            VALUES (?, ?, NULL, 'suppress', 'Handmatig verwijderd via weekplanner')`, [draft.id, shift.shiftUid]);

        const report = await importLegacyRosterToCanonical(db);
        const count = Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_shifts WHERE version_id=?', [draft.id])).count);

        assert.equal(report.parityStatus, 'attention');
        assert.equal(report.periods[0].action, 'protected_draft');
        assert.equal(count, 0);
    } finally {
        await close(db);
    }
});
