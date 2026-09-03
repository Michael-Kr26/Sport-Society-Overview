const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { METRICS, DOMAIN_LABELS } = require('./healthplanner-metrics');

const expressPath = require.resolve('express');
const express = require('express');
let app = null;
require.cache[expressPath].exports = new Proxy(express, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./insights-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de HealthPlanner-module.');

const ROOT_DIR = __dirname;
const DB_PATH = path.join(ROOT_DIR, 'data', 'sport-society.db');
const COOKIE = 'sso_session';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp', 'Sport Society totaal'];
const SCOPES = ['day', 'month_to_date'];
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 10000);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const runOnce = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
async function run(sql, params = []) {
    const maxBusyRetries = 5;
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await runOnce(sql, params);
        } catch (error) {
            if (error?.code !== 'SQLITE_BUSY' || attempt >= maxBusyRetries) throw error;
            await sleep(100 * (attempt + 1));
        }
    }
}
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const ready = (async () => {
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
    await ensureColumn('healthplanner_metrics', 'report_date', 'TEXT');
    await ensureColumn('healthplanner_metrics', 'metric_label', 'TEXT');
    await ensureColumn('healthplanner_metrics', 'metric_domain', 'TEXT');
    await ensureColumn('healthplanner_metrics', 'metric_unit', 'TEXT');
    await ensureColumn('healthplanner_metrics', 'note', 'TEXT');
    await run(`CREATE TABLE IF NOT EXISTS healthplanner_metric_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_id INTEGER NOT NULL,
        previous_import_id INTEGER NOT NULL,
        replacement_import_id INTEGER NOT NULL,
        previous_value REAL,
        replacement_value REAL,
        previous_source_hash TEXT,
        replacement_source_hash TEXT,
        revised_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (metric_id) REFERENCES healthplanner_metrics(id) ON DELETE RESTRICT
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_healthplanner_report ON healthplanner_metrics(report_date, location, period_type)');
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
            if (!user) return res.status(401).json({ message: 'Log eerst in om HealthPlanner-inzichten te bekijken.' });
            if (adminOnly ? user.role !== 'admin' : !['manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot HealthPlanner-inzichten.' });
            }
            await handler(req, res, user);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.status(error.status || 500).json({ message: error.message || 'HealthPlanner-inzichten konden niet worden geladen.' });
        }
    };
}

function moveLastLayerBeforeStatic() {
    const router = app.router || app._router;
    if (!router?.stack?.length) return;
    const layer = router.stack.pop();
    const staticIndex = router.stack.findIndex((item) => item.name === 'serveStatic');
    router.stack.splice(staticIndex >= 0 ? staticIndex : 0, 0, layer);
}

app.get('/healthplanner.html', async (req, res, next) => {
    try {
        const user = await authenticatedUser(req);
        if (!user) return res.redirect('/login.html?next=healthplanner.html');
        if (!['manager', 'admin'].includes(user.role)) return res.redirect('/index.html');
        res.sendFile(path.join(ROOT_DIR, 'healthplanner.html'));
    } catch (error) {
        next(error);
    }
});
moveLastLayerBeforeStatic();

function validDate(value) {
    return DATE_RE.test(String(value || '')) ? String(value) : null;
}

function publicRow(row) {
    return {
        id: row.id,
        reportDate: row.reportDate,
        periodDate: row.periodDate,
        periodType: row.periodType,
        location: row.location,
        metricKey: row.metricKey,
        metricLabel: row.metricLabel,
        metricDomain: row.metricDomain,
        metricUnit: row.metricUnit,
        metricValue: row.metricValue === null ? null : Number(row.metricValue),
        note: row.note || '',
        sourceFile: row.sourceFile,
        sourceRow: row.sourceRow,
        importedAt: row.importedAt,
        revisionCount: Number(row.revisionCount || 0)
    };
}

app.get('/api/insights/healthplanner/metrics', requireManagement(async (req, res) => {
    res.json({
        domains: DOMAIN_LABELS,
        metrics: METRICS.map(({ key, label, domain, unit, aggregation }) => ({ key, label, domain, unit, aggregation }))
    });
}));

app.get('/api/insights/healthplanner/imports', requireManagement(async (req, res) => {
    const imports = await all(`SELECT imports.id, imports.source_file AS sourceFile,
        imports.imported_by AS importedBy, imports.imported_at AS importedAt,
        imports.row_count AS rowCount, imports.warning_count AS warningCount,
        COUNT(DISTINCT revisions.id) AS revisionCount
        FROM healthplanner_imports imports
        LEFT JOIN healthplanner_metric_revisions revisions ON revisions.replacement_import_id=imports.id
        GROUP BY imports.id ORDER BY datetime(imports.imported_at) DESC, imports.id DESC LIMIT 50`);
    res.json({ imports: imports.map((item) => ({ ...item, rowCount: Number(item.rowCount), warningCount: Number(item.warningCount), revisionCount: Number(item.revisionCount) })) });
}, true));

app.get('/api/insights/healthplanner', requireManagement(async (req, res, user) => {
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);
    const requestedLocation = LOCATIONS.includes(String(req.query.location || '')) ? String(req.query.location) : null;
    const requestedScope = SCOPES.includes(String(req.query.scope || '')) ? String(req.query.scope) : null;
    const requestedDomain = Object.hasOwn(DOMAIN_LABELS, String(req.query.domain || '')) ? String(req.query.domain) : null;
    const requestedMetric = METRICS.some((metric) => metric.key === String(req.query.metric || '')) ? String(req.query.metric) : null;
    let location = requestedLocation;

    if (user.role === 'manager') {
        if (!user.location) return res.status(409).json({ message: 'Dit manageraccount heeft nog geen vestiging.' });
        location = user.location;
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (from) { where += ' AND COALESCE(metrics.report_date, metrics.period_date)>=?'; params.push(from); }
    if (to) { where += ' AND COALESCE(metrics.report_date, metrics.period_date)<=?'; params.push(to); }
    if (location) { where += ' AND metrics.location=?'; params.push(location); }
    if (requestedScope) { where += ' AND metrics.period_type=?'; params.push(requestedScope); }
    if (requestedDomain) { where += ' AND metrics.metric_domain=?'; params.push(requestedDomain); }
    if (requestedMetric) { where += ' AND metrics.metric_key=?'; params.push(requestedMetric); }

    const rows = await all(`SELECT metrics.id, COALESCE(metrics.report_date, metrics.period_date) AS reportDate,
        metrics.period_date AS periodDate, metrics.period_type AS periodType, metrics.location,
        metrics.metric_key AS metricKey, metrics.metric_label AS metricLabel,
        metrics.metric_domain AS metricDomain, metrics.metric_unit AS metricUnit,
        metrics.metric_value AS metricValue, metrics.note, metrics.source_row AS sourceRow,
        metrics.imported_at AS importedAt, imports.source_file AS sourceFile,
        (SELECT COUNT(*) FROM healthplanner_metric_revisions revisions WHERE revisions.metric_id=metrics.id) AS revisionCount
        FROM healthplanner_metrics metrics
        JOIN healthplanner_imports imports ON imports.id=metrics.import_id
        ${where}
        ORDER BY reportDate, metrics.location, metrics.metric_domain, metrics.metric_key, metrics.period_type`, params);
    const data = rows.map(publicRow);

    const latestByKey = new Map();
    for (const row of data) {
        const key = `${row.location}|${row.metricKey}|${row.periodType}`;
        const current = latestByKey.get(key);
        if (!current || row.reportDate > current.reportDate || (row.reportDate === current.reportDate && row.id > current.id)) latestByKey.set(key, row);
    }
    const latestImport = await get(`SELECT id, source_file AS sourceFile, imported_by AS importedBy,
        imported_at AS importedAt, row_count AS rowCount, warning_count AS warningCount
        FROM healthplanner_imports ORDER BY datetime(imported_at) DESC, id DESC LIMIT 1`);

    res.json({
        filters: { from, to, location, scope: requestedScope, domain: requestedDomain, metric: requestedMetric },
        permissions: {
            canImport: user.role === 'admin',
            allowedLocations: user.role === 'admin' ? LOCATIONS : [user.location]
        },
        summary: {
            rowCount: data.length,
            latestReportDate: data.reduce((latest, row) => !latest || row.reportDate > latest ? row.reportDate : latest, null),
            locationCount: new Set(data.map((row) => row.location)).size,
            metricCount: new Set(data.map((row) => row.metricKey)).size,
            latestImport: latestImport || null
        },
        latest: [...latestByKey.values()],
        rows: data
    });
}));