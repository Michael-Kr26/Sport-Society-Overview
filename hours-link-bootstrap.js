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
require('./manager-standards-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de urenlinker.');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'sport-society.db'));
db.configure('busyTimeout', 5000);
const COOKIE = 'sso_session';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

async function waitForTable(table, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = await get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (row) return true;
        await sleep(50);
    }
    return false;
}

async function ensureDeclaredHoursColumn() {
    const exists = await waitForTable('roster_items', 1);
    if (!exists) return false;
    const columns = await all('PRAGMA table_info(roster_items)');
    if (!columns.some((column) => column.name === 'declared_hours')) {
        await run('ALTER TABLE roster_items ADD COLUMN declared_hours REAL');
    }
    return true;
}

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

function shiftHours(startTime, endTime) {
    const parse = (value) => {
        const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const start = parse(startTime);
    const end = parse(endTime);
    if (start === null || end === null) return 0;
    return round(((end <= start ? end + 1440 : end) - start) / 60);
}

app.get('/api/hours/declared-corrections', async (req, res) => {
    try {
        const user = await authenticatedUser(req);
        if (!user) return res.status(401).json({ message: 'Log eerst in om de gekoppelde uren te bekijken.' });
        if (!['manager', 'admin'].includes(user.role)) return res.status(403).json({ message: 'Je hebt geen toegang tot deze uren.' });
        const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
        if (!await ensureDeclaredHoursColumn()) return res.json({ month, employees: [] });

        const rows = await all(`SELECT employee_name AS employeeName, roster_date AS rosterDate,
            start_time AS startTime, end_time AS endTime, declared_hours AS declaredHours
            FROM roster_items
            WHERE item_type='shift' AND declared_hours IS NOT NULL
              AND date(roster_date) < date(?, '+1 month')
            ORDER BY date(roster_date)`, [`${month}-01`]);
        const employees = new Map();
        for (const row of rows) {
            const employeeKey = String(row.employeeName || '').trim().toLocaleLowerCase('nl-NL');
            const rowMonth = String(row.rosterDate || '').slice(0, 7);
            if (!employeeKey || !MONTH_RE.test(rowMonth)) continue;
            if (!employees.has(employeeKey)) employees.set(employeeKey, { employeeName: row.employeeName, months: {} });
            const employee = employees.get(employeeKey);
            const current = employee.months[rowMonth] || { correction: 0, linkedShifts: 0 };
            current.correction = round(current.correction + round(Number(row.declaredHours) - shiftHours(row.startTime, row.endTime)));
            current.linkedShifts += 1;
            employee.months[rowMonth] = current;
        }
        res.json({ month, source: 'Excel-kolom Uren', employees: [...employees.values()] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'De gekoppelde roosteruren konden niet worden berekend.' });
    }
});

ensureDeclaredHoursColumn().catch((error) => console.warn('Kolom declared_hours kon nog niet worden voorbereid.', error.message));
