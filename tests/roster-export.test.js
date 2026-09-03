'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();
const { migrateR1Masterdata } = require('../lib/masterdata-r1b');
const { migrateRosterData } = require('../lib/roster-data');
const { createRosterDomain, migrateRosterDomain } = require('../lib/roster-domain');
const { createRosterPublicationWorkflow, migrateRosterPublication } = require('../lib/roster-publication');
const { migrateRosterOperations } = require('../lib/roster-operations');
const {
    createMonthlyExport,
    intersectingWeekStarts,
    migrateRosterExport
} = require('../lib/roster-export');
const { createGraphRosterExporter } = require('../lib/roster-export-graph');

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
    await migrateRosterPublication(db);
    await migrateRosterOperations(db);
    await migrateRosterExport(db);
    return db;
}

async function createUser(db, username, role = 'admin') {
    return (await run(db, `INSERT INTO users (username, display_name, password_hash, role, is_active)
        VALUES (?, ?, 'x', ?, 1)`, [username, username, role])).lastID;
}

async function publishWholeMonth(db, month, adminId, { addMichaelShift = false } = {}) {
    const domain = createRosterDomain(db);
    await domain.ready;
    const workflow = await createRosterPublicationWorkflow(db);
    const locations = await all(db, `SELECT id, code FROM locations WHERE is_active=1 ORDER BY sort_order`);
    const weeks = intersectingWeekStarts(month);
    const versionIds = [];
    for (const weekStart of weeks) {
        for (const location of locations) {
            const draft = await domain.DraftService.ensureDraft({
                locationId: location.id,
                weekStart,
                actorUserId: adminId,
                changeNote: 'R9 exporttest'
            });
            let version = draft.version;
            if (addMichaelShift && location.code === 'AVE' && weekStart === '2026-08-31') {
                const michael = (await get(db, "SELECT id FROM employees WHERE display_name='Michael'")).id;
                version = await domain.DraftService.addShift({
                    versionId: version.id,
                    expectedRevision: version.revision,
                    actorUserId: adminId,
                    employeeId: michael,
                    startsAtUtc: '2026-09-03T16:30:00.000Z',
                    endsAtUtc: '2026-09-03T19:30:00.000Z',
                    shiftType: 'floor',
                    note: 'R9 testdienst'
                });
            }
            versionIds.push(version.id);
        }
    }
    await workflow.publish({ actorUserId: adminId, versionIds, referenceWeekStart: weeks[0] });
    return versionIds;
}

test('R9 weigert een maandexport zolang niet alle vestiging-weken published zijn', async () => {
    const db = await readyDb();
    try {
        const admin = await createUser(db, 'admin-r9-incomplete');
        const domain = createRosterDomain(db);
        await domain.ready;
        const workflow = await createRosterPublicationWorkflow(db);
        const ave = (await get(db, "SELECT id FROM locations WHERE code='AVE'")).id;
        const draft = await domain.DraftService.ensureDraft({
            locationId: ave,
            weekStart: '2026-08-31',
            actorUserId: admin,
            changeNote: 'Onvolledige maand'
        });
        await workflow.publish({ actorUserId: admin, versionIds: [draft.version.id], referenceWeekStart: '2026-08-31' });
        await assert.rejects(
            createMonthlyExport(db, { month: '2026-09', actorUserId: admin }),
            (error) => error?.code === 'ROSTER_EXPORT_INCOMPLETE' && error?.status === 409 && error.details.missing.length > 0
        );
        const failed = await get(db, "SELECT status FROM roster_exports ORDER BY id DESC LIMIT 1");
        assert.equal(failed.status, 'failed');
    } finally {
        await close(db);
    }
});

test('R9 maakt current-layout maand-Excel uit uitsluitend published canonical shifts', async () => {
    const db = await readyDb();
    try {
        const admin = await createUser(db, 'admin-r9-export');
        await publishWholeMonth(db, '2026-09', admin, { addMichaelShift: true });
        const result = await createMonthlyExport(db, { month: '2026-09', actorUserId: admin });
        assert.match(result.fileName, /^SSO-Rooster-2026-09-exp-\d{6}\.xlsx$/);
        assert.equal(result.checksumSha256, crypto.createHash('sha256').update(result.buffer).digest('hex'));
        assert.ok(result.buffer.length > 1000);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(result.buffer);
        const sheet = workbook.getWorksheet('Sep 26');
        assert.ok(sheet);
        assert.equal(sheet.getCell('A1').value, 'Datum');
        assert.equal(sheet.getCell('B1').value, 'Dag');
        const headerValues = sheet.getRow(1).values;
        const michaelColumn = headerValues.findIndex((value) => value === 'Michael');
        assert.ok(michaelColumn >= 3);
        assert.equal(sheet.getCell(4, michaelColumn).value, '18:30-21:30');
        assert.equal(sheet.getCell(4, michaelColumn).fill.fgColor.argb, 'FFFFFF00');
        assert.equal(sheet.getCell(4, michaelColumn + 2).value, 3);

        const dataSheet = workbook.getWorksheet('SSO_Data');
        assert.ok(dataSheet);
        assert.equal(dataSheet.state, 'veryHidden');
        assert.equal(dataSheet.rowCount, 2);
        assert.equal(dataSheet.getCell('I2').value, result.shifts[0].shiftUid);

        const logged = await get(db, `SELECT status, checksum_sha256 AS checksum, byte_size AS byteSize
            FROM roster_exports WHERE id=?`, [result.exportId]);
        assert.equal(logged.status, 'ready');
        assert.equal(logged.checksum, result.checksumSha256);
        assert.equal(Number(logged.byteSize), result.buffer.length);
        assert.equal(Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_export_versions WHERE export_id=?', [result.exportId])).count), 25);
    } finally {
        await close(db);
    }
});

test('R9 Graph upload archiveert iedere export en overschrijft current alleen voor huidige maand', async () => {
    const calls = [];
    const response = (payload) => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', body: options.body || null });
        if ((options.method || 'GET') === 'GET') return response({ id: 'current-item', name: 'Rooster actueel.xlsx', parentReference: { driveId: 'drive-1' } });
        if (url.includes('Rooster%20Archief')) return response({ id: 'archive-item', name: 'SSO-Rooster-2026-10-exp-000001.xlsx' });
        return response({ id: 'current-item', name: 'Rooster actueel.xlsx' });
    };
    const exporter = createGraphRosterExporter({
        env: { GRAPH_DRIVE_ID: 'drive-1', GRAPH_ITEM_ID: 'current-item', GRAPH_ROSTER_ARCHIVE_PATH: 'Rooster Archief' },
        fetchImpl,
        tokenProvider: async () => 'token'
    });
    const future = await exporter.upload({
        buffer: Buffer.from('xlsx'),
        fileName: 'SSO-Rooster-2026-10-exp-000001.xlsx',
        month: '2026-10',
        currentMonth: '2026-09'
    });
    assert.equal(future.archive.status, 'success');
    assert.equal(future.current.status, 'skipped');
    assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);

    calls.length = 0;
    const current = await exporter.upload({
        buffer: Buffer.from('xlsx'),
        fileName: 'SSO-Rooster-2026-09-exp-000002.xlsx',
        month: '2026-09',
        currentMonth: '2026-09'
    });
    assert.equal(current.current.status, 'success');
    assert.equal(calls.filter((call) => call.method === 'PUT').length, 2);
});
