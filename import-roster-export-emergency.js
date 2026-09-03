'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { restoreMonthlyExport } = require('./lib/roster-export-restore');

const args = process.argv.slice(2);
const filePath = args.find((arg) => !arg.startsWith('--'));
const username = args.filter((arg) => !arg.startsWith('--'))[1];
const commit = args.includes('--commit');

if (!filePath || !username) {
    console.error('Gebruik: node import-roster-export-emergency.js <export.xlsx> <admin-gebruikersnaam> [--commit]');
    process.exit(1);
}

const absolutePath = path.resolve(filePath);
if (!fs.existsSync(absolutePath)) {
    console.error(`Bestand niet gevonden: ${absolutePath}`);
    process.exit(1);
}

const dbPath = path.join(__dirname, 'data', 'sport-society.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);
const get = (sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));

(async () => {
    const user = await get(`SELECT id, username, role, is_active AS isActive FROM users WHERE username=?`, [username]);
    if (!user || !user.isActive || user.role !== 'admin') {
        throw new Error('Opgegeven gebruiker is geen actieve Admin.');
    }
    const buffer = fs.readFileSync(absolutePath);
    const result = await restoreMonthlyExport(db, {
        buffer,
        actorUserId: user.id,
        dryRun: !commit
    });
    console.log(`Export: ${result.exportUid}`);
    console.log(`Maand: ${result.month}`);
    console.log(`Gecontroleerde locatie/weken: ${result.periodCount}`);
    console.log(`Diensten in export: ${result.shiftCount}`);
    if (!commit) {
        console.log('Dry-run geslaagd. Er is niets gewijzigd. Voeg --commit toe om concepten aan te maken.');
    } else {
        const errors = result.validation.reduce((sum, item) => sum + item.validation.errors.length, 0);
        const warnings = result.validation.reduce((sum, item) => sum + item.validation.warnings.length, 0);
        console.log(`Concepten aangemaakt: ${result.drafts.length}`);
        console.log(`Validatie: ${errors} blokkade(s), ${warnings} waarschuwing(en).`);
        console.log('Er is niets gepubliceerd. Controleer de concepten in de Planner en publiceer als Admin.');
    }
})()
    .catch((error) => {
        console.error(`${error.code ? `${error.code}: ` : ''}${error.message}`);
        if (error.details) console.error(JSON.stringify(error.details, null, 2));
        process.exitCode = 1;
    })
    .finally(() => db.close());
