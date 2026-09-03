'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
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

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(child, output, attempts = 80) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (child.exitCode !== null) {
            throw new Error(`npm start stopte vóór de server bereikbaar was.\n${output.join('')}`);
        }
        try {
            const response = await fetch('http://127.0.0.1:3000/login.html', { redirect: 'manual' });
            if (response.status >= 200 && response.status < 500) return;
        } catch {}
        await sleep(250);
    }
    throw new Error(`Server werd niet binnen 20 seconden bereikbaar.\n${output.join('')}`);
}

function stopProcessTree(child, signal = 'SIGTERM') {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(-child.pid, signal);
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}

test('npm start initialiseert R1 masterdata vóór R7/R9 migraties', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const start = packageJson.scripts.start;
    const masterdataIndex = start.indexOf('migrate-masterdata.js --quiet');
    const accessIndex = start.indexOf('migrate-roster-access.js --quiet');
    const exportIndex = start.indexOf('migrate-roster-export.js --quiet');

    assert.ok(masterdataIndex >= 0, 'startscript moet R1 masterdata initialiseren');
    assert.ok(accessIndex > masterdataIndex, 'R7 access moet na R1 masterdata migreren');
    assert.ok(exportIndex > accessIndex, 'R9 exportmigratie moet na R7 access draaien');
});

test('migrate-masterdata initialiseert een lege database zonder medewerkers te fabriceren', async () => {
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
            const aliases = await get(db, 'SELECT COUNT(*) AS count FROM legacy_employee_aliases');
            const accessSeeds = await get(db, 'SELECT COUNT(*) AS count FROM masterdata_access_seeds');
            assert.equal(Number(locations.count), 5);
            assert.equal(Number(employees.count), 0);
            assert.equal(Number(aliases.count), 0);
            assert.equal(Number(accessSeeds.count), 0);
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

test('CI kan npm start vanaf een lege data-map daadwerkelijk bereiken', { skip: !process.env.CI }, async () => {
    const dataDir = path.join(ROOT, 'data');
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(command, ['start', '--silent'], {
        cwd: ROOT,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
    });
    const output = [];
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));

    try {
        await waitForServer(child, output);
    } finally {
        stopProcessTree(child, 'SIGTERM');
        await Promise.race([
            new Promise((resolve) => child.once('exit', resolve)),
            sleep(2000)
        ]);
        if (child.exitCode === null) stopProcessTree(child, 'SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
    }
});
