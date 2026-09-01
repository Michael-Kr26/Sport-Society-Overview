'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { applyKnownAccessScopes, masterdataReport } = require('../lib/masterdata');
const { applyEmployeeAccountLinks, employeeBaselineReport } = require('../lib/masterdata-r1b');

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
        const employees = await employeeBaselineReport(db);
        const access = await applyKnownAccessScopes(db);
        const employeeLinks = await applyEmployeeAccountLinks(db);
        console.log('\n=== R1 masterdata ===');
        console.table([report.meta]);
        console.log('\nLocaties');
        console.table(report.locations);
        console.log('\nLegacy naamaliases');
        console.table(report.aliases);
        console.log('\nR1B medewerkersbaseline');
        console.table(employees.map((employee) => ({
            code: employee.employeeCode || null,
            naam: employee.displayName,
            type: employee.employmentType,
            contractUren: employee.weeklyMinutes === null ? null : employee.weeklyMinutes / 60,
            primair: employee.primaryLocationCode,
            inzetbaar: employee.eligibleLocationCodes?.join(', ') || '',
            gewensteRol: employee.targetRole,
            account: employee.account?.username || null
        })));
        console.log('\nAccess-seeds');
        console.table(report.accessSeeds);
        console.log(`\nMedewerkers in nieuwe masterdata: ${report.employeeCount}`);
        console.log('\nGekoppelde manager/admin-scopes');
        console.table(access.applied);
        if (access.roleMismatches.length) {
            console.log('\nRolafwijkingen bij manager/admin-scopes (bewust niet automatisch aangepast)');
            console.table(access.roleMismatches);
        }
        if (access.unresolved.length) {
            console.log('\nNog niet gekoppelde manager/admin-scopes');
            console.table(access.unresolved);
        }
        console.log('\nUser↔employee-koppelingen');
        console.table(employeeLinks.linked);
        if (employeeLinks.roleMismatches.length) {
            console.log('\nAccountrollen die afwijken van R1B-baseline (bewust niet automatisch aangepast)');
            console.table(employeeLinks.roleMismatches);
        }
        if (employeeLinks.ambiguous.length || employeeLinks.conflicts.length) {
            console.log('\nAmbigue/conflicterende accountkoppelingen');
            console.table([...employeeLinks.ambiguous, ...employeeLinks.conflicts]);
        }
        if (employeeLinks.unresolved.length) {
            console.log(`\nMedewerkers zonder exact bestaand account: ${employeeLinks.unresolved.length}`);
        }
        console.log('\nBeschikbaarheid: nog niet aangeleverd en daarom niet ingevuld.');
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('Masterdatarapport mislukt:', error.message);
    process.exitCode = 1;
});
