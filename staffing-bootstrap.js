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
require('./app');
require.cache[expressModulePath].exports = originalExpress;

if (!capturedApp) {
    throw new Error('Express-app kon niet worden gekoppeld aan de bezettingsstandaarden.');
}

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const RULE_MODES = ['none', 'advice', 'hard'];
const standardsDb = new sqlite3.Database(DB_PATH);

const DEFAULT_STANDARDS = {
    version: 1,
    eveningPeak: {
        enabled: true,
        days: [1, 2, 3, 4],
        start: '18:00',
        end: '21:30',
        minimum: 2
    },
    locations: {
        Achterveld: {
            separateLessonRoom: false,
            lessonMode: 'none',
            lessonMinimum: 1,
            excludedMonths: [],
            singleCoverageWindows: [
                { day: 2, start: '00:00', end: '12:00', label: 'Dinsdagochtend enkele bezetting toegestaan' },
                { day: 4, start: '00:00', end: '12:00', label: 'Donderdagochtend enkele bezetting toegestaan' }
            ]
        },
        Barneveld: {
            separateLessonRoom: true,
            lessonMode: 'advice',
            lessonMinimum: 2,
            excludedMonths: [],
            singleCoverageWindows: []
        },
        Voorthuizen: {
            separateLessonRoom: true,
            lessonMode: 'hard',
            lessonMinimum: 2,
            excludedMonths: [7, 8],
            singleCoverageWindows: [
                { day: 2, start: '00:00', end: '12:00', label: 'Dinsdagochtend enkele bezetting toegestaan' }
            ]
        },
        Wekerom: {
            separateLessonRoom: false,
            lessonMode: 'none',
            lessonMinimum: 1,
            excludedMonths: [],
            singleCoverageWindows: [
                { day: 2, start: '00:00', end: '12:00', label: 'Dinsdagochtend enkele bezetting toegestaan' }
            ]
        },
        Harskamp: {
            separateLessonRoom: false,
            lessonMode: 'none',
            lessonMinimum: 1,
            excludedMonths: [],
            singleCoverageWindows: []
        }
    },
    lessonDemand: {
        markFullOrWaitlistVulnerable: true,
        highParticipantThreshold: 10
    },
    reformerExcluded: true
};

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        standardsDb.run(sql, params, function (error) {
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
        standardsDb.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(row || null);
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

function normalizeStandards(input) {
    const evening = input?.eveningPeak || {};
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
        const source = input?.locations?.[location] || {};
        const lessonMinimum = Number(source.lessonMinimum);
        const lessonMode = RULE_MODES.includes(source.lessonMode) ? source.lessonMode : 'none';
        const excludedMonths = Array.isArray(source.excludedMonths)
            ? [...new Set(source.excludedMonths.map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))].sort((a, b) => a - b)
            : [];
        const windows = Array.isArray(source.singleCoverageWindows)
            ? source.singleCoverageWindows.map(normalizeWindow)
            : [];

        if (!Number.isInteger(lessonMinimum) || lessonMinimum < 1 || lessonMinimum > 10) {
            throw new Error(`De lesnorm van ${location} moet tussen 1 en 10 liggen.`);
        }

        normalized.locations[location] = {
            separateLessonRoom: Boolean(source.separateLessonRoom),
            lessonMode,
            lessonMinimum,
            excludedMonths,
            singleCoverageWindows: windows
        };
    });

    return normalized;
}

const standardsReady = (async () => {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS staffing_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            settings_json TEXT NOT NULL,
            updated_by TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const existing = await dbGet('SELECT id FROM staffing_settings WHERE id = 1');
    if (!existing) {
        await dbRun(
            `INSERT INTO staffing_settings (id, settings_json, updated_by)
             VALUES (1, ?, 'Systeemstandaard')`,
            [JSON.stringify(DEFAULT_STANDARDS)]
        );
    }
})();

capturedApp.get('/api/staffing-standards', async (req, res) => {
    try {
        await standardsReady;
        const user = await getAuthenticatedUser(req);
        if (!user) {
            res.status(401).json({ message: 'Log eerst in om de bezettingsstandaarden te bekijken.' });
            return;
        }

        const row = await dbGet(
            `SELECT settings_json AS settingsJson, updated_by AS updatedBy, updated_at AS updatedAt
             FROM staffing_settings WHERE id = 1`
        );
        const standards = row ? JSON.parse(row.settingsJson) : DEFAULT_STANDARDS;

        res.json({
            standards,
            permissions: { canEdit: user.role === 'admin' },
            updatedBy: row?.updatedBy || null,
            updatedAt: row?.updatedAt || null
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Bezettingsstandaarden konden niet worden geladen.' });
    }
});

capturedApp.put('/api/staffing-standards', async (req, res) => {
    try {
        await standardsReady;
        const user = await getAuthenticatedUser(req);
        if (!user) {
            res.status(401).json({ message: 'Log eerst in.' });
            return;
        }
        if (user.role !== 'admin') {
            res.status(403).json({ message: 'Alleen een admin kan bezettingsstandaarden aanpassen.' });
            return;
        }

        const standards = normalizeStandards(req.body?.standards);
        await dbRun(
            `UPDATE staffing_settings
             SET settings_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = 1`,
            [JSON.stringify(standards), user.displayName || user.username]
        );

        res.json({
            message: 'Bezettingsstandaarden opgeslagen.',
            standards,
            updatedBy: user.displayName || user.username
        });
    } catch (error) {
        console.error(error);
        res.status(400).json({ message: error.message || 'Bezettingsstandaarden konden niet worden opgeslagen.' });
    }
});
