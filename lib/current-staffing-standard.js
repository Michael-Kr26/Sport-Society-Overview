'use strict';

const { analyzeStaffing } = require('./roster-operations');

const CURRENT_STAFFING_STANDARD_VERSION = 2;
const CURRENT_STAFFING_STANDARD_SOURCE = 'current_standard_v2';
const CURRENT_STAFFING_STANDARD_LABEL = 'Bezettingsstandaard 2026-09-07';
const STATUS_VALUES = new Set(['all', 'issues', 'under', 'vulnerable', 'sufficient']);

const CURRENT_STAFFING_SETTINGS = Object.freeze({
    version: CURRENT_STAFFING_STANDARD_VERSION,
    eveningPeak: {
        enabled: false,
        days: [],
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
            singleCoverageWindows: []
        },
        Barneveld: {
            separateLessonRoom: true,
            lessonMode: 'none',
            lessonMinimum: 1,
            excludedMonths: [],
            singleCoverageWindows: []
        },
        Voorthuizen: {
            separateLessonRoom: true,
            lessonMode: 'none',
            lessonMinimum: 1,
            excludedMonths: [],
            singleCoverageWindows: []
        },
        Wekerom: {
            separateLessonRoom: false,
            lessonMode: 'none',
            lessonMinimum: 1,
            excludedMonths: [],
            singleCoverageWindows: []
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
        markFullOrWaitlistVulnerable: false,
        highParticipantThreshold: 10
    },
    reformerExcluded: true,
    structuralCoverageSource: 'staffing_coverage_windows',
    note: 'Structurele minima komen uitsluitend uit de actieve databasevensters. Huidig rooster en opleidingsbezetting wijzigen deze norm niet.'
});

function window(locationCode, weekday, start, end, minimum, label) {
    return Object.freeze({
        locationCode,
        weekday,
        start,
        end,
        label,
        hardMinimum: minimum,
        advisedMinimum: minimum
    });
}

const CURRENT_COVERAGE_WINDOWS = Object.freeze([
    window('BVE', 1, '07:00', '12:00', 2, 'Maandagochtend dubbel'),
    window('BVE', 1, '16:00', '21:30', 2, 'Maandagavond dubbel'),
    window('BVE', 2, '16:00', '21:30', 2, 'Dinsdagavond dubbel'),
    window('BVE', 3, '07:00', '12:00', 2, 'Woensdagochtend dubbel'),
    window('BVE', 3, '16:00', '21:30', 2, 'Woensdagavond dubbel'),
    window('BVE', 4, '16:00', '21:30', 2, 'Donderdagavond dubbel'),
    window('BVE', 5, '07:00', '12:00', 2, 'Vrijdagochtend dubbel'),
    window('BVE', 6, '08:30', '12:00', 2, 'Zaterdagochtend dubbel'),

    window('AVE', 1, '16:00', '21:30', 2, 'Maandagavond dubbel'),
    window('AVE', 2, '16:00', '21:30', 2, 'Dinsdagavond dubbel'),
    window('AVE', 3, '07:00', '12:00', 2, 'Woensdagochtend dubbel'),
    window('AVE', 3, '16:00', '21:30', 2, 'Woensdagavond dubbel'),
    window('AVE', 4, '16:00', '21:30', 2, 'Donderdagavond dubbel'),
    window('AVE', 5, '07:00', '12:00', 2, 'Vrijdagochtend dubbel'),
    window('AVE', 7, '08:30', '12:00', 1, 'Zondagochtend bezet'),

    window('WEK', 1, '16:00', '21:30', 1, 'Maandagavond bezet'),
    window('WEK', 2, '16:00', '21:30', 1, 'Dinsdagavond bezet'),
    window('WEK', 3, '16:00', '21:30', 1, 'Woensdagavond bezet'),
    window('WEK', 4, '16:00', '21:30', 1, 'Donderdagavond bezet'),

    window('HAR', 1, '16:00', '21:00', 1, 'Maandagavond bezet'),
    window('HAR', 2, '16:00', '21:00', 1, 'Dinsdagavond bezet'),
    window('HAR', 3, '16:00', '21:00', 1, 'Woensdagavond bezet'),
    window('HAR', 4, '16:00', '21:00', 1, 'Donderdagavond bezet'),

    window('VHU', 1, '07:00', '12:00', 1, 'Maandagochtend bezet'),
    window('VHU', 1, '16:00', '21:30', 1, 'Maandagavond bezet'),
    window('VHU', 2, '16:00', '21:30', 1, 'Dinsdagavond bezet'),
    window('VHU', 3, '07:00', '12:00', 1, 'Woensdagochtend bezet'),
    window('VHU', 3, '16:00', '21:30', 1, 'Woensdagavond bezet'),
    window('VHU', 4, '07:00', '12:00', 1, 'Donderdagochtend bezet'),
    window('VHU', 4, '16:00', '21:30', 1, 'Donderdagavond bezet'),
    window('VHU', 5, '07:00', '12:00', 1, 'Vrijdagochtend bezet'),
    window('VHU', 6, '08:30', '12:00', 1, 'Zaterdagochtend bezet')
]);

const CURRENT_OPEN_ITEMS = Object.freeze([
    ...[1, 2, 3, 4].map((weekday) => Object.freeze({
        locationCode: 'WEK', weekday, daypart: 'morning',
        note: 'Gewenste ochtendbezetting Wekerom is nog niet vastgesteld; geen norm invullen.'
    })),
    ...[1, 2, 3, 4].map((weekday) => Object.freeze({
        locationCode: 'HAR', weekday, daypart: 'morning',
        note: 'Gewenste ochtendbezetting Harskamp is nog niet vastgesteld; geen norm invullen.'
    }))
]);

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
}

async function ensureSchema(db) {
    await exec(db, `
        CREATE TABLE IF NOT EXISTS staffing_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            settings_json TEXT NOT NULL,
            updated_by TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS staffing_standard_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            standard_version INTEGER NOT NULL,
            standard_label TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS staffing_standard_open_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_id INTEGER NOT NULL,
            weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
            daypart TEXT NOT NULL CHECK (daypart IN ('morning', 'evening', 'other')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
            note TEXT NOT NULL,
            standard_version INTEGER NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
            UNIQUE (location_id, weekday, daypart, standard_version)
        );
    `);
}

async function migrateCurrentStaffingStandard(db) {
    await ensureSchema(db);
    const state = await get(db, 'SELECT standard_version AS standardVersion FROM staffing_standard_state WHERE id=1');
    if (Number(state?.standardVersion || 0) >= CURRENT_STAFFING_STANDARD_VERSION) {
        return currentStandardReport(db, false);
    }

    await run(db, 'BEGIN IMMEDIATE');
    try {
        const locations = await all(db, 'SELECT id, code FROM locations WHERE is_active=1');
        const locationByCode = new Map(locations.map((location) => [location.code, location.id]));
        const missingLocations = [...new Set(CURRENT_COVERAGE_WINDOWS.map((item) => item.locationCode))]
            .filter((code) => !locationByCode.has(code));
        if (missingLocations.length) throw new Error(`Vestigingen ontbreken voor bezettingsstandaard: ${missingLocations.join(', ')}.`);

        await run(db, `UPDATE staffing_coverage_windows
            SET is_active=0, updated_at=CURRENT_TIMESTAMP
            WHERE source IN ('r8_baseline', ?)`, [CURRENT_STAFFING_STANDARD_SOURCE]);

        for (const item of CURRENT_COVERAGE_WINDOWS) {
            await run(db, `INSERT INTO staffing_coverage_windows
                (location_id, weekday, start_time, end_time, label, hard_minimum, advised_minimum, is_active, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT(location_id, weekday,start_time,end_time) DO UPDATE SET
                    label=excluded.label,
                    hard_minimum=excluded.hard_minimum,
                    advised_minimum=excluded.advised_minimum,
                    is_active=1,
                    source=excluded.source,
                    updated_at=CURRENT_TIMESTAMP`, [
                locationByCode.get(item.locationCode),
                item.weekday,
                item.start,
                item.end,
                item.label,
                item.hardMinimum,
                item.advisedMinimum,
                CURRENT_STAFFING_STANDARD_SOURCE
            ]);
        }

        await run(db, 'DELETE FROM staffing_standard_open_items WHERE standard_version=?', [CURRENT_STAFFING_STANDARD_VERSION]);
        for (const item of CURRENT_OPEN_ITEMS) {
            await run(db, `INSERT INTO staffing_standard_open_items
                (location_id, weekday, daypart, status, note, standard_version, source)
                VALUES (?, ?, ?, 'pending', ?, ?, ?)`, [
                locationByCode.get(item.locationCode),
                item.weekday,
                item.daypart,
                item.note,
                CURRENT_STAFFING_STANDARD_VERSION,
                CURRENT_STAFFING_STANDARD_SOURCE
            ]);
        }

        await run(db, `INSERT INTO staffing_settings (id, settings_json, updated_by, updated_at)
            VALUES (1, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                settings_json=excluded.settings_json,
                updated_by=excluded.updated_by,
                updated_at=CURRENT_TIMESTAMP`, [
            JSON.stringify(CURRENT_STAFFING_SETTINGS),
            CURRENT_STAFFING_STANDARD_LABEL
        ]);

        await run(db, `INSERT INTO staffing_standard_state (id, standard_version, standard_label, applied_at)
            VALUES (1, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                standard_version=excluded.standard_version,
                standard_label=excluded.standard_label,
                applied_at=CURRENT_TIMESTAMP`, [
            CURRENT_STAFFING_STANDARD_VERSION,
            CURRENT_STAFFING_STANDARD_LABEL
        ]);

        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    }

    return currentStandardReport(db, true);
}

async function currentStandardReport(db, applied) {
    const activeWindows = Number((await get(db, `SELECT COUNT(*) AS count FROM staffing_coverage_windows
        WHERE is_active=1 AND source=?`, [CURRENT_STAFFING_STANDARD_SOURCE]))?.count || 0);
    const pendingItems = Number((await get(db, `SELECT COUNT(*) AS count FROM staffing_standard_open_items
        WHERE standard_version=? AND status='pending'`, [CURRENT_STAFFING_STANDARD_VERSION]))?.count || 0);
    return {
        applied,
        version: CURRENT_STAFFING_STANDARD_VERSION,
        label: CURRENT_STAFFING_STANDARD_LABEL,
        activeWindows,
        pendingItems
    };
}

async function loadPendingStandards(db, selectedLocations = []) {
    const params = [CURRENT_STAFFING_STANDARD_VERSION];
    let locationFilter = '';
    if (selectedLocations.length) {
        locationFilter = ` AND l.name IN (${selectedLocations.map(() => '?').join(',')})`;
        params.push(...selectedLocations);
    }
    return all(db, `SELECT l.code AS locationCode, l.name AS location, o.weekday, o.daypart, o.note
        FROM staffing_standard_open_items o
        INNER JOIN locations l ON l.id=o.location_id
        WHERE o.standard_version=? AND o.status='pending'${locationFilter}
        ORDER BY l.sort_order, o.weekday, o.daypart`, params);
}

async function loadCurrentCoverageWindows(db, selectedLocations = []) {
    const params = [CURRENT_STAFFING_STANDARD_SOURCE];
    let locationFilter = '';
    if (selectedLocations.length) {
        locationFilter = ` AND l.name IN (${selectedLocations.map(() => '?').join(',')})`;
        params.push(...selectedLocations);
    }
    return all(db, `SELECT l.code AS locationCode, l.name AS location,
        w.weekday, w.start_time AS startTime, w.end_time AS endTime,
        w.label, w.hard_minimum AS hardMinimum, w.advised_minimum AS advisedMinimum
        FROM staffing_coverage_windows w
        INNER JOIN locations l ON l.id=w.location_id
        WHERE w.is_active=1 AND w.source=?${locationFilter}
        ORDER BY l.sort_order, w.weekday, w.start_time`, params);
}

function recomputeSummary(rows) {
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const noCoverage = rows.filter((row) => row.employees.length === 0).length;
    const singleCoverage = rows.filter((row) => row.employees.length === 1 && row.status !== 'sufficient').length;
    const otherIssues = rows.filter((row) => row.status !== 'sufficient' && row.employees.length > 1).length;
    const sufficient = rows.filter((row) => row.status === 'sufficient').length;
    const underHours = round(rows.filter((row) => row.status === 'under')
        .reduce((total, row) => total + (row.end - row.start) / 60, 0));
    const missingEmployeeHours = round(rows.reduce((total, row) => {
        const shortage = Math.max(0, Number(row.hardMinimum || 0) - row.employees.length);
        return total + shortage * ((row.end - row.start) / 60);
    }, 0));
    return { noCoverage, singleCoverage, otherIssues, sufficient, underHours, missingEmployeeHours };
}

async function analyzeStaffingWithCurrentStandard(db, options = {}) {
    const requestedStatus = STATUS_VALUES.has(options.status) ? options.status : 'issues';
    const analysis = await analyzeStaffing(db, { ...options, status: 'all' });

    const structuralRows = (analysis.rows || [])
        .filter((row) => Boolean(row.standardShift))
        .map((row) => {
            const hardMinimum = Number(row.standardShift.hardMinimum || 0);
            const advisedMinimum = Number(row.standardShift.advisedMinimum || hardMinimum);
            const present = (row.employees || []).length;
            let status = 'sufficient';
            if (present < hardMinimum) status = 'under';
            else if (present < advisedMinimum) status = 'vulnerable';
            const reasons = [
                `Structurele bezettingsstandaard: ${hardMinimum} medewerker${hardMinimum === 1 ? '' : 's'} voor ${row.standardShift.label || `${row.startTime}–${row.endTime}`}.`
            ];
            if ((row.activeLessons || []).length) {
                reasons.push('Groepslesinformatie wijzigt deze structurele bezettingsnorm niet.');
            }
            return {
                ...row,
                hardMinimum,
                advisedMinimum,
                status,
                reasons,
                isEveningPeak: false,
                singleWindow: null,
                suppressLessonVulnerability: true,
                requiredEmployees: hardMinimum,
                shortageEmployees: Math.max(0, hardMinimum - present)
            };
        });

    const filteredRows = structuralRows.filter((row) => requestedStatus === 'all'
        || (requestedStatus === 'issues' && row.status !== 'sufficient')
        || row.status === requestedStatus);
    const selectedLocations = analysis.selectedLocations || [];
    const [pendingStandards, coverageStandard] = await Promise.all([
        loadPendingStandards(db, selectedLocations),
        loadCurrentCoverageWindows(db, selectedLocations)
    ]);

    return {
        ...analysis,
        status: requestedStatus,
        summary: recomputeSummary(structuralRows),
        rows: filteredRows,
        rules: {
            ...(analysis.rules || {}),
            currentStandardVersion: CURRENT_STAFFING_STANDARD_VERSION,
            currentStandardLabel: CURRENT_STAFFING_STANDARD_LABEL,
            structuralCoverageOnly: true,
            pendingStandards,
            coverageStandard
        },
        sources: {
            ...(analysis.sources || {}),
            currentStaffingStandard: 'database'
        }
    };
}

module.exports = {
    CURRENT_COVERAGE_WINDOWS,
    CURRENT_OPEN_ITEMS,
    CURRENT_STAFFING_SETTINGS,
    CURRENT_STAFFING_STANDARD_LABEL,
    CURRENT_STAFFING_STANDARD_SOURCE,
    CURRENT_STAFFING_STANDARD_VERSION,
    analyzeStaffingWithCurrentStandard,
    currentStandardReport,
    loadCurrentCoverageWindows,
    loadPendingStandards,
    migrateCurrentStaffingStandard
};
