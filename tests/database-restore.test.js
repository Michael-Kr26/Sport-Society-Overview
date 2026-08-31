'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { backupDatabase, restoreDatabase, verifyDatabase } = require('../scripts/database-backup-lib');

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

async function createFixtureDatabase(filePath) {
    const db = new sqlite3.Database(filePath);
    try {
        await exec(db, `
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
            CREATE TABLE auth_sessions (id INTEGER PRIMARY KEY, user_id INTEGER);
            CREATE TABLE changes (id INTEGER PRIMARY KEY, change_date TEXT);
            CREATE TABLE roster_imports (id INTEGER PRIMARY KEY, source_type TEXT);
            CREATE TABLE roster_items (
                id INTEGER PRIMARY KEY,
                roster_date TEXT,
                employee_name TEXT,
                location TEXT,
                start_time TEXT,
                end_time TEXT,
                source_hash TEXT
            );
            INSERT INTO users (id, username) VALUES (1, 'r0-admin');
            INSERT INTO auth_sessions (id, user_id) VALUES (1, 1);
            INSERT INTO changes (id, change_date) VALUES (1, '2026-09-01');
            INSERT INTO roster_imports (id, source_type) VALUES (1, 'r0_fixture');
            INSERT INTO roster_items (
                id, roster_date, employee_name, location, start_time, end_time, source_hash
            ) VALUES (
                1, '2026-09-01', 'Michael', 'Achterveld', '07:00', '12:00', 'r0-restore-sentinel'
            );
        `);
    } finally {
        await close(db);
    }
}

test('R0 databasebackup kan volledig en intact worden hersteld', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-r0-restore-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    const source = path.join(directory, 'source.db');
    const backup = path.join(directory, 'backup.db');
    const restored = path.join(directory, 'restored.db');

    await createFixtureDatabase(source);
    await backupDatabase(source, backup);
    const backupCheck = await verifyDatabase(backup);
    assert.equal(backupCheck.integrity, 'ok');
    assert.equal(backupCheck.counts.roster_items, 1);

    await restoreDatabase(backup, restored);
    const restoredCheck = await verifyDatabase(restored);
    assert.equal(restoredCheck.integrity, 'ok');
    assert.deepEqual(restoredCheck.counts, backupCheck.counts);

    const db = new sqlite3.Database(restored, sqlite3.OPEN_READONLY);
    try {
        const sentinel = await get(db, `SELECT source_hash AS sourceHash FROM roster_items WHERE id=1`);
        assert.equal(sentinel?.sourceHash, 'r0-restore-sentinel');
    } finally {
        await close(db);
    }
});
