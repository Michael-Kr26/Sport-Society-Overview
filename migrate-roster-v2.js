'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('./lib/masterdata-r1b');
const { migrateRosterData } = require('./lib/roster-data');

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
        const report = await migrateRosterData(db);
        console.log('R2 rooster-datalaag voorbereid.');
        console.log(`Beschikbaarheidscategorieën: ${report.availabilitySlots.length}`);
        console.log(`Publicatiehorizon: minimaal ${report.settings.minimumPublishedHorizonWeeks} weken, streef ${report.settings.targetPublishedHorizonWeeks} weken.`);
        console.log(`Generatorhorizon: ${report.settings.generationHorizonWeeks} weken.`);
        console.log(`Publicatierecht: ${report.settings.publicationRole}.`);
        console.log('Beschikbaarheidsrecords blijven leeg totdat de terugkoppeling van medewerkers compleet is.');
    } finally {
        await close();
    }
})().catch((error) => {
    console.error('R2 rooster-datamigratie mislukt:', error);
    process.exitCode = 1;
});
