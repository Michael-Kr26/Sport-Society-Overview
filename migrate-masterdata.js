'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateMasterdata } = require('./lib/masterdata');

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
        const report = await migrateMasterdata(db);
        console.log(`R1 masterdata voorbereid: ${report.locations.length} locaties, ${report.aliases.length} aliases.`);
        console.log(`Planningsbaseline: ${report.meta.planningBaseline}`);
        if (report.access.applied.length) console.log(`Access-scopes gekoppeld: ${report.access.applied.length}`);
        if (report.access.roleMismatches.length) {
            console.warn(`Access-seeds met afwijkende bestaande rol: ${report.access.roleMismatches.length}. Rollen zijn niet automatisch aangepast.`);
        }
        if (report.access.unresolved.length) {
            console.warn(`Nog niet gekoppelde access-seeds: ${report.access.unresolved.length}. Dit is toegestaan in R1A.`);
        }
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R1 masterdatamigratie mislukt:', error);
    process.exitCode = 1;
});
