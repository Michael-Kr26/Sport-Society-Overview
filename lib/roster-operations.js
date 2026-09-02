'use strict';

const { LOCATIONS, PLANNING_BASELINE, canonicalEmployeeName } = require('./masterdata');
const { migrateRosterDomain } = require('./roster-domain');

const TIME_ZONE = 'Europe/Amsterdam';
const BASELINE_MONTH = PLANNING_BASELINE.slice(0, 7);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_VALUES = new Set(['all', 'issues', 'under', 'vulnerable', 'sufficient']);

const COVERAGE_WINDOW_SEED = Object.freeze({
    BVE: [
        { weekdays: [1, 2, 3, 4], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [1, 2, 3, 4], start: '16:00', end: '21:30', label: 'Avonddienst' },
        { weekdays: [5], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [6], start: '08:30', end: '12:00', label: 'Ochtenddienst' }
    ],
    VHU: [
        { weekdays: [1, 2, 3, 4], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [1, 2, 3, 4], start: '16:00', end: '21:30', label: 'Avonddienst' },
        { weekdays: [5], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [6], start: '08:30', end: '12:00', label: 'Ochtenddienst' }
    ],
    WEK: [
        { weekdays: [1, 2, 3, 4], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [1, 2, 3, 4], start: '16:00', end: '21:30', label: 'Avonddienst' },
        { weekdays: [5], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [6], start: '08:30', end: '12:00', label: 'Ochtenddienst' }
    ],
    AVE: [
        { weekdays: [1, 2, 3, 4], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [1, 2, 3, 4], start: '16:00', end: '21:30', label: 'Avonddienst' },
        { weekdays: [5], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [6], start: '08:30', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [7], start: '08:30', end: '12:00', label: 'Zondagsdienst' }
    ],
    HAR: [
        { weekdays: [1, 2, 3, 4], start: '08:30', end: '12:00', label: 'Ochtenddienst' },
        { weekdays: [1, 2, 3, 4], start: '16:00', end: '21:00', label: 'Avonddienst' },
        { weekdays: [5, 6], start: '08:30', end: '12:00', label: 'Ochtenddienst' }
    ]
});

const DEFAULT_STANDARDS = Object.freeze({
    version: 1,
    eveningPeak: { enabled: true, days: [1, 2, 3, 4], start: '18:00', end: '21:30', minimum: 2 },
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
    lessonDemand: { markFullOrWaitlistVulnerable: true, highParticipantThreshold: 10 },
    reformerExcluded: true
});

// Tijdelijke historische weektemplates. Alleen de bron voor lesdruk is nog niet canonical.
// Reformer Pilates blijft volgens de bestaande bezettingsregel uitgesloten.
const LESSON_TEMPLATES = Object.freeze({
    Achterveld: [
        [1,'08:45','09:30','Circuit',8,8,0],[1,'10:00','10:45','Boxing low',4,8,0],[1,'18:45','19:30','HYROX',8,8,1],[1,'19:30','20:15','Circuit',6,8,0],[1,'20:15','21:00','Boxing high',5,10,0],
        [2,'09:15','10:00','Active',5,8,0],[2,'10:00','10:45','Active',7,8,0],[2,'18:45','19:45','Strength',6,8,0],[2,'19:45','20:30','Pilates',10,12,0],[2,'20:30','21:15','Pilates',9,12,0],
        [3,'07:15','08:00','Early Birds',3,8,0],[3,'08:45','09:30','Circuit',7,8,0],[3,'18:45','19:30','BBB',2,8,0],[3,'19:30','20:15','HIIT',3,8,0],[3,'20:15','21:00','Boxing high',5,10,0],
        [4,'09:00','09:45','BBB',4,8,0],[4,'10:00','10:45','Boxing low',3,8,0],[4,'16:15','17:00','Pilates',6,12,0],[4,'18:45','19:45','Strength',7,8,0],[4,'19:45','20:30','Pilates',6,12,0],
        [5,'07:15','08:00','Early Birds',3,8,0],[5,'08:45','09:30','Circuit',7,8,0],[5,'10:00','10:45','Active',6,10,0],
        [6,'09:00','09:45','Circuit',8,8,3],[6,'10:00','11:00','HYROX',0,8,0],
        [7,'09:00','09:45','HYROX',2,8,0],[7,'10:00','10:45','Pilates',12,12,1]
    ],
    Voorthuizen: [
        [1,'08:45','09:30','Circuit',11,14,0],[1,'09:30','10:15','Active',8,14,0],[1,'18:45','19:30','Boxing',9,14,0],[1,'19:30','20:15','Strength',11,18,0],[1,'20:15','21:15','Crosstraining',11,14,0],
        [2,'18:45','19:30','HIIT',10,12,0],[2,'19:30','20:15','Circuit',14,14,0],[2,'20:15','21:00','Pilates',13,14,5],
        [3,'08:00','08:45','Pilates',13,14,3],[3,'08:45','09:30','Pilates',14,14,5],[3,'09:30','10:15','Boxing',4,14,0],[3,'10:15','11:00','Active',6,14,0],[3,'18:45','19:30','Boxing',9,12,0],[3,'19:30','20:45','Crosstraining + HYROX',13,16,0],
        [4,'08:45','09:30','Circuit',6,14,0],[4,'18:45','19:30','Circuit',11,14,0],[4,'19:30','20:30','HYROX',9,14,0],
        [5,'08:45','09:30','Crosstraining',7,14,0],[5,'09:30','10:15','Pilates',12,14,5],[5,'10:15','11:00','Pilates',12,14,2],
        [6,'08:45','09:30','HYROX',11,14,0],[6,'09:30','10:15','Boxing',10,14,1]
    ],
    Barneveld: [
        [1,'08:45','09:30','Circuit',11,12,0],[1,'10:30','11:15','Pilates',10,12,0],[1,'16:30','17:30','HYROX',4,12,0],[1,'18:45','19:30','Circuit',11,14,0],[1,'19:30','20:15','HYROX',6,12,0],
        [2,'08:45','09:30','Circuit',4,12,0],[2,'10:00','10:45','Active',5,8,0],[2,'11:00','11:45','Pilates',11,12,0],[2,'18:45','19:30','HIIT',1,12,0],[2,'19:30','20:15','Strength',8,12,0],[2,'20:15','21:00','Boxfit',12,12,0],
        [3,'08:45','09:30','Boxfit',9,14,0],[3,'09:30','10:15','Circuit',4,12,0],[3,'18:45','19:30','Circuit',9,12,0],[3,'20:15','21:00','HYROX',12,12,1],
        [4,'08:45','09:30','Circuit',11,12,0],[4,'09:45','10:30','Active',4,8,0],[4,'11:00','11:45','Pilates',9,12,0],[4,'19:30','20:15','Circuit',9,12,0],
        [5,'08:45','09:30','HIIT',5,14,0],[5,'09:30','10:15','HYROX',12,12,1],
        [6,'09:00','09:45','Circuit',8,12,0],[6,'09:45','10:30','Circuit',4,12,0]
    ],
    Wekerom: [
        [1,'08:45','09:30','Pilates',6,12,0],[1,'09:00','09:45','Circuit',7,8,0],[1,'19:00','19:45','HYROX',10,10,0],[1,'20:00','20:45','Circuit',12,12,0],
        [2,'09:00','10:00','CLUBS',6,8,0],[2,'19:00','20:00','Circuit',7,10,0],
        [3,'09:00','10:00','BBB Strength',4,8,0],[3,'18:00','18:45','Pilates',13,12,0],[3,'19:00','19:45','HYROX',5,6,0],[3,'20:00','20:45','Boksfit',7,12,0],
        [4,'09:00','10:00','Workout of the Day',3,8,0],[4,'19:00','19:45','Kracht',5,8,0],
        [5,'09:00','10:00','Circuit',4,8,0],[6,'08:45','09:45','Kracht',8,8,0]
    ],
    Harskamp: []
});

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

function round(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

async function tableExists(db, name) {
    return Boolean(await get(db, "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [name]));
}

function timeToMinutes(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minutesToTime(value) {
    const normalized = Math.max(0, Math.min(1440, Number(value) || 0));
    if (normalized === 1440) return '24:00';
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function addDays(dateString, days) {
    const [year, month, day] = String(dateString).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
    return date.toISOString().slice(0, 10);
}

function monthStart(month) {
    return `${month}-01`;
}

function monthEnd(month) {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number, 0, 12, 0, 0)).toISOString().slice(0, 10);
}

function addMonths(month, amount) {
    const [year, number] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, number - 1 + amount, 1, 12, 0, 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(from, to) {
    const result = [];
    for (let month = from; month <= to && result.length < 240; month = addMonths(month, 1)) result.push(month);
    return result;
}

function isoWeekday(dateString) {
    const day = new Date(`${dateString}T12:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
}

const formatterCache = new Map();
function zonedParts(value, timezone = TIME_ZONE) {
    if (!formatterCache.has(timezone)) {
        formatterCache.set(timezone, new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }));
    }
    const parts = Object.fromEntries(
        formatterCache.get(timezone).formatToParts(new Date(value))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value])
    );
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`
    };
}

function normalizeCanonicalShift(row) {
    const timezone = row.timezone || TIME_ZONE;
    const localStart = zonedParts(row.startsAtUtc, timezone);
    const localEnd = zonedParts(row.endsAtUtc, timezone);
    return {
        shiftUid: row.shiftUid,
        employeeId: row.employeeId || null,
        employeeName: row.employeeName || null,
        locationId: row.locationId,
        locationCode: row.locationCode,
        location: row.location,
        timezone,
        shiftType: row.shiftType,
        startsAtUtc: row.startsAtUtc,
        endsAtUtc: row.endsAtUtc,
        localDate: localStart.date,
        localStartTime: localStart.time,
        localEndDate: localEnd.date,
        localEndTime: localEnd.time,
        durationHours: round((Date.parse(row.endsAtUtc) - Date.parse(row.startsAtUtc)) / 3600000)
    };
}

async function latestPublishedShifts(db, fromDate, toDate) {
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate) || fromDate > toDate) return [];
    const rows = await all(db, `SELECT
        rs.shift_uid AS shiftUid,
        rs.employee_id AS employeeId,
        e.display_name AS employeeName,
        rs.location_id AS locationId,
        l.code AS locationCode,
        l.name AS location,
        l.timezone AS timezone,
        rs.shift_type AS shiftType,
        rs.starts_at_utc AS startsAtUtc,
        rs.ends_at_utc AS endsAtUtc
        FROM roster_periods rp
        INNER JOIN roster_versions rv ON rv.period_id=rp.id AND rv.state='published'
        INNER JOIN roster_shifts rs ON rs.version_id=rv.id
        INNER JOIN locations l ON l.id=rs.location_id
        LEFT JOIN employees e ON e.id=rs.employee_id
        WHERE date(rp.week_end)>=date(?) AND date(rp.week_start)<=date(?)
          AND rv.version_no=(
              SELECT MAX(rv2.version_no) FROM roster_versions rv2
              WHERE rv2.period_id=rp.id AND rv2.state='published'
          )
        ORDER BY rs.starts_at_utc, l.sort_order, e.display_name`, [fromDate, toDate]);
    return rows.map(normalizeCanonicalShift).filter((shift) => shift.localDate >= fromDate && shift.localDate <= toDate);
}

async function legacyShifts(db, fromDate, toDate) {
    if (!await tableExists(db, 'roster_items')) return [];
    const rows = await all(db, `SELECT roster_date AS rosterDate, employee_name AS employeeName,
        location, start_time AS startTime, end_time AS endTime
        FROM roster_items
        WHERE item_type='shift'
          AND employee_name IS NOT NULL AND TRIM(employee_name)<>'' AND UPPER(TRIM(employee_name))<>'ALL'
          AND date(roster_date)>=date(?) AND date(roster_date)<=date(?)`, [fromDate, toDate]);
    return rows.map((row) => ({
        ...row,
        employeeName: canonicalEmployeeName(row.employeeName),
        durationHours: durationFromLocalTimes(row.startTime, row.endTime)
    }));
}

function durationFromLocalTimes(startTime, endTime) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    if (start === null || end === null) return 0;
    return round(((end <= start ? end + 1440 : end) - start) / 60);
}

async function migrateRosterOperations(db) {
    await migrateRosterDomain(db);
    await run(db, `CREATE TABLE IF NOT EXISTS staffing_coverage_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER NOT NULL,
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        label TEXT NOT NULL,
        hard_minimum INTEGER NOT NULL DEFAULT 1 CHECK (hard_minimum BETWEEN 1 AND 10),
        advised_minimum INTEGER NOT NULL DEFAULT 2 CHECK (advised_minimum BETWEEN 1 AND 10),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        source TEXT NOT NULL DEFAULT 'r8_baseline',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
        UNIQUE (location_id, weekday, start_time, end_time),
        CHECK (end_time > start_time)
    )`);
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_staffing_coverage_windows_location_day ON staffing_coverage_windows(location_id, weekday, is_active)');

    const locationRows = await all(db, 'SELECT id, code FROM locations WHERE is_active=1');
    const byCode = new Map(locationRows.map((location) => [location.code, location.id]));
    for (const [code, windows] of Object.entries(COVERAGE_WINDOW_SEED)) {
        const locationId = byCode.get(code);
        if (!locationId) continue;
        for (const window of windows) {
            for (const weekday of window.weekdays) {
                await run(db, `INSERT INTO staffing_coverage_windows
                    (location_id, weekday, start_time, end_time, label, hard_minimum, advised_minimum, source)
                    VALUES (?, ?, ?, ?, ?, 1, 2, 'r8_baseline')
                    ON CONFLICT(location_id, weekday, start_time, end_time) DO NOTHING`,
                [locationId, weekday, window.start, window.end, window.label]);
            }
        }
    }
    return operationsReport(db);
}

async function operationsReport(db) {
    return {
        coverageWindowCount: Number((await get(db, 'SELECT COUNT(*) AS count FROM staffing_coverage_windows WHERE is_active=1'))?.count || 0),
        planningBaseline: PLANNING_BASELINE,
        publishedShiftSource: 'canonical_published'
    };
}

async function loadStaffingStandards(db) {
    if (!await tableExists(db, 'staffing_settings')) return JSON.parse(JSON.stringify(DEFAULT_STANDARDS));
    const row = await get(db, 'SELECT settings_json AS settingsJson FROM staffing_settings WHERE id=1');
    if (!row?.settingsJson) return JSON.parse(JSON.stringify(DEFAULT_STANDARDS));
    try {
        return JSON.parse(row.settingsJson);
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_STANDARDS));
    }
}

async function loadCoverageWindows(db) {
    return all(db, `SELECT w.id, w.location_id AS locationId, l.code AS locationCode, l.name AS location,
        w.weekday, w.start_time AS startTime, w.end_time AS endTime, w.label,
        w.hard_minimum AS hardMinimum, w.advised_minimum AS advisedMinimum
        FROM staffing_coverage_windows w
        INNER JOIN locations l ON l.id=w.location_id
        WHERE w.is_active=1 AND l.is_active=1
        ORDER BY l.sort_order, w.weekday, w.start_time`);
}

function lessonsFor(location, dateString) {
    const weekday = isoWeekday(dateString);
    return (LESSON_TEMPLATES[location] || [])
        .filter((item) => item[0] === weekday)
        .map((item) => ({
            name: item[3], start: item[1], end: item[2],
            registered: item[4], capacity: item[5], waitlist: item[6],
            source: 'historical-template'
        }));
}

function shiftSegments(shifts) {
    const segments = [];
    for (const shift of shifts) {
        const start = timeToMinutes(shift.localStartTime);
        const end = timeToMinutes(shift.localEndTime);
        if (start === null || end === null) continue;
        if (shift.localDate === shift.localEndDate) {
            segments.push({ ...shift, segmentDate: shift.localDate, start, end });
            continue;
        }
        segments.push({ ...shift, segmentDate: shift.localDate, start, end: 1440 });
        segments.push({ ...shift, segmentDate: shift.localEndDate, start: 0, end });
    }
    return segments;
}

function overlaps(start, end, otherStart, otherEnd) {
    return start < otherEnd && end > otherStart;
}

function singleCoverageWindow(standards, location, dateString, start, end) {
    const weekday = isoWeekday(dateString);
    const jsDay = weekday === 7 ? 0 : weekday;
    return (standards.locations?.[location]?.singleCoverageWindows || []).find((window) => {
        const windowStart = timeToMinutes(window.start);
        const windowEnd = timeToMinutes(window.end);
        return window.day === jsDay && windowStart !== null && windowEnd !== null
            && overlaps(start, end, windowStart, windowEnd);
    }) || null;
}

function eveningState(standards, dateString, start, end) {
    const rule = standards.eveningPeak || DEFAULT_STANDARDS.eveningPeak;
    const weekday = isoWeekday(dateString);
    const jsDay = weekday === 7 ? 0 : weekday;
    const ruleStart = timeToMinutes(rule.start);
    const ruleEnd = timeToMinutes(rule.end);
    return {
        active: Boolean(rule.enabled && (rule.days || []).includes(jsDay)
            && ruleStart !== null && ruleEnd !== null && overlaps(start, end, ruleStart, ruleEnd)),
        ruleStart,
        ruleEnd,
        rule
    };
}

function ruleForInterval({ standards, location, date, start, end, activeLessons, standardWindow }) {
    const month = Number(date.slice(5, 7));
    const locationRule = standards.locations?.[location] || DEFAULT_STANDARDS.locations[location];
    const exception = singleCoverageWindow(standards, location, date, start, end);
    const evening = eveningState(standards, date, start, end);
    let hardMinimum = standardWindow?.hardMinimum || 1;
    let advisedMinimum = standardWindow?.advisedMinimum || 1;
    let suppressLessonVulnerability = false;
    const reasons = [];

    if (standardWindow) {
        reasons.push(`Vaste standaarddienst: ${standardWindow.startTime}–${standardWindow.endTime}.`);
        if (exception) {
            advisedMinimum = hardMinimum;
            reasons.push(`Uitzondering: ${exception.label}.`);
        } else if (advisedMinimum > hardMinimum) {
            reasons.push('Enkele bezetting wordt binnen een standaarddienst als kwetsbaar gemarkeerd.');
        }
    } else if (exception) {
        reasons.push(`Uitzondering: ${exception.label}.`);
    }

    if (evening.active) {
        hardMinimum = Math.max(hardMinimum, Number(evening.rule.minimum) || 1);
        advisedMinimum = Math.max(advisedMinimum, Number(evening.rule.minimum) || 1);
        reasons.push(`Harde avondnorm: ${evening.rule.minimum} medewerkers van ${evening.rule.start} tot ${evening.rule.end}.`);
    }

    if (activeLessons.length) {
        reasons.push(`Reguliere groepsles actief: ${activeLessons.map((lesson) => lesson.name).join(', ')}.`);
        if (exception) {
            suppressLessonVulnerability = true;
        } else if (!(locationRule.excludedMonths || []).includes(month)) {
            if (locationRule.lessonMode === 'hard') {
                hardMinimum = Math.max(hardMinimum, Number(locationRule.lessonMinimum) || 1);
                advisedMinimum = Math.max(advisedMinimum, Number(locationRule.lessonMinimum) || 1);
                reasons.push(`${location}: tijdens een reguliere groepsles minimaal ${locationRule.lessonMinimum} medewerkers.`);
            } else if (locationRule.lessonMode === 'advice') {
                advisedMinimum = Math.max(advisedMinimum, Number(locationRule.lessonMinimum) || 1);
                reasons.push(`${location}: tijdens een reguliere groepsles worden ${locationRule.lessonMinimum} medewerkers geadviseerd.`);
            }
            if (activeLessons.length > 1) {
                advisedMinimum = Math.max(advisedMinimum, activeLessons.length + 1);
                reasons.push(`${activeLessons.length} lessen overlappen; extra operationele capaciteit overwegen.`);
            }
        } else {
            reasons.push(`Lesregel voor ${location} is in deze maand uitgesloten.`);
        }
    }

    return {
        hardMinimum,
        advisedMinimum,
        reasons,
        isEveningPeak: evening.active,
        singleWindow: exception,
        suppressLessonVulnerability
    };
}

function formatCoverageSchedule(windows) {
    return windows.map((window) => `${window.startTime}–${window.endTime}`).join(' / ');
}

async function analyzeStaffing(db, options = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const from = DATE_RE.test(String(options.from || '')) ? String(options.from) : today;
    const to = DATE_RE.test(String(options.to || '')) ? String(options.to) : addDays(from, 41);
    if (from > to) throw Object.assign(new Error('De einddatum moet op of na de begindatum liggen.'), { status: 400 });
    const maxDays = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
    if (maxDays > 185) throw Object.assign(new Error('Analyseer maximaal 186 dagen tegelijk.'), { status: 400 });

    const status = STATUS_VALUES.has(options.status) ? options.status : 'issues';
    const knownLocations = new Set(LOCATIONS.map((location) => location.name));
    const selectedLocations = options.location
        ? [String(options.location)]
        : LOCATIONS.map((location) => location.name);
    if (selectedLocations.some((location) => !knownLocations.has(location))) {
        throw Object.assign(new Error('Onbekende vestiging.'), { status: 400 });
    }

    const [standards, coverageWindows, shifts] = await Promise.all([
        loadStaffingStandards(db),
        loadCoverageWindows(db),
        latestPublishedShifts(db, from, to)
    ]);
    const segments = shiftSegments(shifts);
    const rows = [];

    for (let date = from; date <= to; date = addDays(date, 1)) {
        const weekday = isoWeekday(date);
        for (const location of selectedLocations) {
            const windows = coverageWindows.filter((window) => window.location === location && window.weekday === weekday);
            const lessons = lessonsFor(location, date);
            const daySegments = segments.filter((segment) => segment.location === location && segment.segmentDate === date);
            const boundaries = new Set();
            for (const window of windows) {
                boundaries.add(timeToMinutes(window.startTime));
                boundaries.add(timeToMinutes(window.endTime));
            }
            const evening = standards.eveningPeak || DEFAULT_STANDARDS.eveningPeak;
            const jsDay = weekday === 7 ? 0 : weekday;
            if (evening.enabled && (evening.days || []).includes(jsDay)) {
                boundaries.add(timeToMinutes(evening.start));
                boundaries.add(timeToMinutes(evening.end));
            }
            for (const lesson of lessons) {
                boundaries.add(timeToMinutes(lesson.start));
                boundaries.add(timeToMinutes(lesson.end));
            }
            for (const segment of daySegments) {
                boundaries.add(segment.start);
                boundaries.add(segment.end);
            }
            const sorted = [...boundaries].filter(Number.isFinite).sort((a, b) => a - b);
            for (let index = 0; index < sorted.length - 1; index += 1) {
                const start = sorted[index];
                const end = sorted[index + 1];
                if (end <= start) continue;
                const standardWindow = windows.find((window) => overlaps(
                    start, end, timeToMinutes(window.startTime), timeToMinutes(window.endTime)
                )) || null;
                const activeLessons = lessons.filter((lesson) => overlaps(
                    start, end, timeToMinutes(lesson.start), timeToMinutes(lesson.end)
                ));
                const evening = eveningState(standards, date, start, end);
                if (!standardWindow && !evening.active && !activeLessons.length) continue;

                const activeSegments = daySegments.filter((segment) => overlaps(start, end, segment.start, segment.end));
                const employeeNames = [...new Set(activeSegments.filter((segment) => segment.employeeName).map((segment) => segment.employeeName))].sort();
                const openShiftCount = activeSegments.filter((segment) => !segment.employeeName).length;
                const rule = ruleForInterval({ standards, location, date, start, end, activeLessons, standardWindow });
                const fullOrWaitlist = activeLessons.some((lesson) => lesson.waitlist > 0 || lesson.registered >= lesson.capacity);
                let rowStatus = 'sufficient';
                if (employeeNames.length < rule.hardMinimum) rowStatus = 'under';
                else if (employeeNames.length < rule.advisedMinimum) rowStatus = 'vulnerable';
                else if (standards.lessonDemand?.markFullOrWaitlistVulnerable && fullOrWaitlist && !rule.suppressLessonVulnerability) {
                    rowStatus = 'vulnerable';
                }
                rows.push({
                    date, location, start, end,
                    startTime: minutesToTime(start), endTime: minutesToTime(end),
                    employees: employeeNames,
                    openShiftCount,
                    activeLessons,
                    status: rowStatus,
                    standardShift: standardWindow,
                    ...rule
                });
            }
        }
    }

    const allRows = rows;
    const filteredRows = allRows.filter((row) => status === 'all'
        || (status === 'issues' && row.status !== 'sufficient')
        || row.status === status);
    const noCoverage = allRows.filter((row) => row.standardShift && row.employees.length === 0).length;
    const singleCoverage = allRows.filter((row) => row.standardShift && row.employees.length === 1 && row.status !== 'sufficient').length;
    const otherIssues = allRows.filter((row) => row.status !== 'sufficient'
        && !(row.standardShift && row.employees.length <= 1)).length;
    const sufficient = allRows.filter((row) => row.status === 'sufficient').length;
    const underHours = round(allRows.filter((row) => row.status === 'under')
        .reduce((total, row) => total + (row.end - row.start) / 60, 0));

    return {
        from, to, status, selectedLocations,
        generatedAt: new Date().toISOString(),
        summary: { noCoverage, singleCoverage, otherIssues, sufficient, underHours },
        rows: filteredRows,
        rules: {
            eveningPeak: standards.eveningPeak,
            standardSchedules: Object.fromEntries(selectedLocations.map((location) => {
                const grouped = coverageWindows.filter((window) => window.location === location);
                return [location, grouped.length ? formatCoverageSchedule(grouped.filter((window) => window.weekday === 1)) : 'Geen standaarddienst'];
            })),
            lessonLocations: selectedLocations.filter((location) => standards.locations?.[location]?.lessonMode !== 'none'),
            singleCoverageExceptionCount: selectedLocations.reduce((sum, location) => sum + (standards.locations?.[location]?.singleCoverageWindows?.length || 0), 0)
        },
        sources: {
            roster: 'canonical_published',
            coverageWindows: 'database',
            staffingStandards: 'database',
            lessons: 'historical-template'
        }
    };
}

async function canonicalEmployeesForMonth(db, month) {
    const first = monthStart(month);
    const last = monthEnd(month);
    const rows = await all(db, `SELECT e.id AS employeeId, e.display_name AS employeeName,
        ep.id AS employmentPeriodId, ep.employment_type AS employmentType,
        ep.starts_on AS startsOn, ep.ends_on AS endsOn, ep.known_from AS knownFrom
        FROM employees e
        INNER JOIN employment_periods ep ON ep.employee_id=e.id
        WHERE date(ep.known_from)<=date(?)
          AND (ep.starts_on IS NULL OR date(ep.starts_on)<=date(?))
          AND (ep.ends_on IS NULL OR date(ep.ends_on)>=date(?))
        ORDER BY e.display_name, date(ep.known_from) DESC, ep.id DESC`, [last, last, first]);
    const result = new Map();
    for (const row of rows) if (!result.has(row.employeeId)) result.set(row.employeeId, row);
    return [...result.values()];
}

async function canonicalContractTerms(db) {
    return all(db, `SELECT ep.employee_id AS employeeId, ct.effective_from AS effectiveFrom,
        ct.effective_to AS effectiveTo, ct.weekly_minutes AS weeklyMinutes
        FROM contract_terms ct
        INNER JOIN employment_periods ep ON ep.id=ct.employment_period_id
        ORDER BY ep.employee_id, date(ct.effective_from)`);
}

function canonicalWeeklyMinutes(employeeId, terms, month) {
    const first = monthStart(month);
    const last = monthEnd(month);
    const applicable = terms.filter((term) => Number(term.employeeId) === Number(employeeId)
        && term.effectiveFrom <= last && (!term.effectiveTo || term.effectiveTo >= first))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    return Number(applicable?.weeklyMinutes || 0);
}

async function legacyHourConfiguration(db) {
    if (!await tableExists(db, 'hour_employee_settings')) return { settings: [], periods: [] };
    const settings = await all(db, `SELECT employee_name AS employeeName, contract_type AS contractType,
        weekly_contract_hours AS weeklyContractHours, opening_bank_hours AS openingBankHours,
        opening_bank_month AS openingBankMonth, active_from AS activeFrom, is_active AS isActive
        FROM hour_employee_settings`);
    const periods = await tableExists(db, 'hour_contract_periods')
        ? await all(db, `SELECT employee_name AS employeeName, effective_from AS effectiveFrom,
            effective_to AS effectiveTo, weekly_hours AS weeklyHours FROM hour_contract_periods`)
        : [];
    return { settings, periods };
}

function legacyWeeklyHours(employeeName, configuration, month) {
    const first = monthStart(month);
    const last = monthEnd(month);
    const periods = configuration.periods.filter((period) => canonicalEmployeeName(period.employeeName).toLocaleLowerCase('nl-NL')
        === canonicalEmployeeName(employeeName).toLocaleLowerCase('nl-NL'));
    const applicable = periods.filter((period) => period.effectiveFrom <= last && (!period.effectiveTo || period.effectiveTo >= first))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (applicable) return Number(applicable.weeklyHours || 0);
    const setting = configuration.settings.find((row) => canonicalEmployeeName(row.employeeName).toLocaleLowerCase('nl-NL')
        === canonicalEmployeeName(employeeName).toLocaleLowerCase('nl-NL'));
    return setting?.contractType === 'contract' ? Number(setting.weeklyContractHours || 0) : 0;
}

async function hourAdjustments(db, fromMonth, toMonth) {
    if (!await tableExists(db, 'hour_adjustments')) return [];
    return all(db, `SELECT id, employee_name AS employeeName, adjustment_date AS adjustmentDate,
        adjustment_type AS adjustmentType, hours, note, created_by AS createdBy, created_at AS createdAt
        FROM hour_adjustments
        WHERE date(adjustment_date)>=date(?) AND date(adjustment_date)<date(?)
        ORDER BY date(adjustment_date) DESC, id DESC`, [monthStart(fromMonth), monthStart(addMonths(toMonth, 1))]);
}

async function scheduledHourMaps(db, fromMonth, toMonth) {
    const canonicalFrom = fromMonth < BASELINE_MONTH ? BASELINE_MONTH : fromMonth;
    const canonicalRows = canonicalFrom <= toMonth
        ? await latestPublishedShifts(db, monthStart(canonicalFrom), monthEnd(toMonth))
        : [];
    const legacyTo = toMonth < BASELINE_MONTH ? toMonth : addMonths(BASELINE_MONTH, -1);
    const legacyRows = fromMonth <= legacyTo
        ? await legacyShifts(db, monthStart(fromMonth), monthEnd(legacyTo))
        : [];
    const scheduled = new Map();
    const locations = new Map();
    const add = (employeeName, month, hours, location) => {
        if (!employeeName) return;
        const key = `${canonicalEmployeeName(employeeName).toLocaleLowerCase('nl-NL')}|${month}`;
        scheduled.set(key, round((scheduled.get(key) || 0) + hours));
        if (!locations.has(key)) locations.set(key, new Set());
        if (location) locations.get(key).add(location);
    };
    for (const shift of canonicalRows) if (shift.employeeName) add(shift.employeeName, shift.localDate.slice(0, 7), shift.durationHours, shift.location);
    for (const shift of legacyRows) add(shift.employeeName, shift.rosterDate.slice(0, 7), shift.durationHours, shift.location);
    return { scheduled, locations };
}

async function analyzeHours(db, options = {}) {
    const month = MONTH_RE.test(String(options.month || '')) ? String(options.month) : new Date().toISOString().slice(0, 7);
    const previousMonth = addMonths(month, -1);
    const configuration = await legacyHourConfiguration(db);
    const canonicalEmployees = month >= BASELINE_MONTH ? await canonicalEmployeesForMonth(db, month) : [];
    const canonicalTerms = month >= BASELINE_MONTH ? await canonicalContractTerms(db) : [];

    let employees;
    if (month >= BASELINE_MONTH) {
        employees = canonicalEmployees.map((employee) => ({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            activeFrom: employee.startsOn || employee.knownFrom || PLANNING_BASELINE
        }));
    } else {
        const last = monthEnd(month);
        employees = configuration.settings.filter((setting) => setting.isActive && (!setting.activeFrom || setting.activeFrom <= last))
            .map((setting) => ({ employeeId: null, employeeName: canonicalEmployeeName(setting.employeeName), activeFrom: setting.activeFrom }));
    }

    const openingMonths = configuration.settings.map((setting) => String(setting.openingBankMonth || BASELINE_MONTH)).filter(MONTH_RE.test.bind(MONTH_RE));
    const earliestOpening = openingMonths.sort()[0] || BASELINE_MONTH;
    const fromMonth = [earliestOpening, previousMonth].sort()[0];
    const { scheduled, locations } = await scheduledHourMaps(db, fromMonth, month);
    const adjustments = await hourAdjustments(db, fromMonth, month);
    const credited = new Map();
    const bank = new Map();
    const addAdjustment = (map, employeeName, adjustmentMonth, hours) => {
        const key = `${canonicalEmployeeName(employeeName).toLocaleLowerCase('nl-NL')}|${adjustmentMonth}`;
        map.set(key, round((map.get(key) || 0) + Number(hours || 0)));
    };
    for (const adjustment of adjustments) {
        addAdjustment(adjustment.adjustmentType === 'bank' ? bank : credited,
            adjustment.employeeName, adjustment.adjustmentDate.slice(0, 7), adjustment.hours);
    }

    const settingByName = new Map(configuration.settings.map((setting) => [canonicalEmployeeName(setting.employeeName).toLocaleLowerCase('nl-NL'), setting]));
    const weeklyHoursFor = (employee, targetMonth) => targetMonth >= BASELINE_MONTH && employee.employeeId
        ? canonicalWeeklyMinutes(employee.employeeId, canonicalTerms, targetMonth) / 60
        : legacyWeeklyHours(employee.employeeName, configuration, targetMonth);
    const result = employees.map((employee) => {
        const normalizedName = canonicalEmployeeName(employee.employeeName);
        const nameKey = normalizedName.toLocaleLowerCase('nl-NL');
        const key = `${nameKey}|${month}`;
        const previousKey = `${nameKey}|${previousMonth}`;
        const scheduledHours = round(scheduled.get(key));
        const creditedAdjustment = round(credited.get(key));
        const bankAdjustment = round(bank.get(key));
        const creditedHours = round(scheduledHours + creditedAdjustment);
        const previousScheduledHours = round(scheduled.get(previousKey));
        const weeklyContractHours = round(weeklyHoursFor(employee, month));
        const contractType = weeklyContractHours > 0 ? 'contract' : 'flex';
        const monthlyNorm = contractType === 'contract' ? round(weeklyContractHours * 4.33) : null;
        const monthDelta = contractType === 'contract' ? round(creditedHours - monthlyNorm + bankAdjustment) : null;
        const setting = settingByName.get(nameKey);
        let bankBalance = null;
        if (contractType === 'contract') {
            const openingMonth = setting?.openingBankMonth && MONTH_RE.test(setting.openingBankMonth)
                ? setting.openingBankMonth
                : BASELINE_MONTH;
            bankBalance = round(setting?.openingBankHours || 0);
            for (const bankMonth of monthsBetween(openingMonth, month)) {
                const monthKey = `${nameKey}|${bankMonth}`;
                const norm = round(weeklyHoursFor(employee, bankMonth) * 4.33);
                bankBalance = round(bankBalance + round(scheduled.get(monthKey)) + round(credited.get(monthKey))
                    - norm + round(bank.get(monthKey)));
            }
        }
        return {
            employeeId: employee.employeeId,
            employeeName: normalizedName,
            contractType,
            weeklyContractHours,
            monthlyNorm,
            scheduledHours,
            creditedAdjustment,
            creditedHours,
            bankAdjustment,
            monthDelta,
            bankBalance,
            previousScheduledHours,
            trendHours: round(scheduledHours - previousScheduledHours),
            locations: [...(locations.get(key) || [])].sort(),
            openingBankHours: round(setting?.openingBankHours || 0),
            openingBankMonth: setting?.openingBankMonth || BASELINE_MONTH,
            activeFrom: employee.activeFrom || null
        };
    });

    const flex = result.filter((employee) => employee.contractType === 'flex');
    const contracts = result.filter((employee) => employee.contractType === 'contract');
    const flexAverageHours = flex.length ? round(flex.reduce((sum, employee) => sum + employee.creditedHours, 0) / flex.length) : 0;
    for (const employee of flex) employee.flexDifference = round(employee.creditedHours - flexAverageHours);

    return {
        month,
        previousMonth,
        generatedAt: new Date().toISOString(),
        source: month >= BASELINE_MONTH ? 'canonical_published' : 'legacy_historical',
        sourceLabel: month >= BASELINE_MONTH
            ? 'Gepubliceerde diensten uit Rooster V2'
            : 'Historische legacy-roosterdata vóór de Rooster V2-baseline',
        planningBaseline: PLANNING_BASELINE,
        summary: {
            employeeCount: result.length,
            contractEmployeeCount: contracts.length,
            flexEmployeeCount: flex.length,
            totalScheduledHours: round(result.reduce((sum, employee) => sum + employee.scheduledHours, 0)),
            totalCreditedHours: round(result.reduce((sum, employee) => sum + employee.creditedHours, 0)),
            contractMonthDelta: round(contracts.reduce((sum, employee) => sum + Number(employee.monthDelta || 0), 0)),
            flexAverageHours
        },
        employees: result,
        adjustments: adjustments.filter((adjustment) => adjustment.adjustmentDate.slice(0, 7) === month),
        permissions: { canEdit: false }
    };
}

async function shadowParity(db, options = {}) {
    const month = MONTH_RE.test(String(options.month || '')) ? String(options.month) : new Date().toISOString().slice(0, 7);
    if (month < BASELINE_MONTH) {
        return {
            month,
            available: false,
            message: `Shadow parity start pas vanaf ${BASELINE_MONTH}.`,
            summary: { match: 0, different: 0, canonicalOnly: 0, legacyOnly: 0 },
            rows: []
        };
    }
    const [canonicalRows, legacyRows] = await Promise.all([
        latestPublishedShifts(db, monthStart(month), monthEnd(month)),
        legacyShifts(db, monthStart(month), monthEnd(month))
    ]);
    const canonical = new Map();
    const legacy = new Map();
    const add = (map, employeeName, hours, location) => {
        if (!employeeName) return;
        const name = canonicalEmployeeName(employeeName);
        const key = name.toLocaleLowerCase('nl-NL');
        if (!map.has(key)) map.set(key, { employeeName: name, hours: 0, locations: new Set() });
        const item = map.get(key);
        item.hours = round(item.hours + hours);
        if (location) item.locations.add(location);
    };
    for (const row of canonicalRows) if (row.employeeName) add(canonical, row.employeeName, row.durationHours, row.location);
    for (const row of legacyRows) add(legacy, row.employeeName, row.durationHours, row.location);
    const keys = [...new Set([...canonical.keys(), ...legacy.keys()])].sort();
    const rows = keys.map((key) => {
        const canonicalItem = canonical.get(key);
        const legacyItem = legacy.get(key);
        const canonicalHours = round(canonicalItem?.hours || 0);
        const legacyHours = round(legacyItem?.hours || 0);
        const deltaHours = round(canonicalHours - legacyHours);
        let status = Math.abs(deltaHours) <= 0.01 ? 'match' : 'different';
        if (!canonicalItem && legacyItem) status = 'legacy_only';
        else if (canonicalItem && !legacyItem) status = 'canonical_only';
        return {
            employeeName: canonicalItem?.employeeName || legacyItem?.employeeName || key,
            canonicalHours,
            legacyHours,
            deltaHours,
            status,
            canonicalLocations: [...(canonicalItem?.locations || [])].sort(),
            legacyLocations: [...(legacyItem?.locations || [])].sort()
        };
    });
    return {
        month,
        available: Boolean(legacyRows.length),
        generatedAt: new Date().toISOString(),
        summary: {
            match: rows.filter((row) => row.status === 'match').length,
            different: rows.filter((row) => row.status === 'different').length,
            canonicalOnly: rows.filter((row) => row.status === 'canonical_only').length,
            legacyOnly: rows.filter((row) => row.status === 'legacy_only').length,
            canonicalHours: round(rows.reduce((sum, row) => sum + row.canonicalHours, 0)),
            legacyHours: round(rows.reduce((sum, row) => sum + row.legacyHours, 0))
        },
        rows
    };
}

function createRosterOperations(db) {
    const ready = migrateRosterOperations(db);
    return {
        ready,
        analyzeStaffing: async (options) => { await ready; return analyzeStaffing(db, options); },
        analyzeHours: async (options) => { await ready; return analyzeHours(db, options); },
        shadowParity: async (options) => { await ready; return shadowParity(db, options); },
        latestPublishedShifts: async (from, to) => { await ready; return latestPublishedShifts(db, from, to); }
    };
}

module.exports = {
    BASELINE_MONTH,
    COVERAGE_WINDOW_SEED,
    DEFAULT_STANDARDS,
    LESSON_TEMPLATES,
    analyzeHours,
    analyzeStaffing,
    createRosterOperations,
    latestPublishedShifts,
    migrateRosterOperations,
    operationsReport,
    shadowParity
};
