'use strict';

const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const {
    activeLocationScopes,
    minimumRoleForApi,
    minimumRoleForPage,
    roleAllows
} = require('./lib/roster-access');

const expressPath = require.resolve('express');
const originalExpress = require('express');
let app = null;

require.cache[expressPath].exports = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./roster-planner-bootstrap');
require.cache[expressPath].exports = originalExpress;

if (!app) throw new Error('Express-app kon niet worden gekoppeld aan R7-toegangscontrole.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});

// Schemawijzigingen horen bij de expliciete pre-start migraties. De runtime
// gebruikt daarna alleen het reeds voorbereide schema om dubbele SQLite-writes
// op meerdere bootstrapverbindingen te voorkomen.
const accessReady = Promise.resolve();

function parseCookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return cookies;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function authenticatedUser(req) {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    if (!token) return null;
    return get(
        `SELECT users.id, users.username, users.display_name AS displayName, users.role,
                users.is_active AS isActive
         FROM auth_sessions
         INNER JOIN users ON users.id=auth_sessions.user_id
         WHERE auth_sessions.token_hash=?
           AND datetime(auth_sessions.expires_at)>datetime('now')
           AND users.is_active=1
         LIMIT 1`,
        [hashSessionToken(token)]
    );
}

function effectiveDateFromRequest(req) {
    const candidates = [
        req.query?.weekStart,
        req.body?.weekStart,
        req.body?.date,
        req.query?.from
    ];
    const value = candidates.find((candidate) => /^\d{4}-\d{2}-\d{2}$/.test(String(candidate || '')));
    return value || new Date().toISOString().slice(0, 10);
}

async function accessGuard(req, res, next) {
    try {
        await accessReady;
        const pageMinimum = minimumRoleForPage(req.path);
        const apiMinimum = minimumRoleForApi(req.path);
        const minimumRole = apiMinimum || pageMinimum;
        if (!minimumRole) return next();

        const user = await authenticatedUser(req);
        const role = user?.role || 'guest';
        if (roleAllows(role, minimumRole)) return next();

        if (apiMinimum) {
            if (!user) return res.status(401).json({ message: 'Log eerst in.' });
            return res.status(403).json({ message: 'Je hebt geen toegang tot deze roosterfunctie.' });
        }

        const page = String(req.path || '').split('/').pop();
        if (!user) return res.redirect(`/login.html?next=${encodeURIComponent(page)}`);
        return res.redirect('/index.html');
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ message: 'De toegangscontrole kon niet worden uitgevoerd.' });
    }
}

app.get('/api/access/roster-policy', async (req, res) => {
    try {
        await accessReady;
        const user = await authenticatedUser(req);
        if (!user) {
            return res.status(401).json({ message: 'Log eerst in.' });
        }
        const effectiveDate = effectiveDateFromRequest(req);
        const scopes = user.role === 'manager'
            ? await activeLocationScopes(db, user.id, effectiveDate)
            : [];
        res.json({
            role: user.role,
            effectiveDate,
            permissions: {
                canViewPublishedRoster: ['employee', 'manager', 'admin'].includes(user.role),
                canOpenPlanner: user.role === 'admin',
                canEditRoster: user.role === 'admin',
                canPublish: user.role === 'admin'
            },
            locationScopes: scopes.map((scope) => ({
                ...scope,
                canEditRoster: false,
                canPublishRoster: false
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Roosterrechten konden niet worden geladen.' });
    }
});

app.use(accessGuard);

const router = app.router || app._router;
if (router?.stack?.length) {
    const guardLayer = router.stack.pop();
    const firstProtectedTarget = router.stack.findIndex((layer) => layer.route || layer.name === 'serveStatic');
    router.stack.splice(firstProtectedTarget >= 0 ? firstProtectedTarget : 0, 0, guardLayer);
}

module.exports = {
    accessGuard,
    accessReady,
    authenticatedUser
};