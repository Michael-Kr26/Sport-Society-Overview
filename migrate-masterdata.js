'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateMasterdata } = require('./lib/masterdata');

const quiet = process.argv.includes('--quiet');
const explicitDatabasePath = process.argv.slice(2).find((argument) => argument !== '--quiet');
const databasePath = explicitDatabasePath
    ? path.resolve(explicitDatabasePath)
    : path.join(__dirname, 'data', 'sport-society.db');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new sqlite3.Database(databasePath);
db.configure('busyTimeout', 10000);

function close() {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

function log(...args) {
    if (!quiet) console.log(...args);
}

(async () => {
    try {
        const report = await migrateMasterdata(db);
        log(`Masterdata voorbereid: ${report.locations.length} locaties, ${report.employeeCount} bestaande medewerkers.`);
        log(`Planningsbaseline: ${report.meta.planningBaseline}`);
        log('Medewerkers, contracten, aliases en account-scopes worden niet meer vanuit code geseed.');
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('Masterdatamigratie mislukt:', error);
    process.exitCode = 1;
});
