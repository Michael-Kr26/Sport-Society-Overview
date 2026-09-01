'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('./lib/masterdata-r1b');

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
        const report = await migrateR1Masterdata(db);
        console.log(`R1 masterdata voorbereid: ${report.locations.length} locaties, ${report.employees.length} medewerkers, ${report.aliases.length} aliases.`);
        console.log(`Planningsbaseline: ${report.meta.planningBaseline}`);
        console.log(`Nieuwe employee-records: ${report.baseline.createdEmployees.length}`);
        console.log(`Nieuwe dienstverbandbaselines: ${report.baseline.createdEmploymentPeriods.length}`);
        console.log(`Nieuwe contractbaselines: ${report.baseline.createdContractTerms.length}`);
        console.log(`Nieuwe locatie-eligibilities: ${report.baseline.createdEligibility.length}`);
        if (report.baseline.dataMismatches.length) {
            console.warn(`R1B baseline-afwijkingen die bewust niet zijn overschreven: ${report.baseline.dataMismatches.length}.`);
        }
        if (report.employeeLinks.linked.length) console.log(`User↔employee-koppelingen herkend: ${report.employeeLinks.linked.length}`);
        if (report.employeeLinks.roleMismatches.length) {
            console.warn(`Employee-accounts met afwijkende bestaande rol: ${report.employeeLinks.roleMismatches.length}. Rollen zijn niet automatisch aangepast.`);
        }
        if (report.employeeLinks.ambiguous.length || report.employeeLinks.conflicts.length) {
            console.warn(`Employee-accountkoppelingen met conflict/ambiguïteit: ${report.employeeLinks.ambiguous.length + report.employeeLinks.conflicts.length}.`);
        }
        if (report.access.applied.length) console.log(`Access-scopes gekoppeld: ${report.access.applied.length}`);
        if (report.access.roleMismatches.length) {
            console.warn(`Access-seeds met afwijkende bestaande rol: ${report.access.roleMismatches.length}. Rollen zijn niet automatisch aangepast.`);
        }
        if (report.access.unresolved.length) console.warn(`Nog niet gekoppelde access-seeds: ${report.access.unresolved.length}.`);
        console.log('Beschikbaarheid is nog niet ingevuld; R1B maakt daar geen aannames over.');
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R1 masterdatamigratie mislukt:', error);
    process.exitCode = 1;
});
