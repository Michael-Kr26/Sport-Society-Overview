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
require('./employment-end-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de insights-module.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const COOKIE = 'sso_session';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp', 'Sport Society totaal'];
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

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

const ready = (async () => {
    await run(`CREATE TABLE IF NOT EXISTS visitor_frequency_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        imported_by TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_hash)
    )`);
    await run(`CREATE TABLE IF NOT EXISTS visitor_frequency_months (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER NOT NULL,
        period_month TEXT NOT NULL,
        location TEXT NOT NULL,
        total_visits INTEGER,
        active_members INTEGER,
        visit_frequency REAL,
        note TEXT,
        source_row INTEGER,
        source_hash TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(period_month, location),
        FOREIGN KEY (import_id) REFERENCES visitor_frequency_imports(id) ON DELETE RESTRICT
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_visitor_frequency_period ON visitor_frequency_months(period_month, location)');

    await run(`CREATE TABLE IF NOT EXISTS healthplanner_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file TEXT NOT NULL,
        source_hash TEXT NOT NULL UNIQUE,
        imported_by TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0
    )`);
    await run(`CREATE TABLE IF NOT EXISTS healthplanner_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        import_id INTEGER NOT NULL,
        period_date TEXT NOT NULL,
        period_type TEXT NOT NULL,
        location TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        metric_value REAL,
        source_row INTEGER,
        source_hash TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(period_date, period_type, location, metric_key),
        FOREIGN KEY (import_id) REFERENCES healthplanner_imports(id) ON DELETE RESTRICT
    )`);
})();

function cookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((result, part) => {
        const index = part.indexOf('=');
        if (index > -1) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        return result;
    }, {});
}
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function authenticatedUser(req) {
    await ready;
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    return get(`SELECT users.id, users.username, users.display_name AS displayName, users.role, users.location
        FROM auth_sessions JOIN users ON users.id=auth_sessions.user_id
        WHERE auth_sessions.token_hash=? AND datetime(auth_sessions.expires_at)>datetime('now')
          AND users.is_active=1 LIMIT 1`, [tokenHash(token)]);
}

function requireManagement(handler, adminOnly = false) {
    return async (req, res) => {
        try {
            const user = await authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in om managementinzichten te bekijken.' });
            if (adminOnly ? user.role !== 'admin' : !['manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot managementinzichten.' });
            }
            await handler(req, res, user);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.status(error.status || 500).json({ message: error.message || 'Managementinzichten konden niet worden geladen.' });
        }
    };
}

function publicVisitorRow(row) {
    return {
        periodMonth: row.periodMonth,
        location: row.location,
        totalVisits: row.totalVisits === null ? null : Number(row.totalVisits),
        activeMembers: row.activeMembers === null ? null : Number(row.activeMembers),
        visitFrequency: row.visitFrequency === null ? null : Number(row.visitFrequency),
        calculatedFrequency: row.totalVisits !== null && row.activeMembers > 0
            ? Math.round((Number(row.totalVisits) / Number(row.activeMembers)) * 100) / 100
            : null,
        note: row.note || '',
        sourceFile: row.sourceFile,
        sourceRow: row.sourceRow,
        importedAt: row.importedAt
    };
}

app.get('/api/insights/visitor-frequency', requireManagement(async (req, res, user) => {
    const from = MONTH_RE.test(String(req.query.from || '')) ? String(req.query.from) : null;
    const to = MONTH_RE.test(String(req.query.to || '')) ? String(req.query.to) : null;
    let location = LOCATIONS.includes(String(req.query.location || '')) ? String(req.query.location) : null;
    if (user.role === 'manager') {
        if (!user.location) return res.status(409).json({ message: 'Dit manageraccount heeft nog geen vestiging.' });
        location = user.location;
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (from) { where += ' AND months.period_month>=?'; params.push(from); }
    if (to) { where += ' AND months.period_month<=?'; params.push(to); }
    if (location) { where += ' AND months.location=?'; params.push(location); }

    const rows = await all(`SELECT months.period_month AS periodMonth, months.location,
        months.total_visits AS totalVisits, months.active_members AS activeMembers,
        months.visit_frequency AS visitFrequency, months.note, months.source_row AS sourceRow,
        imports.source_file AS sourceFile, months.imported_at AS importedAt
        FROM visitor_frequency_months months
        JOIN visitor_frequency_imports imports ON imports.id=months.import_id
        ${where}
        ORDER BY months.period_month, CASE months.location
            WHEN 'Achterveld' THEN 1 WHEN 'Barneveld' THEN 2 WHEN 'Harskamp' THEN 3
            WHEN 'Voorthuizen' THEN 4 WHEN 'Wekerom' THEN 5 ELSE 6 END`, params);
    const data = rows.map(publicVisitorRow);
    const visits = data.filter((row) => Number.isFinite(row.totalVisits));
    const totalVisits = visits.reduce((sum, row) => sum + row.totalVisits, 0);
    const averageFrequencyValues = data.map((row) => row.visitFrequency ?? row.calculatedFrequency).filter(Number.isFinite);

    res.json({
        filters: { from, to, location },
        permissions: { canImport: user.role === 'admin', allowedLocations: user.role === 'admin' ? LOCATIONS : [user.location] },
        summary: {
            rowCount: data.length,
            totalVisits,
            averageFrequency: averageFrequencyValues.length
                ? Math.round((averageFrequencyValues.reduce((sum, value) => sum + value, 0) / averageFrequencyValues.length) * 100) / 100
                : null,
            firstMonth: data[0]?.periodMonth || null,
            lastMonth: data.at(-1)?.periodMonth || null
        },
        rows: data
    });
}));

app.get('/api/insights/status', requireManagement(async (req, res, user) => {
    const visitorImport = await get(`SELECT id, source_file AS sourceFile, imported_at AS importedAt,
        row_count AS rowCount, warning_count AS warningCount FROM visitor_frequency_imports
        ORDER BY imported_at DESC, id DESC LIMIT 1`);
    const healthPlannerImport = await get(`SELECT id, source_file AS sourceFile, imported_at AS importedAt,
        row_count AS rowCount, warning_count AS warningCount FROM healthplanner_imports
        ORDER BY imported_at DESC, id DESC LIMIT 1`);
    const visitorRange = await get(`SELECT MIN(period_month) AS firstMonth, MAX(period_month) AS lastMonth,
        COUNT(*) AS rowCount FROM visitor_frequency_months`);
    res.json({
        profile: { role: user.role, location: user.location || null },
        visitorFrequency: { latestImport: visitorImport || null, range: visitorRange || null },
        healthPlanner: { latestImport: healthPlannerImport || null, contractStatus: 'mapping_required' }
    });
}));
