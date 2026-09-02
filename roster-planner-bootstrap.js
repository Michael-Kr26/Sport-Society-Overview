'use strict';

const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { createRosterPlanner } = require('./lib/roster-planner');
const { createRosterPublicationWorkflow } = require('./lib/roster-publication');

const expressPath = require.resolve('express');
const originalExpress = require('express');
let app = null;

require.cache[expressPath].exports = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./change-workflow-bootstrap');
require.cache[expressPath].exports = originalExpress;

if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de R5/R6-roosterplanner.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);
const plannerReady = createRosterPlanner(db);
const publicationReady = createRosterPublicationWorkflow(db);

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

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

async function getAuthenticatedUser(req) {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    if (!token) return null;
    return get(
        `SELECT users.id, users.username, users.display_name AS displayName, users.role
         FROM auth_sessions
         INNER JOIN users ON users.id=auth_sessions.user_id
         WHERE auth_sessions.token_hash=?
           AND datetime(auth_sessions.expires_at)>datetime('now')
           AND users.is_active=1
         LIMIT 1`,
        [hashSessionToken(token)]
    );
}

async function markGeneratorException({ versionId, shiftUid, userId, type, note }) {
    if (!versionId || !shiftUid) return;
    await run(`INSERT INTO roster_pattern_exceptions
        (version_id, shift_uid, pattern_id, exception_type, note, created_by_user_id)
        VALUES (?, ?, NULL, ?, ?, ?)
        ON CONFLICT(version_id, shift_uid) DO UPDATE SET
            exception_type=excluded.exception_type,
            note=excluded.note,
            created_by_user_id=excluded.created_by_user_id,
            updated_at=CURRENT_TIMESTAMP`, [
        versionId,
        shiftUid,
        type,
        note || 'Handmatige uitzondering via weekplanner',
        userId
    ]);
}

function route(handler) {
    return async (req, res) => {
        try {
            const user = await getAuthenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in om het rooster te bekijken.' });
            if (!['employee', 'manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot de weekplanner.' });
            }
            const planner = await plannerReady;
            return await handler(req, res, user, planner);
        } catch (error) {
            console.error(error);
            return res.status(error.status || 500).json({
                message: error.status ? error.message : 'De weekplanner kon de aanvraag niet verwerken.',
                code: error.code || null,
                details: error.details || null
            });
        }
    };
}

function publicationRoute(handler) {
    return route(async (req, res, user, planner) => {
        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Alleen Admin kan roosters publiceren.', code: 'ROSTER_PUBLISH_FORBIDDEN' });
        }
        const publication = await publicationReady;
        return handler(req, res, user, planner, publication);
    });
}

app.get('/api/roster-planner/context', route(async (req, res, user, planner) => {
    const context = await planner.buildContext({
        userId: user.id,
        locationCode: req.query.location || 'AVE',
        weekStart: String(req.query.weekStart || ''),
        view: String(req.query.view || 'auto')
    });
    res.json(context);
}));

app.post('/api/roster-planner/draft', route(async (req, res, user, planner) => {
    const context = await planner.ensureDraft({
        userId: user.id,
        locationCode: req.body.location,
        weekStart: req.body.weekStart,
        changeNote: String(req.body.changeNote || 'Weekplanner').trim().slice(0, 500)
    });
    res.status(201).json(context);
}));

app.post('/api/roster-planner/shifts', route(async (req, res, user, planner) => {
    const context = await planner.addShift({
        userId: user.id,
        versionId: req.body.versionId,
        expectedRevision: req.body.expectedRevision,
        employeeId: req.body.employeeId,
        date: req.body.date,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        shiftType: req.body.shiftType,
        note: req.body.note
    });
    res.status(201).json(context);
}));

app.patch('/api/roster-planner/shifts/:shiftUid', route(async (req, res, user, planner) => {
    const shiftUid = decodeURIComponent(req.params.shiftUid);
    const context = await planner.updateShift({
        userId: user.id,
        versionId: req.body.versionId,
        shiftUid,
        expectedRevision: req.body.expectedRevision,
        employeeId: req.body.employeeId,
        date: req.body.date,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        shiftType: req.body.shiftType,
        note: req.body.note
    });
    await markGeneratorException({
        versionId: req.body.versionId,
        shiftUid,
        userId: user.id,
        type: 'override',
        note: 'Handmatig gewijzigd via weekplanner; niet door legacy/pattern generator overschrijven.'
    });
    res.json(context);
}));

app.delete('/api/roster-planner/shifts/:shiftUid', route(async (req, res, user, planner) => {
    const shiftUid = decodeURIComponent(req.params.shiftUid);
    const versionId = req.body.versionId;
    const context = await planner.removeShift({
        userId: user.id,
        versionId,
        shiftUid,
        expectedRevision: req.body.expectedRevision,
        reason: String(req.body.reason || '').trim().slice(0, 500) || null
    });
    await markGeneratorException({
        versionId,
        shiftUid,
        userId: user.id,
        type: 'suppress',
        note: String(req.body.reason || '').trim().slice(0, 500)
            || 'Handmatig verwijderd via weekplanner; niet door legacy/pattern generator terugplaatsen.'
    });
    res.json(context);
}));

app.get('/api/roster-publication/candidates', publicationRoute(async (req, res, user, planner, publication) => {
    const result = await publication.listCandidates({
        actorUserId: user.id,
        fromWeekStart: String(req.query.fromWeekStart || ''),
        weeks: req.query.weeks ? Number(req.query.weeks) : null
    });
    res.json(result);
}));

app.get('/api/roster-publication/horizon', publicationRoute(async (req, res, user, planner, publication) => {
    const result = await publication.horizon({
        referenceWeekStart: String(req.query.referenceWeekStart || '')
    });
    res.json(result);
}));

app.post('/api/roster-publication/prepare', publicationRoute(async (req, res, user, planner, publication) => {
    const result = await publication.prepare({
        actorUserId: user.id,
        versionIds: Array.isArray(req.body.versionIds) ? req.body.versionIds : [],
        referenceWeekStart: String(req.body.referenceWeekStart || '')
    });
    res.json(result);
}));

app.post('/api/roster-publication/publish', publicationRoute(async (req, res, user, planner, publication) => {
    const result = await publication.publish({
        actorUserId: user.id,
        versionIds: Array.isArray(req.body.versionIds) ? req.body.versionIds : [],
        reason: String(req.body.reason || '').trim().slice(0, 1000) || null,
        referenceWeekStart: String(req.body.referenceWeekStart || '')
    });
    res.status(201).json(result);
}));

app.get('/api/roster-publication/history', publicationRoute(async (req, res, user, planner, publication) => {
    const result = await publication.history({
        limit: req.query.limit ? Number(req.query.limit) : 20,
        locationId: req.query.locationId ? Number(req.query.locationId) : null,
        weekStart: req.query.weekStart ? String(req.query.weekStart) : null
    });
    res.json({ items: result });
}));
