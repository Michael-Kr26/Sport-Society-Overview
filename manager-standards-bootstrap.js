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
require('./access-bootstrap');
require.cache[expressModulePath].exports = originalExpress;

if (!capturedApp) {
    throw new Error('Express-app kon niet worden gekoppeld aan het locatiebeheer voor bezettingsstandaarden.');
}

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const RULE_MODES = ['none', 'advice', 'hard'];
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
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForTable(table, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = await get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (row) return;
        await sleep(50);
    }
    throw new Error(`Databasetabel ${table} is niet beschikbaar.`);
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
        `SELECT users.id, users.username, users.display_name AS displayName,
                users.role, users.location
         FROM auth_sessions
         INNER JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND datetime(auth_sessions.expires_at) > datetime('now')
           AND users.is_active = 1
         LIMIT 1`,
        [hashSessionToken(token)]
    );
}

function isValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function timeToMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

function normalizeWindow(window) {
    const day = Number(window?.day);
    const start = String(window?.start || '');
    const end = String(window?.end || '');
    const label = String(window?.label || '').trim().slice(0, 140);

    if (!Number.isInteger(day) || day < 0 || day > 6 || !isValidTime(start) || !isValidTime(end)) {
        throw new Error('Een uitzonderingsvenster bevat een ongeldige dag of tijd.');
    }
    if (timeToMinutes(end) <= timeToMinutes(start)) {
        throw new Error('De eindtijd van een uitzonderingsvenster moet na de starttijd liggen.');
    }
    return { day, start, end, label: label || 'Enkele bezetting toegestaan' };
}

function normalizeLocationStandard(source, location) {
    const lessonMinimum = Number(source?.lessonMinimum);
    const lessonMode = RULE_MODES.includes(source?.lessonMode) ? source.lessonMode : 'none';
    const excludedMonths = Array.isArray(source?.excludedMonths)
        ? [...new Set(source.excludedMonths.map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b)
        : [];
    const windows = Array.isArray(source?.singleCoverageWindows)
        ? source.singleCoverageWindows.map(normalizeWindow)
        : [];

    if (!Number.isInteger(lessonMinimum) || lessonMinimum < 1 || lessonMinimum > 10) {
        throw new Error(`De lesnorm van ${location} moet tussen 1 en 10 liggen.`);
    }

    return {
        separateLessonRoom: Boolean(source?.separateLessonRoom),
        lessonMode,
        lessonMinimum,
        excludedMonths,
        singleCoverageWindows: windows
    };
}

function normalizeAllStandards(input, stored) {
    const evening = input?.eveningPeak || stored?.eveningPeak || {};
    const eveningDays = Array.isArray(evening.days)
        ? [...new Set(evening.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
        : [];
    const eveningMinimum = Number(evening.minimum);

    if (!isValidTime(evening.start) || !isValidTime(evening.end) || timeToMinutes(evening.end) <= timeToMinutes(evening.start)) {
        throw new Error('De algemene avondnorm bevat ongeldige tijden.');
    }
    if (!Number.isInteger(eveningMinimum) || eveningMinimum < 1 || eveningMinimum > 10) {
        throw new Error('De minimale avondbezetting moet tussen 1 en 10 liggen.');
    }

    const normalized = {
        version: 1,
        eveningPeak: {
            enabled: Boolean(evening.enabled),
            days: eveningDays,
            start: evening.start,
            end: evening.end,
            minimum: eveningMinimum
        },
        locations: {},
        lessonDemand: {
            markFullOrWaitlistVulnerable: Boolean(input?.lessonDemand?.markFullOrWaitlistVulnerable),
            highParticipantThreshold: Math.min(100, Math.max(1, Number(input?.lessonDemand?.highParticipantThreshold) || 10))
        },
        reformerExcluded: true
    };

    LOCATIONS.forEach((location) => {
        normalized.locations[location] = normalizeLocationStandard(
            input?.locations?.[location] || stored?.locations?.[location],
            location
        );
    });

    return normalized;
}

async function loadStoredStandards() {
    await waitForTable('staffing_settings');
    const row = await get(
        `SELECT settings_json AS settingsJson, updated_by AS updatedBy, updated_at AS updatedAt
         FROM staffing_settings WHERE id = 1`
    );
    if (!row) {
        const error = new Error('Bezettingsstandaarden zijn nog niet ingesteld.');
        error.status = 404;
        throw error;
    }
    return { row, standards: JSON.parse(row.settingsJson) };
}

function allowedLocationsFor(user) {
    return user.role === 'admin' ? LOCATIONS : [user.location].filter((location) => LOCATIONS.includes(location));
}

function filteredStandards(standards, user, allowedLocations) {
    if (user.role === 'admin') return standards;
    return {
        ...standards,
        locations: Object.fromEntries(
            allowedLocations.map((location) => [location, standards.locations[location]])
        )
    };
}

capturedApp.get('/api/location-staffing-standards', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) return res.status(401).json({ message: 'Log eerst in om de bezettingsstandaarden te bekijken.' });
        if (!['manager', 'admin'].includes(user.role)) {
            return res.status(403).json({ message: 'Je hebt geen toegang tot de bezettingsstandaarden.' });
        }

        const allowedLocations = allowedLocationsFor(user);
        if (!allowedLocations.length) {
            return res.status(409).json({ message: 'Dit managerprofiel heeft nog geen vestiging. Laat een admin de vestiging koppelen via Accounts.' });
        }

        const { row, standards } = await loadStoredStandards();
        res.json({
            standards: filteredStandards(standards, user, allowedLocations),
            permissions: {
                canEdit: true,
                canEditGlobal: user.role === 'admin',
                allowedLocations
            },
            profile: { role: user.role, location: user.location || null },
            updatedBy: row.updatedBy || null,
            updatedAt: row.updatedAt || null
        });
    } catch (error) {
        console.error(error);
        res.status(error.status || 500).json({ message: error.message || 'Bezettingsstandaarden konden niet worden geladen.' });
    }
});

capturedApp.put('/api/location-staffing-standards', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) return res.status(401).json({ message: 'Log eerst in.' });
        if (!['manager', 'admin'].includes(user.role)) {
            return res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
        }

        const allowedLocations = allowedLocationsFor(user);
        if (!allowedLocations.length) {
            return res.status(409).json({ message: 'Dit managerprofiel heeft nog geen vestiging.' });
        }

        const { standards: stored } = await loadStoredStandards();
        let nextStandards;

        if (user.role === 'admin') {
            nextStandards = normalizeAllStandards(req.body?.standards, stored);
        } else {
            const location = allowedLocations[0];
            const submittedLocation = req.body?.standards?.locations?.[location];
            if (!submittedLocation) {
                return res.status(400).json({ message: `De standaarden voor ${location} ontbreken.` });
            }
            nextStandards = JSON.parse(JSON.stringify(stored));
            nextStandards.locations[location] = normalizeLocationStandard(submittedLocation, location);
            nextStandards.version = 1;
            nextStandards.reformerExcluded = true;
        }

        const updatedBy = user.displayName || user.username;
        await run(
            `UPDATE staffing_settings
             SET settings_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = 1`,
            [JSON.stringify(nextStandards), updatedBy]
        );

        res.json({
            message: user.role === 'admin'
                ? 'Alle bezettingsstandaarden zijn opgeslagen.'
                : `De bezettingsstandaarden voor ${allowedLocations[0]} zijn opgeslagen.`,
            standards: filteredStandards(nextStandards, user, allowedLocations),
            updatedBy
        });
    } catch (error) {
        console.error(error);
        res.status(error.status || 400).json({ message: error.message || 'Bezettingsstandaarden konden niet worden opgeslagen.' });
    }
});
