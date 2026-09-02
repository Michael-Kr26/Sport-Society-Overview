'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateRosterPublication } = require('./lib/roster-publication');
const { migrateRosterOperations } = require('./lib/roster-operations');

const quiet = process.argv.includes('--quiet');
const databaseArgument = process.argv.slice(2).find((argument) => argument !== '--quiet');
const databasePath = databaseArgument
    ? path.resolve(databaseArgument)
    : path.join(__dirname, 'data', 'sport-society.db');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new sqlite3.Database(databasePath);
db.configure('busyTimeout', 10000);

function close() {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

(async () => {
    try {
        await migrateRosterPublication(db);
        const report = await migrateRosterOperations(db);
        if (!quiet) {
            console.log('R8 staffing- en urenlaag voorbereid.');
            console.log(`Actieve coveragevensters: ${report.coverageWindowCount}.`);
            console.log(`Primaire roosterbron: ${report.publishedShiftSource}.`);
        }
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R8 operations-migratie mislukt:', error);
    process.exitCode = 1;
});
