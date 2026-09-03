'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateRosterExport } = require('./lib/roster-export');

const quiet = process.argv.includes('--quiet');
const dbPath = path.join(__dirname, 'data', 'sport-society.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

migrateRosterExport(db)
    .then((result) => {
        if (!quiet) console.log(`R9 exportmigratie gereed. Bestaande exports: ${result.exports}.`);
    })
    .catch((error) => {
        console.error('R9 exportmigratie mislukt:', error.message);
        process.exitCode = 1;
    })
    .finally(() => db.close());
