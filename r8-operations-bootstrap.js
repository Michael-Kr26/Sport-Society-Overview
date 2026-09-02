'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { activeLocationScopes } = require('./lib/roster-access');
const { createRosterOperations } = require('./lib/roster-operations');

const expressPath = require.resolve('express');
const originalExpress = require('express');
let app = null;

require.cache[expressPath].exports = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
const r7 = require('./r7-access-bootstrap');
require.cache[expressPath].exports = originalExpress;

if (!app) throw new Error('Express-app kon niet worden gekoppeld aan R8 staffing en uren.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);
const operations = createRosterOperations(db);

function apiError(res, error, fallback) {
    console.error(error);
    if (res.headersSent) return;
    res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}

function managementRoute(handler, options = {}) {
    return async (req, res) => {
        try {
            await operations.ready;
            const user = await r7.authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in.' });
            if (!['manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot deze managementanalyse.' });
            }
            if (options.adminOnly && user.role !== 'admin') {
                return res.status(403).json({ message: 'Alleen een admin kan deze controle uitvoeren.' });
            }
            return handler(req, res, user);
        } catch (error) {
            apiError(res, error, options.fallback || 'De R8-analyse kon niet worden uitgevoerd.');
        }
    };
}

function mergeStaffingAnalyses(analyses, allowedLocations) {
    const rows = analyses.flatMap((analysis) => analysis.rows || [])
        .sort((a, b) => a.date.localeCompare(b.date)
            || a.location.localeCompare(b.location, 'nl')
            || a.start - b.start);
    const summary = analyses.reduce((total, analysis) => ({
        noCoverage: total.noCoverage + Number(analysis.summary?.noCoverage || 0),
        singleCoverage: total.singleCoverage + Number(analysis.summary?.singleCoverage || 0),
        otherIssues: total.otherIssues + Number(analysis.summary?.otherIssues || 0),
        sufficient: total.sufficient + Number(analysis.summary?.sufficient || 0),
        underHours: Math.round((total.underHours + Number(analysis.summary?.underHours || 0)) * 100) / 100
    }), { noCoverage: 0, singleCoverage: 0, otherIssues: 0, sufficient: 0, underHours: 0 });
    const first = analyses[0] || {};
    return {
        ...first,
        selectedLocations: allowedLocations,
        summary,
        rows,
        rules: {
            eveningPeak: first.rules?.eveningPeak || null,
            standardSchedules: Object.assign({}, ...analyses.map((analysis) => analysis.rules?.standardSchedules || {})),
            lessonLocations: [...new Set(analyses.flatMap((analysis) => analysis.rules?.lessonLocations || []))],
            singleCoverageExceptionCount: analyses.reduce(
                (sum, analysis) => sum + Number(analysis.rules?.singleCoverageExceptionCount || 0), 0
            )
        }
    };
}

app.get('/api/roster-operations/staffing', managementRoute(async (req, res, user) => {
    const from = String(req.query.from || '');
    const requestedLocation = String(req.query.location || '').trim();
    const options = {
        from,
        to: String(req.query.to || ''),
        status: String(req.query.status || 'issues')
    };

    if (user.role === 'admin') {
        const analysis = await operations.analyzeStaffing({
            ...options,
            location: requestedLocation || undefined
        });
        analysis.permissions = {
            canEdit: false,
            allowedLocations: analysis.selectedLocations,
            organizationWide: true
        };
        return res.json(analysis);
    }

    const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
    const scopes = await activeLocationScopes(db, user.id, effectiveDate);
    const allowedLocations = [...new Set(scopes.map((scope) => scope.locationName))];
    if (!allowedLocations.length) {
        return res.status(409).json({ message: 'Dit managerprofiel heeft geen actieve vestigingsscope.' });
    }
    if (requestedLocation && !allowedLocations.includes(requestedLocation)) {
        return res.status(403).json({ message: 'Je kunt alleen de bezetting van je gekoppelde vestiging(en) bekijken.' });
    }
    const selectedLocations = requestedLocation ? [requestedLocation] : allowedLocations;
    const analyses = await Promise.all(selectedLocations.map((location) => operations.analyzeStaffing({
        ...options,
        location
    })));
    const analysis = mergeStaffingAnalyses(analyses, selectedLocations);
    analysis.permissions = {
        canEdit: false,
        allowedLocations,
        organizationWide: false
    };
    return res.json(analysis);
}, { fallback: 'De bezettingsanalyse kon niet worden geladen.' }));

app.get('/api/roster-operations/hours', managementRoute(async (req, res, user) => {
    const analysis = await operations.analyzeHours({ month: String(req.query.month || '') });
    analysis.permissions = {
        canEdit: user.role === 'admin',
        canEditAdjustments: user.role === 'admin',
        canViewShadowParity: user.role === 'admin'
    };
    res.json(analysis);
}, { fallback: 'De urenanalyse kon niet worden geladen.' }));

app.get('/api/roster-operations/parity', managementRoute(async (req, res) => {
    res.json(await operations.shadowParity({ month: String(req.query.month || '') }));
}, { adminOnly: true, fallback: 'De rooster-shadow-parity kon niet worden geladen.' }));

module.exports = {
    app,
    operations
};
