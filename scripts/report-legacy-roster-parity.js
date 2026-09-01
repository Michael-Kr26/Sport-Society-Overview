'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
    latestLegacyParityReport,
    migrateLegacyRosterAdapter
} = require('../lib/legacy-roster-adapter');

const databasePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'data', 'sport-society.db');
const db = new sqlite3.Database(databasePath);
db.configure('busyTimeout', 10000);

function close() {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

(async () => {
    try {
        await migrateLegacyRosterAdapter(db);
        const latest = await latestLegacyParityReport(db);
        if (!latest) {
            console.log('Nog geen R4 parityrapport beschikbaar. Draai eerst npm run import:roster.');
            return;
        }

        console.log('=== R4 legacy → canonical parity ===');
        console.log(`Batch: ${latest.importUid}`);
        console.log(`Aangemaakt: ${latest.createdAt}`);
        console.log(`Baseline: ${latest.planningBaseline}`);
        console.log(`Status: ${latest.parityStatus}`);
        if (!latest.report) return;

        console.table(latest.report.totals);
        console.log('\nPer locatie/week:');
        console.table(latest.report.periods.map((item) => ({
            weekStart: item.weekStart,
            locationId: item.locationId,
            sourceShifts: item.sourceShiftCount,
            canonicalShifts: item.canonicalShiftCount,
            action: item.action,
            detail: item.detail || ''
        })));

        if (latest.report.unresolved.length) {
            console.log('\nOnopgeloste items:');
            console.table(latest.report.unresolved);
        }
        console.log(`\nPublicatieveiligheid: ${latest.report.publicationSafety}`);
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('Parityrapport kon niet worden gemaakt:', error);
    process.exitCode = 1;
});
