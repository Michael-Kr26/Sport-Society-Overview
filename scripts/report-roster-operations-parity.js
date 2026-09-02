'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateRosterOperations, shadowParity } = require('../lib/roster-operations');

const monthArgument = process.argv.slice(2).find((argument) => /^\d{4}-(0[1-9]|1[0-2])$/.test(argument));
const month = monthArgument || new Date().toISOString().slice(0, 7);
const databasePath = path.join(__dirname, '..', 'data', 'sport-society.db');
const db = new sqlite3.Database(databasePath);
db.configure('busyTimeout', 10000);

function close() {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

(async () => {
    try {
        await migrateRosterOperations(db);
        const report = await shadowParity(db, { month });
        console.log(`Rooster V2 shadow parity — ${month}`);
        if (!report.available) {
            console.log(report.message || 'Geen legacyvergelijking beschikbaar.');
            return;
        }
        console.table(report.rows.map((row) => ({
            medewerker: row.employeeName,
            canonical: row.canonicalHours,
            legacy: row.legacyHours,
            delta: row.deltaHours,
            status: row.status
        })));
        console.log(`Gelijk: ${report.summary.match}; verschillend: ${report.summary.different}; alleen V2: ${report.summary.canonicalOnly}; alleen legacy: ${report.summary.legacyOnly}.`);
        console.log(`Totaal V2: ${report.summary.canonicalHours} u; legacy: ${report.summary.legacyHours} u.`);
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R8 shadow parity mislukt:', error);
    process.exitCode = 1;
});
