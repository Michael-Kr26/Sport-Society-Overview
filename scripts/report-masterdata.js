'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { applyKnownAccessScopes, masterdataReport } = require('../lib/masterdata');

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
        const report = await masterdataReport(db);
        const access = await applyKnownAccessScopes(db);
        console.log('\n=== R1 masterdata ===');
        console.table([report.meta]);
        console.log('\nLocaties');
        console.table(report.locations);
        console.log('\nLegacy naamaliases');
        console.table(report.aliases);
        console.log('\nAccess-seeds');
        console.table(report.accessSeeds);
        console.log(`\nMedewerkers in nieuwe masterdata: ${report.employeeCount}`);
        console.log('\nGekoppelde scopes');
        console.table(access.applied);
        if (access.roleMismatches.length) {
            console.log('\nRolafwijkingen (bewust niet automatisch aangepast)');
            console.table(access.roleMismatches);
        }
        if (access.unresolved.length) {
            console.log('\nNog niet gekoppeld');
            console.table(access.unresolved);
        }
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('Masterdatarapport mislukt:', error.message);
    process.exitCode = 1;
});
