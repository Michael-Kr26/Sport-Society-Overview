'use strict';

const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { listEmployeeLocations, replaceEmployeeLocations } = require('./lib/employee-locations');

const expressPath = require.resolve('express');
const originalExpress = require('express');
let app = null;

require.cache[expressPath].exports = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./r9-export-bootstrap');
require.cache[expressPath].exports = originalExpress;

if (!app) throw new Error('Express-app kon niet worden gekoppeld aan medewerkerlocaties.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
}

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
    return get(`SELECT users.id, users.username, users.display_name AS displayName, users.role
        FROM auth_sessions
        INNER JOIN users ON users.id=auth_sessions.user_id
        WHERE auth_sessions.token_hash=?
          AND datetime(auth_sessions.expires_at)>datetime('now')
          AND users.is_active=1
        LIMIT 1`, [hashSessionToken(token)]);
}

function requireAdmin(handler) {
    return async (req, res) => {
        try {
            const user = await authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in.' });
            if (user.role !== 'admin') {
                return res.status(403).json({ message: 'Alleen Admin kan medewerkerlocaties wijzigen.' });
            }
            await handler(req, res, user);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) {
                res.status(error.status || 500).json({
                    message: error.status ? error.message : 'Medewerkerlocaties konden niet worden verwerkt.',
                    code: error.code || null
                });
            }
        }
    };
}

app.get('/api/employee-locations/:employeeId', requireAdmin(async (req, res) => {
    const result = await listEmployeeLocations(db, req.params.employeeId, req.query.effectiveDate);
    res.json(result);
}));

app.put('/api/employee-locations/:employeeId', requireAdmin(async (req, res, user) => {
    const result = await replaceEmployeeLocations(db, {
        employeeId: req.params.employeeId,
        primaryLocationCode: req.body.primaryLocationCode,
        eligibleLocationCodes: req.body.eligibleLocationCodes,
        effectiveFrom: req.body.effectiveFrom || undefined,
        note: `Gewijzigd via Medewerkerinstellingen door ${user.displayName || user.username}`
    });
    res.json({ message: 'Medewerkerlocaties opgeslagen.', ...result });
}));

module.exports = { app, db };
