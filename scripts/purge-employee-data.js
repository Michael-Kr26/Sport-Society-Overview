'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { purgeEmployeeData } = require('../lib/employee-reset');
const { backupDatabase, verifyDatabase } = require('./database-backup-lib');

const root = path.join(__dirname, '..');
const confirm = process.argv.includes('--confirm');
const dbArgument = process.argv.find((argument) => argument.startsWith('--db='));
const databasePath = dbArgument
    ? path.resolve(dbArgument.slice('--db='.length))
    : path.join(root, 'data', 'sport-society.db');

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

async function main() {
    if (!confirm) {
        throw new Error('Reset niet uitgevoerd. Gebruik expliciet: npm run reset:employees -- --confirm');
    }
    if (!fs.existsSync(databasePath)) {
        throw new Error(`Database niet gevonden: ${databasePath}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(path.dirname(databasePath), 'backups', `pre-employee-reset-${timestamp}.db`);

    await backupDatabase(databasePath, backupPath);
    await verifyDatabase(backupPath, ['users', 'locations', 'employees']);

    const db = new sqlite3.Database(databasePath);
    db.configure('busyTimeout', 10000);
    let result;
    try {
        result = await purgeEmployeeData(db);
    } finally {
        await close(db);
    }

    await verifyDatabase(databasePath, ['users', 'locations', 'employees']);

    console.log('Werknemersadministratie geleegd.');
    console.log(`Back-up: ${backupPath}`);
    console.log(`Medewerkers: ${result.before.employees} -> ${result.after.employees}`);
    if (result.before.hourEmployees !== null) {
        console.log(`Legacy urenmedewerkers: ${result.before.hourEmployees} -> ${result.after.hourEmployees}`);
    }
    if (result.before.excelHourSummaries !== null) {
        console.log(`Excel-urenregels: ${result.before.excelHourSummaries} -> ${result.after.excelHourSummaries}`);
    }
    console.log(`Roosterdiensten losgekoppeld van oude medewerkers: ${result.detachedRosterShifts}`);
    console.log(`Oude medewerkerpatronen verwijderd: ${result.deletedRosterPatterns}`);
    console.log('Gebruikersaccounts, locaties en organisatorische user-location scopes zijn behouden.');
}

main().catch((error) => {
    console.error(`Employee reset mislukt: ${error.message}`);
    process.exitCode = 1;
});
