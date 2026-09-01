'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { rosterDataReport } = require('../lib/roster-data');

const databasePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'data', 'sport-society.db');
const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READWRITE);
db.configure('busyTimeout', 5000);

function close() {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

(async () => {
    try {
        const report = await rosterDataReport(db);
        console.log('\n=== R2 rooster-datalaag ===');
        console.table([report.settings]);
        console.log('\nBeschikbaarheidscategorieën');
        console.table(report.availabilitySlots);
        console.log('\nDiensttypes');
        console.table(report.shiftTypes.map((shiftType) => ({ shiftType })));
        console.log('\nTabelvulling');
        console.table(Object.entries(report.tableCounts).map(([table, count]) => ({ table, count })));
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R2 roosterdata-rapport mislukt:', error.message);
    process.exitCode = 1;
});
