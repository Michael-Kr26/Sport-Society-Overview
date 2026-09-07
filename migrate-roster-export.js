'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateRosterExport } = require('./lib/roster-export');
const { migrateCurrentStaffingStandard } = require('./lib/current-staffing-standard');

const quiet = process.argv.includes('--quiet');
const dbPath = path.join(__dirname, 'data', 'sport-society.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

(async () => {
    try {
        const result = await migrateRosterExport(db);
        const staffingStandard = await migrateCurrentStaffingStandard(db);
        if (!quiet) {
            console.log(`R9 exportmigratie gereed. Bestaande exports: ${result.exports}.`);
            console.log(`Bezettingsstandaard v${staffingStandard.version}: ${staffingStandard.activeWindows} actieve vensters, ${staffingStandard.pendingItems} open normpunten.`);
        }
    } catch (error) {
        console.error('R9 exportmigratie mislukt:', error.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
})();
