const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const expressModulePath = require.resolve('express');
const originalExpress = require('express');
let capturedApp = null;

const capturingExpress = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        capturedApp = Reflect.apply(target, thisArg, args);
        return capturedApp;
    }
});

require.cache[expressModulePath].exports = capturingExpress;
require('./hours-bootstrap');
require.cache[expressModulePath].exports = originalExpress;

if (!capturedApp) {
    throw new Error('Express-app kon niet worden gekoppeld aan de roostersynchronisatie.');
}

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
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const syncDb = new sqlite3.Database(DB_PATH);
syncDb.configure('busyTimeout', 5000);

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        syncDb.run(sql, params, function (error) {
            if (error) {
                reject(error);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        syncDb.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        syncDb.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(rows || []);
        });
    });
}

function dbExec(sql) {
    return new Promise((resolve, reject) => {
        syncDb.exec(sql, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
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

    return dbGet(
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

function requireSyncRoles(...roles) {
    return async (req, res, next) => {
        try {
            await syncReady;
            const user = await getAuthenticatedUser(req);
            if (!user) {
                res.status(401).json({ message: 'Log eerst in.' });
                return;
            }
            if (!roles.includes(user.role)) {
                res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
                return;
            }
            req.syncUser = user;
            next();
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'De roostersynchronisatie kon niet worden voorbereid.' });
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

function isValidTimeRange(startTime, endTime) {
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return false;
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const start = startHours * 60 + startMinutes;
    const end = endHours * 60 + endMinutes;
    return end !== start;
}

function mapChangeToOverride(change, sourceItem) {
    const type = change.type;
    const base = sourceItem || {};
    const startTime = change.startTime || base.startTime || null;
    const endTime = change.endTime || base.endTime || null;
    const common = {
        sourceHash: sourceItem ? sourceItem.sourceHash : null,
        rosterDate: change.date,
        dayName: getDayName(change.date),
        sourceSlotEmployee: base.sourceSlotEmployee || base.employeeName || change.employee,
        location: change.location || base.location || null,
        startTime,
        endTime,
        note: change.reason || null,
        isDeleted: 0
    };

    if (type === 'Dienstwissel' || type === 'Vervanging') {
        if (!change.employee2) {
            const error = new Error('Medewerker 2 is verplicht bij een wissel of vervanging.');
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
            const error = new Error('Vul bij een tijdswijziging een geldige nieuwe begin- en eindtijd in.');
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
            const error = new Error('Vul bij een nieuwe dienst een geldige begin- en eindtijd in.');
            error.status = 400;
            throw error;
        }
        return {
            ...common,
            action: 'add',
            sourceHash: null,
            employeeName: change.employee,
            sourceSlotEmployee: change.employee,
            itemType: 'shift',
            status: type === 'Openstaande dienst' ? 'Openstaande dienst' : 'Werkdienst'
        };
    }

    const error = new Error('Dit wijzigingstype kan alleen als logboekregistratie worden opgeslagen.');
    error.status = 400;
    throw error;
}

function normalizeRosterRow(row) {
    return {
        id: row.id,
        importId: row.importId ?? null,
        rosterDate: row.rosterDate,
        dayName: row.dayName,
        employeeName: row.employeeName,
        sourceSlotEmployee: row.sourceSlotEmployee,
        itemType: row.itemType,
        location: row.location,
        startTime: row.startTime,
        endTime: row.endTime,
        status: row.status,
        note: row.note,
        sourceSheet: row.sourceSheet || null,
        sourceCell: row.sourceCell || null,
        sourceHash: row.sourceHash,
        createdAt: row.createdAt,
        isOverride: Boolean(row.isOverride),
        changeId: row.changeId || null
    };
}

function matchesFilters(item, query) {
    const name = cleanText(query.name).toLocaleLowerCase('nl-NL');
    if (name) {
        const employeeName = String(item.employeeName || '').toLocaleLowerCase('nl-NL');
        if (!employeeName.includes(name) && item.employeeName !== 'ALL') return false;
    }
    if (query.location && item.location !== query.location) return false;
    if (query.type && item.itemType !== query.type) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.from && item.rosterDate < query.from) return false;
    if (query.to && item.rosterDate > query.to) return false;
    return true;
}

function sortRoster(items) {
    const today = new Date().toISOString().slice(0, 10);
    return [...items].sort((a, b) => {
        const aFuture = a.rosterDate >= today;
        const bFuture = b.rosterDate >= today;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        const dateCompare = aFuture
            ? a.rosterDate.localeCompare(b.rosterDate)
            : b.rosterDate.localeCompare(a.rosterDate);
        if (dateCompare) return dateCompare;
        const locationCompare = String(a.location || '').localeCompare(String(b.location || ''), 'nl');
        if (locationCompare) return locationCompare;
        const timeCompare = String(a.startTime || '99:99').localeCompare(String(b.startTime || '99:99'));
        if (timeCompare) return timeCompare;
        return String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'nl');
    });
}

const syncReady = (async () => {
    await dbExec('PRAGMA foreign_keys = ON;');
    await dbExec(`
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

        CREATE INDEX IF NOT EXISTS idx_roster_overrides_source_hash ON roster_overrides(source_hash);
        CREATE INDEX IF NOT EXISTS idx_roster_overrides_date ON roster_overrides(roster_date);

        DROP TRIGGER IF EXISTS update_roster_override_from_change;
        CREATE TRIGGER update_roster_override_from_change
        AFTER UPDATE OF change_date, location, employee_1, employee_2, reason ON changes
        BEGIN
            UPDATE roster_overrides
            SET roster_date = NEW.change_date,
                day_name = CASE CAST(strftime('%w', NEW.change_date) AS INTEGER)
                    WHEN 0 THEN 'zondag' WHEN 1 THEN 'maandag' WHEN 2 THEN 'dinsdag'
                    WHEN 3 THEN 'woensdag' WHEN 4 THEN 'donderdag' WHEN 5 THEN 'vrijdag'
                    WHEN 6 THEN 'zaterdag' END,
                employee_name = CASE WHEN action = 'replace' THEN NEW.employee_2 ELSE NEW.employee_1 END,
                location = CASE WHEN item_type = 'absence' OR action = 'remove' THEN location ELSE NEW.location END,
                note = NULLIF(NEW.reason, ''),
                updated_at = CURRENT_TIMESTAMP
            WHERE change_id = NEW.id;
        END;
    `);
})();

capturedApp.get('/api/roster-effective', async (req, res) => {
    try {
        await syncReady;
        const baseRows = await dbAll(
            `SELECT
                id,
                import_id AS importId,
                roster_date AS rosterDate,
                day_name AS dayName,
                employee_name AS employeeName,
                source_slot_employee AS sourceSlotEmployee,
                item_type AS itemType,
                location,
                start_time AS startTime,
                end_time AS endTime,
                status,
                note,
                source_sheet AS sourceSheet,
                source_cell AS sourceCell,
                source_hash AS sourceHash,
                created_at AS createdAt
             FROM roster_items
             LIMIT 10000`
        );
        const overrides = await dbAll(
            `SELECT
                id,
                change_id AS changeId,
                source_hash AS sourceHash,
                action,
                roster_date AS rosterDate,
                day_name AS dayName,
                employee_name AS employeeName,
                source_slot_employee AS sourceSlotEmployee,
                item_type AS itemType,
                location,
                start_time AS startTime,
                end_time AS endTime,
                status,
                note,
                is_deleted AS isDeleted,
                created_at AS createdAt
             FROM roster_overrides`
        );

        const hiddenHashes = new Set(overrides.map((item) => item.sourceHash).filter(Boolean));
        const effectiveRows = baseRows
            .filter((item) => !hiddenHashes.has(item.sourceHash))
            .map(normalizeRosterRow);

        overrides.filter((item) => !item.isDeleted).forEach((item) => {
            effectiveRows.push(normalizeRosterRow({
                ...item,
                id: `override-${item.id}`,
                importId: null,
                sourceSheet: 'Roosterwijziging',
                sourceCell: null,
                sourceHash: `override:${item.id}`,
                isOverride: true
            }));
        });

        res.json(sortRoster(effectiveRows.filter((item) => matchesFilters(item, req.query))).slice(0, 10000));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Het actuele rooster kon niet worden opgebouwd.' });
    }
});

capturedApp.post('/api/changes-with-roster', requireSyncRoles('admin'), async (req, res) => {
    const body = req.body || {};
    const change = {
        date: cleanText(body.date, 10),
        reportedDate: cleanText(body.reportedDate, 10),
        location: cleanText(body.location, 80),
        employee: cleanText(body.employee, 120),
        employee2: cleanText(body.employee2, 120),
        type: cleanText(body.type, 80),
        reason: cleanText(body.reason, 500),
        status: cleanText(body.status, 40),
        startTime: cleanText(body.startTime, 5),
        endTime: cleanText(body.endTime, 5),
        sourceHash: cleanText(body.sourceHash, 128),
        syncRoster: Boolean(body.syncRoster)
    };

    if (!DATE_PATTERN.test(change.date) || !DATE_PATTERN.test(change.reportedDate) || !change.employee || !change.type) {
        res.status(400).json({ message: 'Datum, doorgeefdatum, medewerker en wijzigingstype zijn verplicht.' });
        return;
    }
    if (!LOCATIONS.includes(change.location) || !CHANGE_STATUSES.includes(change.status)) {
        res.status(400).json({ message: 'Ongeldige locatie of status.' });
        return;
    }

    let transactionStarted = false;
    try {
        let sourceItem = null;
        if (change.syncRoster && SOURCE_TYPES.has(change.type)) {
            if (!change.sourceHash) {
                const error = new Error('Selecteer de bestaande dienst die aangepast moet worden.');
                error.status = 400;
                throw error;
            }
            sourceItem = await dbGet(
                `SELECT
                    roster_date AS rosterDate,
                    employee_name AS employeeName,
                    source_slot_employee AS sourceSlotEmployee,
                    location,
                    start_time AS startTime,
                    end_time AS endTime,
                    source_hash AS sourceHash
                 FROM roster_items
                 WHERE source_hash = ?
                 LIMIT 1`,
                [change.sourceHash]
            );
            if (!sourceItem) {
                const error = new Error('De geselecteerde dienst bestaat niet meer. Herlaad het formulier.');
                error.status = 409;
                throw error;
            }
        }

        let override = null;
        if (change.syncRoster) {
            override = mapChangeToOverride(change, sourceItem);
        }

        await dbExec('BEGIN IMMEDIATE TRANSACTION;');
        transactionStarted = true;
        const changeResult = await dbRun(
            `INSERT INTO changes (
                change_date, reported_date, location, employee_1, employee_2,
                change_type, reason, status, created_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                change.date,
                change.reportedDate,
                change.location,
                change.employee,
                change.employee2,
                change.type,
                change.reason,
                change.status,
                req.syncUser.displayName || req.syncUser.username
            ]
        );

        if (override) {
            await dbRun(
                `INSERT INTO roster_overrides (
                    change_id, source_hash, action, roster_date, day_name,
                    employee_name, source_slot_employee, item_type, location,
                    start_time, end_time, status, note, is_deleted, created_by
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    changeResult.lastID,
                    override.sourceHash,
                    override.action,
                    override.rosterDate,
                    override.dayName,
                    override.employeeName,
                    override.sourceSlotEmployee,
                    override.itemType,
                    override.location,
                    override.startTime,
                    override.endTime,
                    override.status,
                    override.note,
                    override.isDeleted,
                    req.syncUser.displayName || req.syncUser.username
                ]
            );
        }

        await dbExec('COMMIT;');
        transactionStarted = false;
        res.status(201).json({
            message: override
                ? 'Wijziging opgeslagen en direct verwerkt in het rooster.'
                : 'Wijziging opgeslagen in het logboek.',
            id: changeResult.lastID,
            rosterUpdated: Boolean(override)
        });
    } catch (error) {
        if (transactionStarted) await dbExec('ROLLBACK;').catch(() => {});
        console.error(error);
        res.status(error.status || 500).json({
            message: error.status ? error.message : 'Wijziging kon niet worden opgeslagen.'
        });
    }
});
