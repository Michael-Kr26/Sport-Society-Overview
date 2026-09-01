'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('./lib/masterdata-r1b');
const { migrateRosterData } = require('./lib/roster-data');
const { migrateRosterDomain } = require('./lib/roster-domain');

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
        await migrateR1Masterdata(db);
        await migrateRosterData(db);
        const report = await migrateRosterDomain(db);
        if (!quiet) {
            console.log('R3 roosterdomain voorbereid.');
            console.log(`Pattern-exceptions aanwezig: ${report.patternExceptions}.`);
            console.log('R3 gebruikt de R2-datalaag; beschikbaarheid mag nog leeg blijven.');
        }
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R3 roosterdomainmigratie mislukt:', error);
    process.exitCode = 1;
});