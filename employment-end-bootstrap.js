const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const expressPath = require.resolve('express');
const express = require('express');
let app = null;
require.cache[expressPath].exports = new Proxy(express, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./hours-link-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan het uitdienstbeheer.');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'sport-society.db'));
db.configure('busyTimeout', 5000);

const COOKIE = 'sso_session';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTable(table, attempts = 120) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = await get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (row) return true;
        await sleep(50);
    }
    return false;
}

async function waitForEmployee(employeeName, attempts = 120) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = await get('SELECT employee_name FROM hour_employee_settings WHERE employee_name=? COLLATE NOCASE', [employeeName]);
        if (row) return true;
        await sleep(50);
    }
    return false;
}

async function transaction(work) {
    await run('BEGIN IMMEDIATE');
    try {
        const result = await work();
        await run('COMMIT');
        return result;
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function setEmploymentEnd(employeeName, activeUntil, updatedBy) {
    await transaction(async () => {
        await run(`UPDATE hour_employee_settings
            SET active_until=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
            WHERE employee_name=? COLLATE NOCASE`, [activeUntil, updatedBy, employeeName]);

        if (activeUntil) {
            await run(`UPDATE hour_contract_periods
                SET effective_to=?
                WHERE employee_name=? COLLATE NOCASE
                  AND date(effective_from)<=date(?)
                  AND (effective_to IS NULL OR date(effective_to)>date(?))`,
            [activeUntil, employeeName, activeUntil, activeUntil]);
        }
    });
}

async function ensureEmploymentEnd() {
    if (!await waitForTable('hour_employee_settings')) {
        throw new Error('De medewerkerstabel kon niet worden voorbereid.');
    }
    const columns = await all('PRAGMA table_info(hour_employee_settings)');
    if (!columns.some((column) => column.name === 'active_until')) {
        await run('ALTER TABLE hour_employee_settings ADD COLUMN active_until TEXT');
    }

    // Aangeleverde personeelswijziging: 17 juli 2026 is Mario's laatste werkdag.
    // Alleen invullen wanneer nog geen datum is ingesteld, zodat latere adminwijzigingen behouden blijven.
    if (await waitForEmployee('Mario')) {
        const mario = await get(`SELECT active_until AS activeUntil FROM hour_employee_settings
            WHERE employee_name='Mario' COLLATE NOCASE`);
        if (!mario?.activeUntil) {
            await setEmploymentEnd('Mario', '2026-07-17', 'Aangeleverde laatste werkdag');
        }
    }
}
const ready = ensureEmploymentEnd();

function cookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((result, part) => {
        const index = part.indexOf('=');
        if (index > -1) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        return result;
    }, {});
}
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function authenticatedUser(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    return get(`SELECT users.id, users.username, users.display_name AS displayName, users.role
        FROM auth_sessions JOIN users ON users.id=auth_sessions.user_id
        WHERE auth_sessions.token_hash=? AND datetime(auth_sessions.expires_at)>datetime('now')
          AND users.is_active=1 LIMIT 1`, [tokenHash(token)]);
}

function requireRole(handler, adminOnly = false) {
    return async (req, res) => {
        try {
            await ready;
            const user = await authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in om medewerkerstatussen te bekijken.' });
            if (adminOnly ? user.role !== 'admin' : !['manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
            }
            await handler(req, res, user);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.status(error.status || 500).json({ message: error.message || 'De uitdienstdatum kon niet worden verwerkt.' });
        }
    };
}

app.get('/api/hours/employment-status', requireRole(async (req, res) => {
    const rows = await all(`SELECT employee_name AS employeeName, active_from AS activeFrom,
        active_until AS activeUntil, is_active AS isActive, updated_by AS updatedBy,
        updated_at AS updatedAt
        FROM hour_employee_settings ORDER BY LOWER(employee_name)`);
    res.json({
        employees: rows.map((row) => ({
            ...row,
            isActive: Boolean(row.isActive)
        }))
    });
}));

app.put('/api/hours/employment-status/:employeeName', requireRole(async (req, res, user) => {
    const employeeName = String(req.params.employeeName || '').trim();
    const activeUntil = String(req.body.activeUntil || '').trim() || null;
    if (!employeeName || employeeName.length > 120) {
        return res.status(400).json({ message: 'Kies een geldige medewerker.' });
    }
    if (activeUntil && !DATE_RE.test(activeUntil)) {
        return res.status(400).json({ message: 'Vul een geldige laatste werkdag in.' });
    }
    const employee = await get(`SELECT employee_name AS employeeName, active_from AS activeFrom
        FROM hour_employee_settings WHERE employee_name=? COLLATE NOCASE`, [employeeName]);
    if (!employee) return res.status(404).json({ message: 'Medewerker niet gevonden.' });
    if (activeUntil && employee.activeFrom && activeUntil < employee.activeFrom) {
        return res.status(400).json({ message: 'De laatste werkdag mag niet vóór de startdatum liggen.' });
    }

    await setEmploymentEnd(employee.employeeName, activeUntil, user.displayName || user.username);
    res.json({
        message: activeUntil
            ? `${employee.employeeName} blijft zichtbaar tot en met ${activeUntil}; een lopend contract is op die datum beëindigd.`
            : `De laatste werkdag van ${employee.employeeName} is verwijderd. Bestaande contractstops blijven ongewijzigd.`
    });
}, true));
