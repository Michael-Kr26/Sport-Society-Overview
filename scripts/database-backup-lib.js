'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DEFAULT_REQUIRED_TABLES = ['users', 'auth_sessions', 'changes', 'roster_imports', 'roster_items'];

function sqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
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

async function backupDatabase(sourcePath, destinationPath) {
    const source = path.resolve(sourcePath);
    const destination = path.resolve(destinationPath);
    if (!fs.existsSync(source)) throw new Error(`Database niet gevonden: ${source}`);
    if (fs.existsSync(destination)) throw new Error(`Back-upbestemming bestaat al: ${destination}`);

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const db = new sqlite3.Database(source);
    db.configure('busyTimeout', 10000);
    try {
        await exec(db, 'PRAGMA wal_checkpoint(FULL);');
        await exec(db, `VACUUM INTO ${sqlString(destination)};`);
    } finally {
        await close(db);
    }

    const stats = fs.statSync(destination);
    if (!stats.isFile() || stats.size === 0) throw new Error('De back-up is leeg of ongeldig.');
    return destination;
}

async function verifyDatabase(databasePath, requiredTables = DEFAULT_REQUIRED_TABLES) {
    const resolved = path.resolve(databasePath);
    if (!fs.existsSync(resolved)) throw new Error(`Databasebestand niet gevonden: ${resolved}`);

    const db = new sqlite3.Database(resolved, sqlite3.OPEN_READONLY);
    db.configure('busyTimeout', 5000);
    try {
        const integrity = await get(db, 'PRAGMA integrity_check');
        const integrityValue = Object.values(integrity || {})[0];
        if (String(integrityValue).toLowerCase() !== 'ok') {
            throw new Error(`SQLite integrity_check gaf: ${integrityValue || 'geen resultaat'}`);
        }

        const tables = await all(db, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
        const names = new Set(tables.map((row) => row.name));
        const missing = requiredTables.filter((name) => !names.has(name));
        if (missing.length) throw new Error(`Verplichte basistabellen ontbreken: ${missing.join(', ')}`);

        const counts = {};
        for (const table of requiredTables) {
            const row = await get(db, `SELECT COUNT(*) AS count FROM ${table}`);
            counts[table] = Number(row?.count || 0);
        }
        return { integrity: 'ok', tables: [...names], counts };
    } finally {
        await close(db);
    }
}

async function restoreDatabase(backupPath, targetPath, options = {}) {
    const backup = path.resolve(backupPath);
    const target = path.resolve(targetPath);
    const overwrite = Boolean(options.overwrite);
    await verifyDatabase(backup);

    if (fs.existsSync(target) && !overwrite) {
        throw new Error(`Doeldatabase bestaat al: ${target}. Gebruik expliciet overwrite om te vervangen.`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.restore-${process.pid}-${Date.now()}.tmp`;
    try {
        fs.copyFileSync(backup, temporary);
        await verifyDatabase(temporary);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        fs.renameSync(temporary, target);
        return await verifyDatabase(target);
    } catch (error) {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        throw error;
    }
}

module.exports = {
    DEFAULT_REQUIRED_TABLES,
    backupDatabase,
    restoreDatabase,
    verifyDatabase
};
