'use strict';

const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { importLegacyRosterToCanonical } = require('./lib/legacy-roster-adapter');

const expressPath = require.resolve('express');
const originalExpress = require('express');
let app = null;

require.cache[expressPath].exports = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./healthplanner-bootstrap');
require.cache[expressPath].exports = originalExpress;

if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de centrale roosterwijzigingsworkflow.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const CHANGE_STATUSES = ['Open', 'In behandeling', 'Afgerond'];
const SOURCE_TYPES = new Set([
    'Dienstwissel',
    'Ziekmelding',
    'Vakantieaanvraag',
    'Ouderschapsverlof',
    'Vervanging',
    'Vrij wegens overuren',
    'Tijdswijziging',
    'Locatiewijziging',
    'Dienst vervallen'
]);
const ADD_TYPES = new Set(['Extra dienst', 'Openstaande dienst', 'Dienst toegevoegd']);
const CML_ONLY_TYPES = new Set(['Overige wijziging']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

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

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
}

function exec(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (error) => error ? reject(error) : resolve());
    });
}

async function tableExists(tableName) {
    return Boolean(await get("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [tableName]));
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
         INNER JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND datetime(auth_sessions.expires_at) > datetime('now')
           AND users.is_active = 1
         LIMIT 1`,
        [hashSessionToken(token)]
    );
}

function requireAdmin(handler) {
    return async (req, res, next) => {
        try {
            await ready;
            const user = await getAuthenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in.' });
            if (user.role !== 'admin') return res.status(403).json({ message: 'Alleen Admin mag een roosterwijziging direct doorvoeren.' });
            req.changeUser = user;
            return handler(req, res, next);
        } catch (error) {
            return next(error);
        }
    };
}

function cleanText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, maxLength);
}

function getDayName(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(date);
}

function getIsoWeekStart(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const dayNumber = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dayNumber);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function isValidTimeRange(startTime, endTime) {
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return false;
    return startTime !== endTime;
}

function mapChangeToOverride(change, sourceItem) {
    const type = change.type;
    const base = sourceItem || {};
    const common = {
        sourceHash: sourceItem ? (sourceItem.baseSourceHash || sourceItem.sourceHash || null) : null,
        rosterDate: change.date,
        dayName: getDayName(change.date),
        sourceSlotEmployee: base.sourceSlotEmployee || base.employeeName || change.employee || 'OPEN',
        location: change.location || base.location || null,
        startTime: change.startTime || base.startTime || null,
        endTime: change.endTime || base.endTime || null,
        note: change.reason || null,
        isDeleted: 0
    };

    if (type === 'Dienstwissel' || type === 'Vervanging') {
        if (!change.employee2) {
            const error = new Error('Vul de nieuwe medewerker in.');
            error.status = 400;
            throw error;
        }
        return {
            ...common,
            action: 'replace',
            employeeName: change.employee2,
            itemType: 'shift',
            status: 'Werkdienst',
            note: change.reason || `Overgenomen dienst van ${change.employee}`
        };
    }

    if (type === 'Ziekmelding') {
        return { ...common, action: 'absence', employeeName: change.employee, itemType: 'absence', location: null, startTime: null, endTime: null, status: 'Ziek' };
    }
    if (type === 'Vakantieaanvraag') {
        return { ...common, action: 'absence', employeeName: change.employee, itemType: 'absence', location: null, startTime: null, endTime: null, status: 'Betaald verlof / vakantie' };
    }
    if (type === 'Ouderschapsverlof') {
        return { ...common, action: 'absence', employeeName: change.employee, itemType: 'absence', location: null, startTime: null, endTime: null, status: 'Ouderschapsverlof' };
    }
    if (type === 'Vrij wegens overuren') {
        return { ...common, action: 'absence', employeeName: change.employee, itemType: 'absence', location: null, startTime: null, endTime: null, status: 'Tijd voor tijd' };
    }
    if (type === 'Dienst vervallen') {
        return { ...common, action: 'remove', employeeName: change.employee, itemType: 'shift', status: 'Vervallen', isDeleted: 1 };
    }
    if (type === 'Tijdswijziging') {
        if (!isValidTimeRange(change.startTime, change.endTime)) {
            const error = new Error('Vul een geldige nieuwe begin- en eindtijd in.');
            error.status = 400;
            throw error;
        }
        return { ...common, action: 'modify', employeeName: change.employee, itemType: 'shift', status: 'Werkdienst' };
    }
    if (type === 'Locatiewijziging') {
        return { ...common, action: 'modify', employeeName: change.employee, itemType: 'shift', status: 'Werkdienst' };
    }
    if (ADD_TYPES.has(type)) {
        if (!isValidTimeRange(change.startTime, change.endTime)) {
            const error = new Error('Vul een geldige begin- en eindtijd in.');
            error.status = 400;
            throw error;
        }
        const openShift = type === 'Openstaande dienst';
        return {
            ...common,
            action: 'add',
            sourceHash: null,
            employeeName: openShift ? 'OPEN' : change.employee,
            sourceSlotEmployee: openShift ? 'OPEN' : change.employee,
            itemType: 'shift',
            status: openShift ? 'Openstaande dienst' : 'Werkdienst'
        };
    }

    const error = new Error('Dit wijzigingstype wijzigt geen roosterregel.');
    error.status = 400;
    throw error;
}

async function findSourceItem(sourceHash) {
    if (String(sourceHash || '').startsWith('override:')) {
        const id = Number(String(sourceHash).slice('override:'.length));
        if (!Number.isInteger(id) || id <= 0) return null;
        const row = await get(
            `SELECT id AS sourceOverrideId, source_hash AS baseSourceHash,
                roster_date AS rosterDate, employee_name AS employeeName,
                source_slot_employee AS sourceSlotEmployee, location,
                start_time AS startTime, end_time AS endTime
             FROM roster_overrides
             WHERE id=? AND is_deleted=0
             LIMIT 1`,
            [id]
        );
        if (!row) return null;
        return { ...row, sourceHash: `override:${id}` };
    }

    return get(
        `SELECT roster_date AS rosterDate, employee_name AS employeeName,
            source_slot_employee AS sourceSlotEmployee, location,
            start_time AS startTime, end_time AS endTime,
            source_hash AS sourceHash, source_hash AS baseSourceHash
         FROM roster_items
         WHERE source_hash=?
         LIMIT 1`,
        [sourceHash]
    );
}

const ready = (async () => {
    await exec('PRAGMA foreign_keys = ON;');
    await exec(`
        CREATE TABLE IF NOT EXISTS roster_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            change_id INTEGER NOT NULL UNIQUE,
            source_hash TEXT,
            action TEXT NOT NULL,
            roster_date TEXT NOT NULL,
            day_name TEXT,
            employee_name TEXT NOT NULL,
            source_slot_employee TEXT,
            item_type TEXT NOT NULL,
            location TEXT,
            start_time TEXT,
            end_time TEXT,
            status TEXT NOT NULL,
            note TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (change_id) REFERENCES changes(id) ON DELETE CASCADE
        );
    `);
})();

app.get('/api/change-form/employees', requireAdmin(async (req, res) => {
    let employees = [];
    if (await tableExists('employees')) {
        employees = await all(`SELECT employee_code AS employeeCode, display_name AS displayName
            FROM employees WHERE archived_at IS NULL ORDER BY display_name COLLATE NOCASE`);
    }
    if (!employees.length) {
        employees = await all(`SELECT NULL AS employeeCode, employee_name AS displayName
            FROM roster_items
            WHERE item_type='shift' AND employee_name NOT IN ('ALL', 'OPEN')
            GROUP BY employee_name ORDER BY employee_name COLLATE NOCASE`);
    }
    res.json(employees);
}));

app.post('/api/change-workflow', requireAdmin(async (req, res) => {
    const body = req.body || {};
    const change = {
        date: cleanText(body.date, 10),
        reportedDate: cleanText(body.reportedDate, 10),
        location: cleanText(body.location, 80),
        employee: cleanText(body.employee, 120),
        employee2: cleanText(body.employee2, 120),
        type: cleanText(body.type, 80),
        reason: cleanText(body.reason, 500),
        status: cleanText(body.status || 'Afgerond', 40),
        startTime: cleanText(body.startTime, 5),
        endTime: cleanText(body.endTime, 5),
        sourceHash: cleanText(body.sourceHash, 128),
        syncRoster: body.syncRoster !== false
    };

    if (change.type === 'Openstaande dienst' && !change.employee) change.employee = 'Open dienst';

    if (!DATE_PATTERN.test(change.date) || !DATE_PATTERN.test(change.reportedDate) || !change.employee || !change.type) {
        return res.status(400).json({ message: 'Datum, medewerker en wijzigingstype zijn verplicht.' });
    }
    if (!LOCATIONS.includes(change.location) || !CHANGE_STATUSES.includes(change.status)) {
        return res.status(400).json({ message: 'Ongeldige vestiging of status.' });
    }
    if (!change.reason) {
        return res.status(400).json({ message: 'Vul een reden of toelichting in. Een directe roosterwijziging moet herleidbaar zijn.' });
    }
    if (CML_ONLY_TYPES.has(change.type)) change.syncRoster = false;

    let transactionStarted = false;
    try {
        let sourceItem = null;
        if (change.syncRoster && SOURCE_TYPES.has(change.type)) {
            if (!change.sourceHash) {
                const error = new Error('Selecteer de bestaande dienst die aangepast moet worden.');
                error.status = 400;
                throw error;
            }
            sourceItem = await findSourceItem(change.sourceHash);
            if (!sourceItem) {
                const error = new Error('De geselecteerde dienst bestaat niet meer. Herlaad het formulier.');
                error.status = 409;
                throw error;
            }
            if (!change.employee || change.employee === 'Open dienst') change.employee = sourceItem.employeeName;
        }

        const override = change.syncRoster ? mapChangeToOverride(change, sourceItem) : null;
        const actor = req.changeUser.displayName || req.changeUser.username;

        await exec('BEGIN IMMEDIATE TRANSACTION;');
        transactionStarted = true;

        const result = await run(
            `INSERT INTO changes (
                change_date, reported_date, location, employee_1, employee_2,
                change_type, reason, status, created_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [change.date, change.reportedDate, change.location, change.employee, change.employee2,
                change.type, change.reason, change.status, actor]
        );

        let overrideId = null;
        if (override) {
            const overrideResult = await run(
                `INSERT INTO roster_overrides (
                    change_id, source_hash, action, roster_date, day_name,
                    employee_name, source_slot_employee, item_type, location,
                    start_time, end_time, status, note, is_deleted, created_by
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [result.lastID, override.sourceHash, override.action, override.rosterDate, override.dayName,
                    override.employeeName, override.sourceSlotEmployee, override.itemType, override.location,
                    override.startTime, override.endTime, override.status, override.note, override.isDeleted, actor]
            );
            overrideId = overrideResult.lastID;

            if (sourceItem?.sourceOverrideId) {
                await run('UPDATE roster_overrides SET is_deleted=1, updated_at=CURRENT_TIMESTAMP WHERE id=?', [sourceItem.sourceOverrideId]);
            }
        }

        const correlationId = `change:${result.lastID}`;
        if (await tableExists('audit_events')) {
            await run(
                `INSERT INTO audit_events (
                    actor_user_id, entity_type, entity_id, action, after_json,
                    note, correlation_id, cml_visible
                 ) VALUES (?, 'roster_change', ?, ?, ?, ?, ?, 1)`,
                [req.changeUser.id, String(result.lastID), change.type,
                    JSON.stringify({ change, rosterOverrideId: overrideId }), change.reason, correlationId]
            );
        }

        await exec('COMMIT;');
        transactionStarted = false;

        const focusWeekStart = getIsoWeekStart(change.date);
        let canonicalSync = { attempted: false, status: 'not_applicable', relevantActions: [] };
        if (override) {
            canonicalSync.attempted = true;
            try {
                const report = await importLegacyRosterToCanonical(db, { actorUserId: req.changeUser.id });
                const locationNames = [...new Set([change.location, sourceItem?.location, override.location].filter(Boolean))];
                const locationRows = locationNames.length
                    ? await all(`SELECT id, name FROM locations WHERE name IN (${locationNames.map(() => '?').join(',')})`, locationNames)
                    : [];
                const locationIds = new Set(locationRows.map((row) => row.id));
                const relevantPeriods = report.periods.filter((period) => (
                    period.weekStart === focusWeekStart && locationIds.has(period.locationId)
                ));
                canonicalSync = {
                    attempted: true,
                    status: relevantPeriods.some((period) => period.action === 'protected_draft') ? 'attention' : 'synced',
                    parityStatus: report.parityStatus,
                    importUid: report.importUid,
                    relevantActions: relevantPeriods.map((period) => period.action)
                };
            } catch (canonicalError) {
                console.error('Canonical rooster-sync na wijziging mislukt:', canonicalError);
                canonicalSync = {
                    attempted: true,
                    status: 'failed',
                    message: canonicalError.message
                };
            }
        }

        const rosterParams = new URLSearchParams({ focusDate: change.date, location: override?.location || change.location });
        if (override?.employeeName && override.employeeName !== 'OPEN') rosterParams.set('name', override.employeeName);

        let message;
        if (!override) {
            message = 'CML-notitie is opgeslagen. Het rooster is niet aangepast.';
        } else if (canonicalSync.status === 'failed') {
            message = 'Wijziging is geregistreerd in het CML en operationele rooster. De V2-weekplanner kon niet automatisch worden bijgewerkt; controleer de planner.';
        } else if (canonicalSync.status === 'attention') {
            message = 'Wijziging is geregistreerd in het CML en operationele rooster. De V2-week bevat handmatige conceptwijzigingen en is daarom niet automatisch overschreven.';
        } else {
            message = 'Wijziging is direct verwerkt in het rooster, de V2-weekplanner en het CML.';
        }

        return res.status(201).json({
            message,
            id: result.lastID,
            rosterUpdated: Boolean(override),
            rosterOverrideId: overrideId,
            canonicalSync,
            correlationId,
            rosterUrl: `roster.html?${rosterParams.toString()}`,
            cmlUrl: `cml.html?focusWeekStart=${encodeURIComponent(focusWeekStart)}&changeId=${result.lastID}`
        });
    } catch (error) {
        if (transactionStarted) await exec('ROLLBACK').catch(() => {});
        console.error(error);
        return res.status(error.status || 500).json({
            message: error.status ? error.message : 'Wijziging kon niet worden verwerkt.'
        });
    }
}));
