'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const {
    createRosterDomain,
    localDateTimeToUtc,
    migrateRosterDomain
} = require('../lib/roster-domain');

function database() {
    const db = new sqlite3.Database(':memory:');
    db.configure('busyTimeout', 5000);
    return db;
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function close(db) {
    return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

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

async function createUser(db, username, role, displayName = username) {
    return (await run(db, `INSERT INTO users (username, display_name, password_hash, role, is_active)
        VALUES (?, ?, 'x', ?, 1)`, [username, displayName, role])).lastID;
}

async function createManagerForLocation(db, locationId) {
    const userId = await createUser(db, `manager-${locationId}`, 'manager', 'Test Manager');
    await run(db, `INSERT INTO user_location_scopes
        (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
        VALUES (?, ?, 1, 0, '2026-09-01')`, [userId, locationId]);
    return userId;
}

async function seedContractEmployee(db, locationId, name = 'Test Contract') {
    const employee = await run(db, `INSERT INTO employees (employee_code, display_name)
        VALUES ('EMP-9000', ?)`, [name]);
    const period = await run(db, `INSERT INTO employment_periods
        (employee_id, employment_type, starts_on, ends_on, known_from)
        VALUES (?, 'contract', NULL, NULL, '2026-09-01')`, [employee.lastID]);
    await run(db, `INSERT INTO contract_terms
        (employment_period_id, effective_from, weekly_minutes)
        VALUES (?, '2026-09-01', 600)`, [period.lastID]);
    await run(db, `INSERT INTO employee_location_eligibility
        (employee_id, location_id, effective_from, is_primary, can_be_scheduled)
        VALUES (?, ?, '2026-09-01', 1, 1)`, [employee.lastID, locationId]);
    return employee.lastID;
}

test('R3 converteert lokale Amsterdam-tijden correct naar UTC in zomer en winter', () => {
    assert.equal(localDateTimeToUtc('2026-09-07', '18:30'), '2026-09-07T16:30:00.000Z');
    assert.equal(localDateTimeToUtc('2026-12-07', '18:30'), '2026-12-07T17:30:00.000Z');
});

test('R3 rechten: Employee ziet gepubliceerd, Manager bewerkt alleen eigen locatie, alleen Admin publiceert', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const employeeUser = await createUser(db, 'r3-employee', 'employee');
        const manager = await createManagerForLocation(db, ave);
        const admin = await createUser(db, 'r3-admin', 'admin');
        const domain = createRosterDomain(db);
        await domain.ready;

        assert.equal(await domain.AuthorizationService.canViewPublishedRoster(employeeUser), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(employeeUser, ave, '2026-09-07'), false);
        assert.equal(await domain.AuthorizationService.canEditLocation(manager, ave, '2026-09-07'), true);
        assert.equal(await domain.AuthorizationService.canEditLocation(manager, bve, '2026-09-07'), false);
        assert.equal(await domain.AuthorizationService.canPublish(manager), false);
        assert.equal(await domain.AuthorizationService.canPublish(admin), true);
    } finally {
        await close(db);
    }
});

test('R3 maakt on demand een draft en genereert patterns als concrete shifts met stabiele UID', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const manager = await createManagerForLocation(db, ave);
        const domain = createRosterDomain(db);
        await domain.ready;

        const pattern = await domain.PatternService.createPattern({
            actorUserId: manager,
            employeeId: michael,
            locationId: ave,
            shiftType: 'administration',
            weekday: 1,
            startTime: '07:00',
            endTime: '08:30',
            repeatIntervalWeeks: 1,
            anchorWeekStart: '2026-09-07',
            effectiveFrom: '2026-09-07'
        });

        const draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-07',
            actorUserId: manager
        });
        assert.equal(draft.created, true);
        assert.equal(draft.shifts.length, 1);
        assert.equal(draft.shifts[0].shiftUid, `PAT:${pattern.patternUid}:2026-09-07`);
        assert.equal(draft.shifts[0].startsAtUtc, '2026-09-07T05:00:00.000Z');
        assert.equal(draft.shifts[0].endsAtUtc, '2026-09-07T06:30:00.000Z');

        const again = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-07',
            actorUserId: manager
        });
        assert.equal(again.created, false);
        assert.equal(again.shifts.length, 1);
    } finally {
        await close(db);
    }
});

test('R3 handmatige uitzondering op gegenereerde dienst blijft bestaan na pattern-sync', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const manager = await createManagerForLocation(db, ave);
        const domain = createRosterDomain(db);
        await domain.ready;

        await domain.PatternService.createPattern({
            actorUserId: manager,
            employeeId: michael,
            locationId: ave,
            shiftType: 'floor',
            weekday: 1,
            startTime: '18:30',
            endTime: '21:00',
            repeatIntervalWeeks: 1,
            anchorWeekStart: '2026-09-07',
            effectiveFrom: '2026-09-07'
        });
        let draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-07',
            actorUserId: manager
        });
        const original = draft.shifts[0];

        draft = await domain.DraftService.updateShift({
            versionId: draft.version.id,
            shiftUid: original.shiftUid,
            expectedRevision: draft.version.revision,
            actorUserId: manager,
            startsAtUtc: '2026-09-07T16:00:00.000Z',
            endsAtUtc: '2026-09-07T19:00:00.000Z',
            shiftType: 'floor'
        });
        const edited = draft.shifts.find((item) => item.shiftUid === original.shiftUid);
        assert.equal(edited.startsAtUtc, '2026-09-07T16:00:00.000Z');

        await domain.PatternService.syncDraft(draft.version.id, manager);
        const afterSync = await domain.QueryService.getVersion(draft.version.id);
        assert.equal(afterSync.shifts.length, 1);
        assert.equal(afterSync.shifts[0].startsAtUtc, '2026-09-07T16:00:00.000Z');
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_pattern_exceptions
            WHERE version_id=? AND shift_uid=? AND exception_type='override'`, [draft.version.id, original.shiftUid])).count), 1);
    } finally {
        await close(db);
    }
});

test('R3 verwijderde pattern-dienst wordt niet opnieuw aangemaakt door synchronisatie', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const manager = await createManagerForLocation(db, ave);
        const domain = createRosterDomain(db);
        await domain.ready;

        await domain.PatternService.createPattern({
            actorUserId: manager,
            employeeId: michael,
            locationId: ave,
            weekday: 2,
            startTime: '18:30',
            endTime: '21:00',
            anchorWeekStart: '2026-09-07',
            effectiveFrom: '2026-09-07'
        });
        let draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-07',
            actorUserId: manager
        });
        const shift = draft.shifts[0];

        draft = await domain.DraftService.removeShift({
            versionId: draft.version.id,
            shiftUid: shift.shiftUid,
            expectedRevision: draft.version.revision,
            actorUserId: manager,
            reason: 'Incidenteel niet nodig'
        });
        assert.equal(draft.shifts.length, 0);

        await domain.PatternService.syncDraft(draft.version.id, manager);
        const afterSync = await domain.QueryService.getVersion(draft.version.id);
        assert.equal(afterSync.shifts.length, 0);
    } finally {
        await close(db);
    }
});

test('R3 optimistic locking voorkomt dat een verouderd concept een shiftmutatie uitvoert', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const manager = await createManagerForLocation(db, ave);
        const michael = await employeeId(db);
        const domain = createRosterDomain(db);
        await domain.ready;

        let draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-14',
            actorUserId: manager
        });
        const revision = draft.version.revision;
        draft = await domain.DraftService.addShift({
            versionId: draft.version.id,
            expectedRevision: revision,
            actorUserId: manager,
            employeeId: michael,
            startsAtUtc: '2026-09-14T16:30:00.000Z',
            endsAtUtc: '2026-09-14T19:00:00.000Z',
            shiftType: 'floor'
        });
        await assert.rejects(
            domain.DraftService.addShift({
                versionId: draft.version.id,
                expectedRevision: revision,
                actorUserId: manager,
                employeeId: michael,
                startsAtUtc: '2026-09-15T16:30:00.000Z',
                endsAtUtc: '2026-09-15T19:00:00.000Z',
                shiftType: 'floor'
            }),
            (error) => error && error.code === 'ROSTER_VERSION_CONFLICT'
        );
        assert.equal((await domain.QueryService.getVersion(draft.version.id)).shifts.length, 1);
    } finally {
        await close(db);
    }
});

test('R3 validatie blokkeert overlap maar behandelt beschikbaarheid en locatie als waarschuwing', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const managerAve = await createManagerForLocation(db, ave);
        const managerBve = await createManagerForLocation(db, bve);
        const michael = await employeeId(db);
        const domain = createRosterDomain(db);
        await domain.ready;

        let aveDraft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-21',
            actorUserId: managerAve
        });
        aveDraft = await domain.DraftService.addShift({
            versionId: aveDraft.version.id,
            expectedRevision: aveDraft.version.revision,
            actorUserId: managerAve,
            employeeId: michael,
            startsAtUtc: '2026-09-21T16:30:00.000Z',
            endsAtUtc: '2026-09-21T19:30:00.000Z',
            shiftType: 'floor'
        });

        let bveDraft = await domain.DraftService.ensureDraft({
            locationId: bve,
            weekStart: '2026-09-21',
            actorUserId: managerBve
        });
        bveDraft = await domain.DraftService.addShift({
            versionId: bveDraft.version.id,
            expectedRevision: bveDraft.version.revision,
            actorUserId: managerBve,
            employeeId: michael,
            startsAtUtc: '2026-09-21T17:00:00.000Z',
            endsAtUtc: '2026-09-21T20:00:00.000Z',
            shiftType: 'floor'
        });

        const validation = await domain.ValidationService.validateVersion(aveDraft.version.id);
        assert.equal(validation.valid, false);
        assert.ok(validation.errors.some((item) => item.code === 'SHIFT_OVERLAP'));
        assert.ok(validation.warnings.some((item) => item.code === 'AVAILABILITY_UNKNOWN'));
        assert.ok(validation.information.some((item) => item.code === 'HOUR_BANK_PROJECTION'));
        assert.equal(validation.staffing, null);
    } finally {
        await close(db);
    }
});

test('R3 beschikbaarheidsexception wint van structureel patroon en blijft een waarschuwing', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const manager = await createManagerForLocation(db, ave);
        const employee = await seedContractEmployee(db, ave);
        const domain = createRosterDomain(db);
        await domain.ready;

        await run(db, `INSERT INTO employee_availability_patterns
            (employee_id, weekday, slot_code, availability_state, effective_from)
            VALUES (?, 1, 'EVENING', 'available', '2026-09-01')`, [employee]);
        await run(db, `INSERT INTO employee_availability_exceptions
            (employee_id, availability_date, slot_code, availability_state, reason)
            VALUES (?, '2026-09-28', 'EVENING', 'unavailable', 'Eenmalig afgestemd')`, [employee]);

        let draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-09-28',
            actorUserId: manager
        });
        draft = await domain.DraftService.addShift({
            versionId: draft.version.id,
            expectedRevision: draft.version.revision,
            actorUserId: manager,
            employeeId: employee,
            startsAtUtc: '2026-09-28T16:30:00.000Z',
            endsAtUtc: '2026-09-28T19:30:00.000Z',
            shiftType: 'floor'
        });

        const validation = await domain.ValidationService.validateVersion(draft.version.id);
        assert.equal(validation.valid, true);
        assert.ok(validation.warnings.some((item) =>
            item.code === 'AVAILABILITY_EXCEPTION' && item.source === 'exception'));
    } finally {
        await close(db);
    }
});

test('R3 urenservice rekent organisatiebreed en retourneert contractverschil als urenbankprojectie', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const managerAve = await createManagerForLocation(db, ave);
        const managerBve = await createManagerForLocation(db, bve);
        const employee = await seedContractEmployee(db, ave);
        await run(db, `INSERT INTO employee_location_eligibility
            (employee_id, location_id, effective_from, is_primary, can_be_scheduled)
            VALUES (?, ?, '2026-09-01', 0, 1)`, [employee, bve]);
        const domain = createRosterDomain(db);
        await domain.ready;

        let d1 = await domain.DraftService.ensureDraft({ locationId: ave, weekStart: '2026-10-05', actorUserId: managerAve });
        d1 = await domain.DraftService.addShift({
            versionId: d1.version.id, expectedRevision: d1.version.revision, actorUserId: managerAve,
            employeeId: employee, startsAtUtc: '2026-10-05T16:30:00.000Z', endsAtUtc: '2026-10-05T19:30:00.000Z', shiftType: 'floor'
        });
        let d2 = await domain.DraftService.ensureDraft({ locationId: bve, weekStart: '2026-10-05', actorUserId: managerBve });
        d2 = await domain.DraftService.addShift({
            versionId: d2.version.id, expectedRevision: d2.version.revision, actorUserId: managerBve,
            employeeId: employee, startsAtUtc: '2026-10-06T16:30:00.000Z', endsAtUtc: '2026-10-06T19:30:00.000Z', shiftType: 'floor'
        });

        const hours = await domain.HoursService.projectedWeekMinutes({
            weekStart: '2026-10-05',
            candidateVersionIds: [d1.version.id, d2.version.id]
        });
        const row = hours.find((item) => item.employeeId === employee);
        assert.equal(row.plannedMinutes, 360);
        assert.equal(row.contractMinutes, 600);
        assert.equal(row.hourBankDeltaMinutes, -240);
    } finally {
        await close(db);
    }
});

test('R3 patternvervanging werkt bestaande toekomstige concepten automatisch bij via syncqueue', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const michael = await employeeId(db);
        const manager = await createManagerForLocation(db, ave);
        const domain = createRosterDomain(db);
        await domain.ready;

        const pattern = await domain.PatternService.createPattern({
            actorUserId: manager,
            employeeId: michael,
            locationId: ave,
            weekday: 1,
            startTime: '18:30',
            endTime: '21:00',
            anchorWeekStart: '2026-10-12',
            effectiveFrom: '2026-10-12'
        });
        const draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-10-19',
            actorUserId: manager
        });
        assert.equal(draft.shifts[0].startsAtUtc, '2026-10-19T16:30:00.000Z');

        const replacement = await domain.PatternService.replacePattern({
            patternId: pattern.id,
            actorUserId: manager,
            effectiveFrom: '2026-10-19',
            startTime: '16:00',
            endTime: '21:30',
            anchorWeekStart: '2026-10-19'
        });
        assert.ok(replacement.successor.propagation.some((item) => item.status === 'applied')
            || replacement.propagation.some((item) => item.status === 'applied'));

        const updated = await domain.QueryService.getVersion(draft.version.id);
        assert.equal(updated.shifts.length, 1);
        assert.equal(updated.shifts[0].startsAtUtc, '2026-10-19T14:00:00.000Z');
        assert.equal(updated.shifts[0].endsAtUtc, '2026-10-19T19:30:00.000Z');
    } finally {
        await close(db);
    }
});

test('R3 publiceert batch atomair, schrijft diff en gebruikt daarna alleen nieuwste published versie', async () => {
    const db = await readyDb();
    try {
        const ave = await locationId(db, 'AVE');
        const bve = await locationId(db, 'BVE');
        const admin = await createUser(db, 'r3-publisher', 'admin', 'R3 Publisher');
        const michael = await employeeId(db);
        const domain = createRosterDomain(db);
        await domain.ready;

        let d1 = await domain.DraftService.ensureDraft({ locationId: ave, weekStart: '2026-11-02', actorUserId: admin });
        d1 = await domain.DraftService.addShift({
            versionId: d1.version.id, expectedRevision: d1.version.revision, actorUserId: admin,
            employeeId: michael, startsAtUtc: '2026-11-02T17:30:00.000Z', endsAtUtc: '2026-11-02T20:00:00.000Z', shiftType: 'floor'
        });
        let d2 = await domain.DraftService.ensureDraft({ locationId: bve, weekStart: '2026-11-02', actorUserId: admin });
        d2 = await domain.DraftService.addShift({
            versionId: d2.version.id, expectedRevision: d2.version.revision, actorUserId: admin,
            employeeId: null, startsAtUtc: '2026-11-03T17:30:00.000Z', endsAtUtc: '2026-11-03T20:30:00.000Z', shiftType: 'floor'
        });

        const first = await domain.PublicationService.publish({
            versionIds: [d1.version.id, d2.version.id],
            actorUserId: admin
        });
        assert.equal(first.versions.length, 2);
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_publication_versions
            WHERE publication_id=?`, [first.publicationId])).count), 2);

        const publicAve = await domain.QueryService.getPublishedWeek(ave, '2026-11-02');
        const oldVersionId = publicAve.id;
        let nextDraft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-11-02',
            actorUserId: admin,
            changeNote: 'Vervanging'
        });
        nextDraft = await domain.DraftService.updateShift({
            versionId: nextDraft.version.id,
            shiftUid: nextDraft.shifts[0].shiftUid,
            expectedRevision: nextDraft.version.revision,
            actorUserId: admin,
            employeeId: null
        });

        await assert.rejects(
            domain.PublicationService.publish({ versionIds: [nextDraft.version.id], actorUserId: admin }),
            (error) => error && error.code === 'PUBLICATION_REASON_REQUIRED'
        );
        const second = await domain.PublicationService.publish({
            versionIds: [nextDraft.version.id],
            actorUserId: admin,
            reason: 'Dienst opnieuw opengezet'
        });
        assert.equal(second.versions[0].changeCount, 1);

        const latest = await domain.QueryService.getPublishedWeek(ave, '2026-11-02');
        assert.notEqual(latest.id, oldVersionId);
        assert.equal(latest.shifts[0].employeeId, null);
        assert.equal(Number((await get(db, `SELECT COUNT(*) AS count FROM roster_publication_changes
            WHERE publication_id=? AND change_type='modified'`, [second.publicationId])).count), 1);
        await assert.rejects(
            run(db, `UPDATE roster_shifts SET note='mag niet' WHERE version_id=?`, [oldVersionId]),
            /immutable/
        );
    } finally {
        await close(db);
    }
});
