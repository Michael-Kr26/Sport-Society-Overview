'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { createRosterDomain, localDateTimeToUtc, migrateRosterDomain } = require('../lib/roster-domain');

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
    return db;
}

async function locationId(db, code) {
    return (await get(db, 'SELECT id FROM locations WHERE code=?', [code])).id;
}

async function employeeId(db, name = 'Michael') {
    return (await get(db, 'SELECT id FROM employees WHERE display_name=?', [name])).id;
}

async function user(db, username, role, displayName = username) {
    return (await run(db, `INSERT INTO users (username, display_name, password_hash, role, is_active)
        VALUES (?, ?, 'x', ?, 1)`, [username, displayName, role])).lastID;
}

async function manager(db, locationId, username) {
    const id = await user(db, username, 'manager');
    await run(db, `INSERT INTO user_location_scopes
        (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
        VALUES (?, ?, 1, 0, '2026-09-01')`, [id, locationId]);
    return id;
}

async function testContractEmployee(db, locationId) {
    const employee = await run(db, `INSERT INTO employees (employee_code, display_name)
        VALUES ('EMP-9000', 'Test Contract')`);
    const employment = await run(db, `INSERT INTO employment_periods
        (employee_id, employment_type, known_from) VALUES (?, 'contract', '2026-09-01')`, [employee.lastID]);
    await run(db, `INSERT INTO contract_terms
        (employment_period_id, effective_from, weekly_minutes) VALUES (?, '2026-09-01', 600)`, [employment.lastID]);
    await run(db, `INSERT INTO employee_location_eligibility
        (employee_id, location_id, effective_from, is_primary, can_be_scheduled)
        VALUES (?, ?, '2026-09-01', 1, 1)`, [employee.lastID, locationId]);
    return employee.lastID;
}

test('R3 gebruikt Europe/Amsterdam correct in zomer en winter', () => {
    assert.equal(localDateTimeToUtc('2026-09-07', '18:30'), '2026-09-07T16:30:00.000Z');
    assert.equal(localDateTimeToUtc('2026-12-07', '18:30'), '2026-12-07T17:30:00.000Z');
});

test('R3 autorisatie volgt organisatiebreed lezen, manager eigen locatie en Admin publiceren', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const employee = await user(db, 'employee-r3', 'employee');
        const managerAve = await manager(db, ave, 'manager-r3');
        const admin = await user(db, 'admin-r3', 'admin');
        const domain = createRosterDomain(db);
        await domain.ready;

        assert.equal(await domain.AuthorizationService.canViewPublishedRoster(employee), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerAve, ave, '2026-09-07'), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(managerAve, bve, '2026-09-07'), false);
        assert.equal(await domain.AuthorizationService.canPublish(managerAve), false);
        assert.equal(await domain.AuthorizationService.canPublish(admin), true);
    } finally {
        await close(db);
    }
});

test('R3 genereert on demand uit patterns en bewaart handmatige weekuitzonderingen', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const managerAve = await manager(db, ave, 'pattern-manager');
        const domain = createRosterDomain(db);
        await domain.ready;

        const pattern = await domain.PatternService.createPattern({
            actorUserId: managerAve,
            employeeId: michael,
            locationId: ave,
            shiftType: 'floor',
            weekday: 1,
            startTime: '18:30',
            endTime: '21:00',
            anchorWeekStart: '2026-09-07',
            effectiveFrom: '2026-09-07'
        });
        const created = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-07',
            actorUserId: managerAve
        });
        assert.equal(created.shifts.length, 1);
        assert.equal(created.shifts[0].shiftUid, `PAT:${pattern.patternUid}:2026-09-07`);

        let version = await domain.DraftService.updateShift({
            versionId: created.version.id,
            shiftUid: created.shifts[0].shiftUid,
            expectedRevision: created.version.revision,
            actorUserId: managerAve,
            startsAtUtc: '2026-09-07T16:00:00.000Z',
            endsAtUtc: '2026-09-07T19:00:00.000Z',
            shiftType: 'floor'
        });
        await domain.PatternService.syncDraft(version.id, managerAve);
        version = await domain.QueryService.getVersion(version.id);
        assert.equal(version.shifts[0].startsAtUtc, '2026-09-07T16:00:00.000Z');

        version = await domain.DraftService.removeShift({
            versionId: version.id,
            shiftUid: version.shifts[0].shiftUid,
            expectedRevision: version.revision,
            actorUserId: managerAve,
            reason: 'Incidenteel vervallen'
        });
        await domain.PatternService.syncDraft(version.id, managerAve);
        assert.equal((await domain.QueryService.getVersion(version.id)).shifts.length, 0);
    } finally {
        await close(db);
    }
});

test('R3 optimistic locking en validatie blokkeren overlap; beschikbaarheid blijft waarschuwing', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const michael = await employeeId(db);
        const managerAve = await manager(db, ave, 'manager-ave-r3');
        const managerBve = await manager(db, bve, 'manager-bve-r3');
        const domain = createRosterDomain(db);
        await domain.ready;

        const aveCreated = await domain.DraftService.ensureDraft({
            locationId: ave, weekStart: '2026-09-21', actorUserId: managerAve
        });
        const aveVersion = await domain.DraftService.addShift({
            versionId: aveCreated.version.id,
            expectedRevision: aveCreated.version.revision,
            actorUserId: managerAve,
            employeeId: michael,
            startsAtUtc: '2026-09-21T16:30:00.000Z',
            endsAtUtc: '2026-09-21T19:30:00.000Z',
            shiftType: 'floor'
        });
        await assert.rejects(
            domain.DraftService.addShift({
                versionId: aveVersion.id,
                expectedRevision: aveCreated.version.revision,
                actorUserId: managerAve,
                employeeId: michael,
                startsAtUtc: '2026-09-22T16:30:00.000Z',
                endsAtUtc: '2026-09-22T19:30:00.000Z',
                shiftType: 'floor'
            }),
            (error) => error && error.code === 'ROSTER_VERSION_CONFLICT'
        );

        const bveCreated = await domain.DraftService.ensureDraft({
            locationId: bve, weekStart: '2026-09-21', actorUserId: managerBve
        });
        await domain.DraftService.addShift({
            versionId: bveCreated.version.id,
            expectedRevision: bveCreated.version.revision,
            actorUserId: managerBve,
            employeeId: michael,
            startsAtUtc: '2026-09-21T17:00:00.000Z',
            endsAtUtc: '2026-09-21T20:00:00.000Z',
            shiftType: 'floor'
        });

        const validation = await domain.ValidationService.validateVersion(aveVersion.id);
        assert.equal(validation.valid, false);
        assert.ok(validation.errors.some((item) => item.code === 'SHIFT_OVERLAP'));
        assert.ok(validation.warnings.some((item) => item.code === 'AVAILABILITY_UNKNOWN'));
        assert.ok(validation.information.some((item) => item.code === 'HOUR_BANK_PROJECTION'));
        assert.equal(validation.staffing, null);
    } finally {
        await close(db);
    }
});

test('R3 beschikbaarheidsexception wint van structurele beschikbaarheid zonder hard block', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const managerAve = await manager(db, ave, 'availability-manager');
        const employee = await testContractEmployee(db, ave);
        const domain = createRosterDomain(db);
        await domain.ready;

        await run(db, `INSERT INTO employee_availability_patterns
            (employee_id, weekday, slot_code, availability_state, effective_from)
            VALUES (?, 1, 'EVENING', 'available', '2026-09-01')`, [employee]);
        await run(db, `INSERT INTO employee_availability_exceptions
            (employee_id, availability_date, slot_code, availability_state, reason)
            VALUES (?, '2026-09-28', 'EVENING', 'unavailable', 'Eenmalig afgestemd')`, [employee]);

        const created = await domain.DraftService.ensureDraft({
            locationId: ave, weekStart: '2026-09-28', actorUserId: managerAve
        });
        const version = await domain.DraftService.addShift({
            versionId: created.version.id,
            expectedRevision: created.version.revision,
            actorUserId: managerAve,
            employeeId: employee,
            startsAtUtc: '2026-09-28T16:30:00.000Z',
            endsAtUtc: '2026-09-28T19:30:00.000Z',
            shiftType: 'floor'
        });
        const validation = await domain.ValidationService.validateVersion(version.id);
        assert.equal(validation.valid, true);
        assert.ok(validation.warnings.some((item) =>
            item.code === 'AVAILABILITY_EXCEPTION' && item.source === 'exception'));
    } finally {
        await close(db);
    }
});

test('R3 urenbankprojectie rekent organisatiebreed over meerdere locaties', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const managerAve = await manager(db, ave, 'hours-manager-ave');
        const managerBve = await manager(db, bve, 'hours-manager-bve');
        const employee = await testContractEmployee(db, ave);
        await run(db, `INSERT INTO employee_location_eligibility
            (employee_id, location_id, effective_from, is_primary, can_be_scheduled)
            VALUES (?, ?, '2026-09-01', 0, 1)`, [employee, bve]);
        const domain = createRosterDomain(db);
        await domain.ready;

        const d1 = await domain.DraftService.ensureDraft({ locationId: ave, weekStart: '2026-10-05', actorUserId: managerAve });
        const v1 = await domain.DraftService.addShift({
            versionId: d1.version.id, expectedRevision: d1.version.revision, actorUserId: managerAve,
            employeeId: employee, startsAtUtc: '2026-10-05T16:30:00.000Z', endsAtUtc: '2026-10-05T19:30:00.000Z', shiftType: 'floor'
        });
        const d2 = await domain.DraftService.ensureDraft({ locationId: bve, weekStart: '2026-10-05', actorUserId: managerBve });
        const v2 = await domain.DraftService.addShift({
            versionId: d2.version.id, expectedRevision: d2.version.revision, actorUserId: managerBve,
            employeeId: employee, startsAtUtc: '2026-10-06T16:30:00.000Z', endsAtUtc: '2026-10-06T19:30:00.000Z', shiftType: 'floor'
        });

        const hours = await domain.HoursService.projectedWeekMinutes({
            weekStart: '2026-10-05',
            candidateVersionIds: [v1.id, v2.id]
        });
        const row = hours.find((item) => item.employeeId === employee);
        assert.deepEqual(
            { plannedMinutes: row.plannedMinutes, contractMinutes: row.contractMinutes, delta: row.hourBankDeltaMinutes },
            { plannedMinutes: 360, contractMinutes: 600, delta: -240 }
        );
    } finally {
        await close(db);
    }
});

test('R3 patternwijziging propageert direct en publicatie bewaart immutable historie + diff', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const admin = await user(db, 'publisher-r3', 'admin');
        const domain = createRosterDomain(db);
        await domain.ready;

        const pattern = await domain.PatternService.createPattern({
            actorUserId: admin,
            employeeId: michael,
            locationId: ave,
            weekday: 1,
            startTime: '18:30',
            endTime: '21:00',
            anchorWeekStart: '2026-11-02',
            effectiveFrom: '2026-11-02'
        });
        const created = await domain.DraftService.ensureDraft({
            locationId: ave, weekStart: '2026-11-09', actorUserId: admin
        });
        assert.equal(created.shifts[0].startsAtUtc, '2026-11-09T17:30:00.000Z');

        await domain.PatternService.replacePattern({
            patternId: pattern.id,
            actorUserId: admin,
            effectiveFrom: '2026-11-09',
            startTime: '16:00',
            endTime: '21:30',
            anchorWeekStart: '2026-11-09'
        });
        let version = await domain.QueryService.getVersion(created.version.id);
        assert.equal(version.shifts[0].startsAtUtc, '2026-11-09T15:00:00.000Z');

        const first = await domain.PublicationService.publish({
            versionIds: [version.id],
            actorUserId: admin
        });
        const oldPublished = version.id;
        const next = await domain.DraftService.ensureDraft({
            locationId: ave, weekStart: '2026-11-09', actorUserId: admin, changeNote: 'Vervanging'
        });
        version = await domain.DraftService.updateShift({
            versionId: next.version.id,
            shiftUid: next.shifts[0].shiftUid,
            expectedRevision: next.version.revision,
            actorUserId: admin,
            employeeId: null
        });
        await assert.rejects(
            domain.PublicationService.publish({ versionIds: [version.id], actorUserId: admin }),
            (error) => error && error.code === 'PUBLICATION_REASON_REQUIRED'
        );
        const second = await domain.PublicationService.publish({
            versionIds: [version.id],
            actorUserId: admin,
            reason: 'Dienst opengezet'
        });
        assert.equal(first.versions.length, 1);
        assert.equal(second.versions[0].changeCount, 1);
        assert.equal((await domain.QueryService.getPublishedWeek(ave, '2026-11-09')).shifts[0].employeeId, null);
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_publication_changes
            WHERE publication_id=? AND change_type='modified'`, [second.publicationId])).count), 1);
        await assert.rejects(
            run(db, `UPDATE roster_shifts SET note='niet toegestaan' WHERE version_id=?`, [oldPublished]),
            /immutable/
        );
    } finally {
        await close(db);
    }
});
