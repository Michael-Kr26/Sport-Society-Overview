const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const projectRoot = path.join(__dirname, '..');
const dataDirectory = path.join(projectRoot, 'data');
const sourcePath = path.join(dataDirectory, 'sport-society.db');
const backupDirectory = path.join(dataDirectory, 'backups');

function timestamp() {
    const date = new Date();
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

function sqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (error) => error ? reject(error) : resolve());
    });
}

function close(db) {
    return new Promise((resolve, reject) => {
        db.close((error) => error ? reject(error) : resolve());
    });
}

async function main() {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Database niet gevonden: ${sourcePath}`);
    }

    fs.mkdirSync(backupDirectory, { recursive: true });
    const destination = path.join(backupDirectory, `sport-society-${timestamp()}.db`);
    const db = new sqlite3.Database(sourcePath);
    db.configure('busyTimeout', 10000);

    try {
        await exec(db, `PRAGMA wal_checkpoint(FULL); VACUUM INTO ${sqlString(destination)};`);
    } finally {
        await close(db);
    }

    const stats = fs.statSync(destination);
    if (!stats.isFile() || stats.size === 0) {
        throw new Error('De back-up is aangemaakt maar bevat geen geldige bestandsgrootte.');
    }

    console.log(`Databaseback-up aangemaakt: ${destination}`);
    console.log(`Bestandsgrootte: ${stats.size} bytes`);
    console.log(`BACKUP_PATH=${destination}`);
}

main().catch((error) => {
    console.error('Databaseback-up mislukt:', error.message);
    process.exit(1);
});
