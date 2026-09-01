'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('./lib/masterdata-r1b');
const { migrateRosterData } = require('./lib/roster-data');
const { migrateRosterDomain } = require('./lib/roster-domain');
const {
    DEFAULT_BASELINE,
    importLegacyRosterToCanonical,
    migrateLegacyRosterAdapter
} = require('./lib/legacy-roster-adapter');

const databasePath = process.argv[2]
    ? path.resolve(process.argv[2])
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
        await migrateLegacyRosterAdapter(db);
        const report = await importLegacyRosterToCanonical(db, { planningBaseline: DEFAULT_BASELINE });

        console.log('\nR4 legacy → canonical adapter afgerond.');
        console.log(`Paritystatus: ${report.parityStatus}`);
        console.log(`Bronitems vanaf ${report.planningBaseline}: ${report.totals.sourceItems}`);
        console.log(`Bronshifts: ${report.totals.sourceShiftItems}`);
        console.log(`Naar canonical gemapte shifts: ${report.totals.mappedShiftItems}`);
        console.log(`Niet-shift items veilig gestaged: ${report.totals.stagedNonshiftItems}`);
        console.log(`Onopgeloste items: ${report.totals.unresolvedItems}`);
        console.log(`Beschermde drafts: ${report.totals.protectedPeriods}`);
        console.log('Published V2-versies zijn niet gewijzigd.');

        if (report.unresolved.length) {
            console.log('\nOnopgeloste legacy-items:');
            console.table(report.unresolved.slice(0, 25));
        }
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R4 canonical roosterimport mislukt:', error);
    process.exitCode = 1;
});
