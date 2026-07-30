const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const projectRoot = path.join(__dirname, '..');
const backupDirectory = path.join(projectRoot, 'data', 'backups');
const requestedPath = process.argv[2] ? path.resolve(process.argv[2]) : null;

function latestBackup() {
    if (!fs.existsSync(backupDirectory)) return null;
    return fs.readdirSync(backupDirectory)
        .filter((name) => /^sport-society-\d{8}-\d{6}\.db$/.test(name))
        .map((name) => {
            const filePath = path.join(backupDirectory, name);
            return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.filePath || null;
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
    return new Promise((resolve, reject) => {
        db.close((error) => error ? reject(error) : resolve());
    });
}

async function main() {
    const backupPath = requestedPath || latestBackup();
    if (!backupPath || !fs.existsSync(backupPath)) {
        throw new Error('Geen databaseback-up gevonden. Draai eerst npm run backup:db.');
    }

    const db = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY);
    db.configure('busyTimeout', 5000);
    try {
        const integrity = await get(db, 'PRAGMA integrity_check');
        const integrityValue = Object.values(integrity || {})[0];
        if (String(integrityValue).toLowerCase() !== 'ok') {
            throw new Error(`SQLite integrity_check gaf: ${integrityValue || 'geen resultaat'}`);
        }

        const tables = await all(db, `SELECT name FROM sqlite_master
            WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
        const names = new Set(tables.map((row) => row.name));
        const required = ['users', 'auth_sessions', 'changes', 'roster_imports', 'roster_items'];
        const missing = required.filter((name) => !names.has(name));
        if (missing.length) {
            throw new Error(`Verplichte basistabellen ontbreken: ${missing.join(', ')}`);
        }

        const counts = {};
        for (const table of required) {
            const row = await get(db, `SELECT COUNT(*) AS count FROM ${table}`);
            counts[table] = Number(row?.count || 0);
        }

        console.log(`Back-up gecontroleerd: ${backupPath}`);
        console.log('SQLite-integriteit: OK');
        console.table(counts);
    } finally {
        await close(db);
    }
}

main().catch((error) => {
    console.error('Back-upcontrole mislukt:', error.message);
    process.exit(1);
});
