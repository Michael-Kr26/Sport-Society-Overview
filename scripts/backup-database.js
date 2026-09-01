'use strict';

const fs = require('fs');
const path = require('path');
const { backupDatabase } = require('./database-backup-lib');

const projectRoot = path.join(__dirname, '..');
const defaultSource = path.join(projectRoot, 'data', 'sport-society.db');
const defaultBackupDirectory = path.join(projectRoot, 'data', 'backups');

function timestamp() {
    const date = new Date();
    const part = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

async function main() {
    const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;
    const backupDirectory = process.argv[3] ? path.resolve(process.argv[3]) : defaultBackupDirectory;
    fs.mkdirSync(backupDirectory, { recursive: true });
    const destination = path.join(backupDirectory, `sport-society-${timestamp()}.db`);
    await backupDatabase(sourcePath, destination);
    const stats = fs.statSync(destination);
    console.log(`Databaseback-up aangemaakt: ${destination}`);
    console.log(`Bestandsgrootte: ${stats.size} bytes`);
    console.log(`BACKUP_PATH=${destination}`);
}

main().catch((error) => {
    console.error('Databaseback-up mislukt:', error.message);
    process.exit(1);
});
