'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('./lib/masterdata-r1b');
const { migrateRosterData } = require('./lib/roster-data');
const { migrateRosterDomain } = require('./lib/roster-domain');
const { migrateRosterPublication } = require('./lib/roster-publication');

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
        await migrateRosterDomain(db);
        const report = await migrateRosterPublication(db);
        if (!quiet) {
            console.log('R6 publicatielaag voorbereid.');
            console.log(`CML-koppelingen: ${report.cmlLinks}.`);
            console.log(`Notificaties in outbox: ${report.pendingNotifications}.`);
        }
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R6 publicatiemigratie mislukt:', error);
    process.exitCode = 1;
});
