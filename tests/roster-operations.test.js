'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { migrateRosterDomain } = require('../lib/roster-domain');
const {
    analyzeHours,
    latestPublishedShifts,
    migrateRosterOperations,
    shadowParity
} = require('../lib/roster-operations');
const {
    analyzeStaffingWithCurrentStandard,
    migrateCurrentStaffingStandard
} = require('../lib/current-staffing-standard');

const database = () => {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
};
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve({ lastID: this.lastID, changes: this.changes });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    await migrateRosterDomain(db);
    await migrateRosterOperations(db);
    await migrateCurrentStaffingStandard(db);
    return db;
}

async function locationId(db, code) {
    return (await get(db, 'SELECT id FROM locations WHERE code=?', [code])).id;
}

async function employeeId(db, name = 'Michael') {
    return (await get(db, 'SELECT id FROM employees WHERE display_name=?', [name])).id;
}

async function period(db, locationIdValue, weekStart) {
    const existing = await get(db, 'SELECT id FROM roster_periods WHERE location_id=? AND week_start=?', [locationIdValue, weekStart]);
    if (existing) return existing.id;
    const inserted = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
        VALUES (?, ?, date(?, '+6 day'))`, [locationIdValue, weekStart, weekStart]);
    return inserted.lastID;
}

async function version(db, { locationId: locationIdValue, weekStart, versionNo, state = 'published', shifts = [] }) {
    const periodId = await period(db, locationIdValue, weekStart);
    const inserted = await run(db, `INSERT INTO roster_versions
        (period_id, version_no, state, revision, change_note)
        VALUES (?, ?, 'draft', 1, 'R8 test')`, [periodId, versionNo]);
    for (const [index, shift] of shifts.entries()) {
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            shift.shiftUid || `R8:${weekStart}:${versionNo}:${index}`,
            inserted.lastID,
            shift.employeeId ?? null,
            locationIdValue,
            shift.startsAtUtc,
            shift.endsAtUtc,
            shift.shiftType || 'floor',
            shift.note || null
        ]);
    }
    if (state === 'published') {
        await run(db, `UPDATE roster_versions SET state='published', published_at=CURRENT_TIMESTAMP WHERE id=?`, [inserted.lastID]);
    }
    return inserted.lastID;
}

async function ensureLegacyRosterTable(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS roster_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roster_date TEXT NOT NULL,
        employee_name TEXT,
        item_type TEXT NOT NULL,
        location TEXT,
        start_time TEXT,
        end_time TEXT
    )`);
}

async function ensureLegacyHoursTable(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS hour_employee_settings (
        employee_name TEXT PRIMARY KEY COLLATE NOCASE,
        contract_type TEXT NOT NULL DEFAULT 'flex',
        weekly_contract_hours REAL NOT NULL DEFAULT 0,
        opening_bank_hours REAL NOT NULL DEFAULT 0,
        opening_bank_month TEXT NOT NULL,
        active_from TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
    )`);
}

test('huidige bezettingsstandaard migreert exact 32 structurele coveragevensters naar de database', async () => {
    const db = await readyDb();
    try {
        const count = Number((await get(db, `SELECT COUNT(*) AS count FROM staffing_coverage_windows
            WHERE is_active=1 AND source='current_standard_v2'`)).count);
        assert.equal(count, 32);

        const oldActive = Number((await get(db, `SELECT COUNT(*) AS count FROM staffing_coverage_windows
            WHERE is_active=1 AND source='r8_baseline'`)).count);
        assert.equal(oldActive, 0);

        const aveSunday = await get(db, `SELECT w.start_time AS startTime, w.end_time AS endTime,
            w.hard_minimum AS hardMinimum, w.advised_minimum AS advisedMinimum
            FROM staffing_coverage_windows w JOIN locations l ON l.id=w.location_id
            WHERE l.code='AVE' AND w.weekday=7 AND w.is_active=1`);
        assert.deepEqual(aveSunday, { startTime: '08:30', endTime: '12:00', hardMinimum: 1, advisedMinimum: 1 });

        const bveMonday = await all(db, `SELECT w.start_time AS startTime, w.end_time AS endTime,
            w.hard_minimum AS hardMinimum, w.advised_minimum AS advisedMinimum
            FROM staffing_coverage_windows w JOIN locations l ON l.id=w.location_id
            WHERE l.code='BVE' AND w.weekday=1 AND w.is_active=1 ORDER BY w.start_time`);
        assert.deepEqual(bveMonday, [
            { startTime: '07:00', endTime: '12:00', hardMinimum: 2, advisedMinimum: 2 },
            { startTime: '16:00', endTime: '21:30', hardMinimum: 2, advisedMinimum: 2 }
        ]);
    } finally {
        await close(db);
    }
});

test('Wekerom en Harskamp houden ma-do ochtend expliciet open zonder verzonnen bezettingsnorm', async () => {
    const db = await readyDb();
    try {
        for (const code of ['WEK', 'HAR']) {
            const mornings = await get(db, `SELECT COUNT(*) AS count
                FROM staffing_coverage_windows w JOIN locations l ON l.id=w.location_id
                WHERE l.code=? AND w.weekday BETWEEN 1 AND 4 AND w.is_active=1
                  AND time(w.start_time) < time('12:00')`, [code]);
            assert.equal(Number(mornings.count), 0);
        }

        const pending = await all(db, `SELECT l.code AS locationCode, o.weekday, o.daypart
            FROM staffing_standard_open_items o JOIN locations l ON l.id=o.location_id
            WHERE o.status='pending' ORDER BY l.code, o.weekday`);
        assert.equal(pending.length, 8);
        assert.ok(pending.every((item) => item.daypart === 'morning'));
        assert.deepEqual(new Set(pending.map((item) => item.locationCode)), new Set(['HAR', 'WEK']));
    } finally {
        await close(db);
    }
});

test('Voorthuizen gebruikt enkelbezetting op reguliere momenten maar niet op dinsdagochtend of zondag', async () => {
    const db = await readyDb();
    try {
        const rows = await all(db, `SELECT w.weekday, w.start_time AS startTime, w.hard_minimum AS hardMinimum
            FROM staffing_coverage_windows w JOIN locations l ON l.id=w.location_id
            WHERE l.code='VHU' AND w.is_active=1 ORDER BY w.weekday, w.start_time`);
        assert.equal(rows.length, 9);
        assert.ok(rows.every((row) => row.hardMinimum === 1));
        assert.equal(rows.some((row) => row.weekday === 2 && row.startTime === '07:00'), false);
        assert.equal(rows.some((row) => row.weekday === 7), false);
    } finally {
        await close(db);
    }
});

test('R8 leest uitsluitend de nieuwste published versie en negeert een draft', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T08:00:00.000Z' }]
        });
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 2,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T09:00:00.000Z' }]
        });
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 3,
            state: 'draft',
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T10:00:00.000Z' }]
        });

        const shifts = await latestPublishedShifts(db, '2026-09-07', '2026-09-07');
        assert.equal(shifts.length, 1);
        assert.equal(shifts[0].employeeName, 'Michael');
        assert.equal(shifts[0].localStartTime, '07:00');
        assert.equal(shifts[0].localEndTime, '11:00');
        assert.equal(shifts[0].durationHours, 4);
    } finally {
        await close(db);
    }
});

test('dubbele en enkele structurele bezetting worden volgens de nieuwe DB-norm beoordeeld', async () => {
    const db = await readyDb();
    try {
        const bve = await locationId(db, 'BVE');
        const vhu = await locationId(db, 'VHU');
        const michael = await employeeId(db);

        const emptyBarneveld = await analyzeStaffingWithCurrentStandard(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Barneveld', status: 'all'
        });
        const bveMorningEmpty = emptyBarneveld.rows.find((row) => row.startTime === '07:00');
        assert.equal(bveMorningEmpty.requiredEmployees, 2);
        assert.equal(bveMorningEmpty.shortageEmployees, 2);
        assert.equal(bveMorningEmpty.status, 'under');

        await version(db, {
            locationId: bve,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T10:00:00.000Z' }]
        });
        await version(db, {
            locationId: vhu,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T10:00:00.000Z' }]
        });

        const oneBarneveld = await analyzeStaffingWithCurrentStandard(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Barneveld', status: 'all'
        });
        const bveMorningOne = oneBarneveld.rows.find((row) => row.startTime === '07:00');
        assert.equal(bveMorningOne.status, 'under');
        assert.equal(bveMorningOne.shortageEmployees, 1);

        const oneVoorthuizen = await analyzeStaffingWithCurrentStandard(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Voorthuizen', status: 'all'
        });
        const vhuMorningOne = oneVoorthuizen.rows.find((row) => row.startTime === '07:00');
        assert.equal(vhuMorningOne.requiredEmployees, 1);
        assert.equal(vhuMorningOne.status, 'sufficient');
    } finally {
        await close(db);
    }
});

test('historische lessen of huidige bezetting maken geen structurele norm buiten een coveragevenster', async () => {
    const db = await readyDb();
    try {
        const wek = await locationId(db, 'WEK');
        const michael = await employeeId(db);
        await version(db, {
            locationId: wek,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{
                employeeId: michael,
                startsAtUtc: '2026-09-07T07:00:00.000Z',
                endsAtUtc: '2026-09-07T10:00:00.000Z',
                note: 'Extra opleidings-/ochtendbezetting'
            }]
        });

        const result = await analyzeStaffingWithCurrentStandard(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Wekerom', status: 'all'
        });
        assert.ok(result.rows.length > 0);
        assert.ok(result.rows.every((row) => row.startTime >= '16:00'));
        assert.equal(result.rules.pendingStandards.length, 1);
        assert.equal(result.rules.pendingStandards[0].daypart, 'morning');
    } finally {
        await close(db);
    }
});

test('algemene oude avondpiek is uitgeschakeld; Wekerom avond vraagt structureel één medewerker', async () => {
    const db = await readyDb();
    try {
        const wek = await locationId(db, 'WEK');
        const michael = await employeeId(db);
        await version(db, {
            locationId: wek,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T14:00:00.000Z', endsAtUtc: '2026-09-07T19:30:00.000Z' }]
        });
        const result = await analyzeStaffingWithCurrentStandard(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Wekerom', status: 'all'
        });
        assert.equal(result.rules.eveningPeak.enabled, false);
        assert.ok(result.rows.every((row) => row.requiredEmployees === 1));
        assert.ok(result.rows.every((row) => row.status === 'sufficient'));
    } finally {
        await close(db);
    }
});

test('huidige bezettingsstandaard is idempotent en overschrijft niet bij iedere start opnieuw', async () => {
    const db = await readyDb();
    try {
        await run(db, `UPDATE staffing_settings SET updated_by='Handmatige testwijziging' WHERE id=1`);
        const report = await migrateCurrentStaffingStandard(db);
        const row = await get(db, 'SELECT updated_by AS updatedBy FROM staffing_settings WHERE id=1');
        assert.equal(report.applied, false);
        assert.equal(report.activeWindows, 32);
        assert.equal(row.updatedBy, 'Handmatige testwijziging');
    } finally {
        await close(db);
    }
});

test('R8 uren gebruikt vanaf september canonical published shifts en canonical contract terms', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [
                { employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T09:00:00.000Z' },
                { employeeId: null, startsAtUtc: '2026-09-08T05:00:00.000Z', endsAtUtc: '2026-09-08T10:00:00.000Z' }
            ]
        });
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-14',
            versionNo: 1,
            state: 'draft',
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-14T05:00:00.000Z', endsAtUtc: '2026-09-14T11:00:00.000Z' }]
        });

        const result = await analyzeHours(db, { month: '2026-09' });
        const employee = result.employees.find((row) => row.employeeName === 'Michael');
        assert.equal(result.source, 'canonical_published');
        assert.equal(employee.scheduledHours, 4);
        assert.equal(employee.weeklyContractHours, 34);
        assert.equal(employee.monthlyNorm, 147.22);
        assert.deepEqual(employee.locations, ['Achterveld']);
    } finally {
        await close(db);
    }
});

test('R8 bewaart historische pre-baseline uren via legacy data', async () => {
    const db = await readyDb();
    try {
        await ensureLegacyRosterTable(db);
        await ensureLegacyHoursTable(db);
        await run(db, `INSERT INTO hour_employee_settings
            (employee_name, contract_type, weekly_contract_hours, opening_bank_hours, opening_bank_month, active_from, is_active)
            VALUES ('Michael', 'flex', 0, 0, '2026-01', '2026-01-01', 1)`);
        await run(db, `INSERT INTO roster_items
            (roster_date, employee_name, item_type, location, start_time, end_time)
            VALUES ('2026-08-10', 'Michael', 'shift', 'Achterveld', '09:00', '12:00')`);

        const result = await analyzeHours(db, { month: '2026-08' });
        const employee = result.employees.find((row) => row.employeeName === 'Michael');
        assert.equal(result.source, 'legacy_historical');
        assert.equal(employee.scheduledHours, 3);
    } finally {
        await close(db);
    }
});

test('R8 shadow parity vergelijkt canonical published alleen als controle met legacy', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        await ensureLegacyRosterTable(db);
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T09:00:00.000Z' }]
        });
        await run(db, `INSERT INTO roster_items
            (roster_date, employee_name, item_type, location, start_time, end_time)
            VALUES ('2026-09-07', 'Michael', 'shift', 'Achterveld', '07:00', '11:00')`);

        let parity = await shadowParity(db, { month: '2026-09' });
        let michaelParity = parity.rows.find((row) => row.employeeName === 'Michael');
        assert.equal(michaelParity.status, 'match');
        assert.equal(michaelParity.deltaHours, 0);

        await run(db, `INSERT INTO roster_items
            (roster_date, employee_name, item_type, location, start_time, end_time)
            VALUES ('2026-09-08', 'Michael', 'shift', 'Achterveld', '07:00', '08:00')`);
        parity = await shadowParity(db, { month: '2026-09' });
        michaelParity = parity.rows.find((row) => row.employeeName === 'Michael');
        assert.equal(michaelParity.status, 'different');
        assert.equal(michaelParity.canonicalHours, 4);
        assert.equal(michaelParity.legacyHours, 5);
        assert.equal(michaelParity.deltaHours, -1);
    } finally {
        await close(db);
    }
});
