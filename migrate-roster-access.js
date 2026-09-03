'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { migrateRosterAccess } = require('./lib/roster-access');

const quiet = process.argv.includes('--quiet');
const dbPath = path.join(__dirname, 'data', 'sport-society.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 10000);

migrateRosterAccess(db)
    .then((result) => {
        if (!quiet) console.log(`R7 toegangsmigratie gereed. Manager-scopes: ${result.managerScopes}.`);
    })
    .catch((error) => {
        console.error('R7 toegangsmigratie mislukt:', error.message);
        process.exitCode = 1;
    })
    .finally(() => db.close());
