'use strict';

const fs = require('fs');
const path = require('path');
const { verifyDatabase } = require('./database-backup-lib');

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

async function main() {
    const backupPath = requestedPath || latestBackup();
    if (!backupPath || !fs.existsSync(backupPath)) {
        throw new Error('Geen databaseback-up gevonden. Draai eerst npm run backup:db.');
    }
    const result = await verifyDatabase(backupPath);
    console.log(`Back-up gecontroleerd: ${backupPath}`);
    console.log('SQLite-integriteit: OK');
    console.table(result.counts);
}

main().catch((error) => {
    console.error('Back-upcontrole mislukt:', error.message);
    process.exit(1);
});
