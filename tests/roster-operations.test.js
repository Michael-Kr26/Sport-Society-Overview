'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { migrateRosterDomain } = require('../lib/roster-domain');
const {
    analyzeHours,
    analyzeStaffing,
    latestPublishedShifts,
    migrateRosterOperations,
    shadowParity
} = require('../lib/roster-operations');

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
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function readyDb() {
    const db = database();
    await migrateR1Masterdata(db);
    await migrateRosterData(db);
    await migrateRosterDomain(db);
    await migrateRosterOperations(db);
    return db;
}

async function locationId(db, code) {
    return (await get(db, 'SELECT id FROM locations WHERE code=?', [code])).id;
}

async function employeeId(db, name = 'Michael') {
    return (await get(db, 'SELECT id FROM employees WHERE display_name=?', [name])).id;
}

async function period(db, locationId, weekStart) {
    const existing = await get(db, 'SELECT id FROM roster_periods WHERE location_id=? AND week_start=?', [locationId, weekStart]);
    if (existing) return existing.id;
    const inserted = await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
        VALUES (?, ?, date(?, '+6 day'))`, [locationId, weekStart, weekStart]);
    return inserted.lastID;
}

async function version(db, { locationId, weekStart, versionNo, state = 'published', shifts = [] }) {
    const periodId = await period(db, locationId, weekStart);
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
            locationId,
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

test('R8 migreert de vaste coveragevensters naar de database', async () => {
    const db = await readyDb();
    try {
        const count = Number((await get(db, 'SELECT COUNT(*) AS count FROM staffing_coverage_windows WHERE is_active=1')).count);
        assert.equal(count, 51);
        const aveSunday = await get(db, `SELECT start_time AS startTime, end_time AS endTime
            FROM staffing_coverage_windows w JOIN locations l ON l.id=w.location_id
            WHERE l.code='AVE' AND w.weekday=7`);
        assert.deepEqual(aveSunday, { startTime: '08:30', endTime: '12:00' });
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

test('R8 staffing gebruikt published shifts; geen bezetting is onder, één is kwetsbaar en uitzondering kan voldoende zijn', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);

        const emptyMonday = await analyzeStaffing(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Achterveld', status: 'all'
        });
        assert.ok(emptyMonday.rows.some((row) => row.standardShift && row.status === 'under' && row.employees.length === 0));

        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [
                { employeeId: michael, startsAtUtc: '2026-09-07T05:00:00.000Z', endsAtUtc: '2026-09-07T10:00:00.000Z' },
                { employeeId: michael, startsAtUtc: '2026-09-08T05:00:00.000Z', endsAtUtc: '2026-09-08T10:00:00.000Z' },
                { employeeId: null, startsAtUtc: '2026-09-08T05:00:00.000Z', endsAtUtc: '2026-09-08T10:00:00.000Z', note: 'Open dienst' }
            ]
        });

        const monday = await analyzeStaffing(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Achterveld', status: 'all'
        });
        assert.ok(monday.rows.some((row) => row.standardShift && row.status === 'vulnerable' && row.employees.length === 1));

        const tuesday = await analyzeStaffing(db, {
            from: '2026-09-08', to: '2026-09-08', location: 'Achterveld', status: 'all'
        });
        assert.ok(tuesday.rows.some((row) => row.standardShift && row.status === 'sufficient' && row.employees.length === 1));
        assert.ok(tuesday.rows.some((row) => row.openShiftCount >= 1));
    } finally {
        await close(db);
    }
});

test('R8 avondpiek vereist twee medewerkers', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        await version(db, {
            locationId: ave,
            weekStart: '2026-09-07',
            versionNo: 1,
            shifts: [{ employeeId: michael, startsAtUtc: '2026-09-07T16:00:00.000Z', endsAtUtc: '2026-09-07T19:30:00.000Z' }]
        });
        const result = await analyzeStaffing(db, {
            from: '2026-09-07', to: '2026-09-07', location: 'Achterveld', status: 'all'
        });
        assert.ok(result.rows.some((row) => row.isEveningPeak && row.hardMinimum === 2 && row.status === 'under'));
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
