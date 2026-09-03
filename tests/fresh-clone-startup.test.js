'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.resolve(__dirname, '..');

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

test('npm start initialiseert R1 masterdata vóór R9 exportmigratie', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const start = packageJson.scripts.start;
    const masterdataIndex = start.indexOf('migrate-masterdata.js --quiet');
    const exportIndex = start.indexOf('migrate-roster-export.js --quiet');

    assert.ok(masterdataIndex >= 0, 'startscript moet R1 masterdata initialiseren');
    assert.ok(exportIndex > masterdataIndex, 'R1 masterdata moet vóór R9 exportmigratie draaien');
});

test('migrate-masterdata kan stil een volledig lege database initialiseren', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-fresh-clone-'));
    const dbPath = path.join(tempDir, 'fresh.db');
    const result = spawnSync(process.execPath, ['migrate-masterdata.js', '--quiet', dbPath], {
        cwd: ROOT,
        encoding: 'utf8'
    });

    try {
        assert.equal(result.status, 0, result.stderr || 'masterdatamigratie faalde');
        assert.equal(result.stdout.trim(), '', 'quiet migratie hoort geen routine-output te geven');

        const db = new sqlite3.Database(dbPath);
        try {
            const locations = await get(db, 'SELECT COUNT(*) AS count FROM locations');
            const employees = await get(db, 'SELECT COUNT(*) AS count FROM employees');
            assert.equal(Number(locations.count), 5);
            assert.ok(Number(employees.count) >= 22);
        } finally {
            await close(db);
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('HealthPlanner schema-write retry is begrensd tot SQLITE_BUSY', () => {
    const source = fs.readFileSync(path.join(ROOT, 'healthplanner-bootstrap.js'), 'utf8');
    assert.match(source, /error\?\.code !== 'SQLITE_BUSY'/);
    assert.match(source, /const maxBusyRetries = 5/);
});
