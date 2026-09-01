'use strict';

const crypto = require('crypto');
const { all, exec, get, run } = require('./roster-data');
const { addDays, localDateTimeToUtc, mondayOf } = require('./roster-domain');

const DEFAULT_BASELINE = '2026-09-01';
const OPEN_EMPLOYEE_NAMES = new Set(['open', 'openstaand', 'openstaande dienst']);

function clean(value) {
    return String(value ?? '').trim();
}

function lower(value) {
    return clean(value).toLocaleLowerCase('nl-NL');
}

function minutes(time) {
    const [hours, mins] = String(time || '').split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(mins)) return null;
    return hours * 60 + mins;
}

function legacyShiftUid(rootIdentity) {
    const digest = crypto.createHash('sha256').update(String(rootIdentity)).digest('hex').slice(0, 40);
    return `LEGACY:${digest}`;
}

async function tableExists(db, tableName) {
    return Boolean(await get(db, `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`, [tableName]));
}

async function ensureLegacyRosterAdapterSchema(db) {
    await exec(db, `
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS roster_legacy_import_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_uid TEXT NOT NULL UNIQUE,
            source_import_id INTEGER,
            planning_baseline TEXT NOT NULL,
            source_items INTEGER NOT NULL DEFAULT 0,
            source_shift_items INTEGER NOT NULL DEFAULT 0,
            staged_nonshift_items INTEGER NOT NULL DEFAULT 0,
            canonical_shifts INTEGER NOT NULL DEFAULT 0,
            unresolved_items INTEGER NOT NULL DEFAULT 0,
            protected_periods INTEGER NOT NULL DEFAULT 0,
            parity_status TEXT NOT NULL CHECK (parity_status IN ('match', 'attention', 'failed')),
            report_json TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_import_id) REFERENCES roster_imports(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS roster_legacy_import_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL,
            period_id INTEGER,
            version_id INTEGER,
            location_id INTEGER NOT NULL,
            week_start TEXT NOT NULL,
            source_shift_count INTEGER NOT NULL DEFAULT 0,
            canonical_shift_count INTEGER NOT NULL DEFAULT 0,
            action TEXT NOT NULL CHECK (action IN (
                'created_draft', 'reconciled_draft', 'matched_draft', 'matched_published',
                'protected_draft', 'skipped_empty'
            )),
            detail TEXT,
            FOREIGN KEY (batch_id) REFERENCES roster_legacy_import_batches(id) ON DELETE CASCADE,
            FOREIGN KEY (period_id) REFERENCES roster_periods(id) ON DELETE SET NULL,
            FOREIGN KEY (version_id) REFERENCES roster_versions(id) ON DELETE SET NULL,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
            UNIQUE (batch_id, location_id, week_start)
        );

        CREATE TABLE IF NOT EXISTS roster_legacy_nonshift_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL,
            source_identity TEXT NOT NULL,
            roster_date TEXT NOT NULL,
            employee_name TEXT,
            item_type TEXT NOT NULL,
            status TEXT,
            note TEXT,
            source_sheet TEXT,
            source_cell TEXT,
            payload_json TEXT,
            FOREIGN KEY (batch_id) REFERENCES roster_legacy_import_batches(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS roster_legacy_unresolved_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL,
            source_identity TEXT NOT NULL,
            roster_date TEXT,
            employee_name TEXT,
            location_name TEXT,
            reason_code TEXT NOT NULL,
            detail TEXT,
            payload_json TEXT,
            FOREIGN KEY (batch_id) REFERENCES roster_legacy_import_batches(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_legacy_import_periods_batch
            ON roster_legacy_import_periods(batch_id, week_start, location_id);
        CREATE INDEX IF NOT EXISTS idx_legacy_nonshift_batch
            ON roster_legacy_nonshift_items(batch_id, roster_date);
        CREATE INDEX IF NOT EXISTS idx_legacy_unresolved_batch
            ON roster_legacy_unresolved_items(batch_id, roster_date);
    `);
}

async function migrateLegacyRosterAdapter(db) {
    await ensureLegacyRosterAdapterSchema(db);
    return {
        batches: Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_legacy_import_batches'))?.count || 0),
        unresolved: Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_legacy_unresolved_items'))?.count || 0)
    };
}

async function loadEffectiveLegacyItems(db, planningBaseline) {
    if (!await tableExists(db, 'roster_items')) return [];

    const baseRows = await all(db, `SELECT
        id,
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
        source_hash AS sourceHash
        FROM roster_items
        WHERE date(roster_date) >= date(?)`, [planningBaseline]);

    const effective = new Map();
    for (const row of baseRows) {
        const identity = row.sourceHash || `base:${row.id}`;
        effective.set(identity, {
            ...row,
            sourceIdentity: identity,
            rootIdentity: identity,
            isOverride: false
        });
    }

    if (await tableExists(db, 'roster_overrides')) {
        const overrides = await all(db, `SELECT
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
            is_deleted AS isDeleted
            FROM roster_overrides
            WHERE date(roster_date) >= date(?)
            ORDER BY id`, [planningBaseline]);

        for (const row of overrides) {
            let rootIdentity = row.sourceHash || `override:${row.id}`;
            if (row.sourceHash && effective.has(row.sourceHash)) {
                rootIdentity = effective.get(row.sourceHash).rootIdentity;
                effective.delete(row.sourceHash);
            }
            if (row.isDeleted) continue;
            const identity = `override:${row.id}`;
            effective.set(identity, {
                ...row,
                sourceIdentity: identity,
                rootIdentity,
                sourceSheet: 'Roosterwijziging',
                sourceCell: null,
                isOverride: true
            });
        }
    }

    return [...effective.values()].sort((a, b) => {
        return String(a.rosterDate).localeCompare(String(b.rosterDate))
            || String(a.location || '').localeCompare(String(b.location || ''), 'nl')
            || String(a.startTime || '').localeCompare(String(b.startTime || ''))
            || String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'nl');
    });
}

async function loadMasterdataMaps(db) {
    const employees = await all(db, `SELECT id, display_name AS displayName FROM employees WHERE archived_at IS NULL`);
    const aliases = await all(db, `SELECT alias_name AS aliasName, canonical_name AS canonicalName FROM legacy_employee_aliases`);
    const locations = await all(db, `SELECT id, code, name, timezone FROM locations WHERE is_active=1`);

    const employeeByName = new Map(employees.map((row) => [lower(row.displayName), row]));
    for (const alias of aliases) {
        const canonical = employeeByName.get(lower(alias.canonicalName));
        if (canonical) employeeByName.set(lower(alias.aliasName), canonical);
    }
    return {
        employeeByName,
        locationByName: new Map(locations.map((row) => [lower(row.name), row]))
    };
}

function isOpenLegacyShift(item) {
    return OPEN_EMPLOYEE_NAMES.has(lower(item.employeeName)) || lower(item.status) === 'openstaande dienst';
}

function makeUnresolved(item, reasonCode, detail) {
    return {
        sourceIdentity: item.sourceIdentity,
        rosterDate: item.rosterDate || null,
        employeeName: item.employeeName || null,
        locationName: item.location || null,
        reasonCode,
        detail,
        payload: item
    };
}

function mapLegacyShift(item, maps) {
    const location = maps.locationByName.get(lower(item.location));
    if (!location) return { unresolved: makeUnresolved(item, 'LOCATION_NOT_FOUND', 'Vestiging kon niet naar R1-masterdata worden vertaald.') };

    const startMinutes = minutes(item.startTime);
    const endMinutes = minutes(item.endTime);
    if (startMinutes === null || endMinutes === null || !item.rosterDate) {
        return { unresolved: makeUnresolved(item, 'INVALID_SHIFT_TIME', 'Dienst mist een geldige datum of begin/eindtijd.') };
    }

    let employeeId = null;
    if (!isOpenLegacyShift(item)) {
        const employee = maps.employeeByName.get(lower(item.employeeName));
        if (!employee) return { unresolved: makeUnresolved(item, 'EMPLOYEE_NOT_FOUND', 'Medewerker kon niet naar R1-masterdata worden vertaald.') };
        employeeId = employee.id;
    }

    const endDate = endMinutes <= startMinutes ? addDays(item.rosterDate, 1) : item.rosterDate;
    return {
        shift: {
            shiftUid: legacyShiftUid(item.rootIdentity),
            employeeId,
            locationId: location.id,
            locationCode: location.code,
            locationName: location.name,
            weekStart: mondayOf(item.rosterDate),
            startsAtUtc: localDateTimeToUtc(item.rosterDate, item.startTime, location.timezone || 'Europe/Amsterdam'),
            endsAtUtc: localDateTimeToUtc(endDate, item.endTime, location.timezone || 'Europe/Amsterdam'),
            shiftType: 'floor',
            note: item.note || null,
            legacySourceHash: item.rootIdentity,
            sourceIdentity: item.sourceIdentity
        }
    };
}

function canonicalComparable(row) {
    return {
        shiftUid: row.shiftUid,
        employeeId: row.employeeId ?? null,
        locationId: row.locationId,
        startsAtUtc: row.startsAtUtc,
        endsAtUtc: row.endsAtUtc,
        shiftType: row.shiftType,
        note: row.note || null,
        legacySourceHash: row.legacySourceHash || null
    };
}

function normalizedShiftList(rows) {
    return rows.map(canonicalComparable).sort((a, b) => a.shiftUid.localeCompare(b.shiftUid));
}

function shiftListsEqual(a, b) {
    return JSON.stringify(normalizedShiftList(a)) === JSON.stringify(normalizedShiftList(b));
}

async function versionShifts(db, versionId) {
    if (!versionId) return [];
    return all(db, `SELECT
        shift_uid AS shiftUid,
        employee_id AS employeeId,
        location_id AS locationId,
        starts_at_utc AS startsAtUtc,
        ends_at_utc AS endsAtUtc,
        shift_type AS shiftType,
        note,
        legacy_source_hash AS legacySourceHash,
        source_pattern_id AS sourcePatternId
        FROM roster_shifts WHERE version_id=?
        ORDER BY shift_uid`, [versionId]);
}

async function ensurePeriod(db, locationId, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
        VALUES (?, ?, ?)
        ON CONFLICT(location_id, week_start) DO NOTHING`, [locationId, weekStart, weekEnd]);
    return get(db, `SELECT id, location_id AS locationId, week_start AS weekStart, week_end AS weekEnd
        FROM roster_periods WHERE location_id=? AND week_start=?`, [locationId, weekStart]);
}

async function currentPeriodVersions(db, periodId) {
    return {
        draft: await get(db, `SELECT id, version_no AS versionNo, based_on_version_id AS basedOnVersionId, revision
            FROM roster_versions WHERE period_id=? AND state='draft' LIMIT 1`, [periodId]),
        published: await get(db, `SELECT id, version_no AS versionNo, revision
            FROM roster_versions WHERE period_id=? AND state='published' ORDER BY version_no DESC LIMIT 1`, [periodId])
    };
}

async function draftIsImportManaged(db, versionId) {
    const shifts = await versionShifts(db, versionId);
    if (shifts.some((row) => !row.legacySourceHash || row.sourcePatternId !== null)) return false;
    const exceptions = Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_pattern_exceptions WHERE version_id=?', [versionId]))?.count || 0);
    return exceptions === 0;
}

async function insertDesiredShifts(db, versionId, shifts, actorUserId) {
    for (const shift of shifts) {
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc,
             shift_type, note, legacy_source_hash, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            shift.shiftUid,
            versionId,
            shift.employeeId,
            shift.locationId,
            shift.startsAtUtc,
            shift.endsAtUtc,
            shift.shiftType,
            shift.note,
            shift.legacySourceHash,
            actorUserId || null
        ]);
    }
}

async function createImportDraft(db, period, published, shifts, actorUserId, importUid) {
    const next = Number((await get(db, 'SELECT COALESCE(MAX(version_no), 0) + 1 AS nextNo FROM roster_versions WHERE period_id=?', [period.id])).nextNo);
    const result = await run(db, `INSERT INTO roster_versions
        (period_id, version_no, state, based_on_version_id, revision, change_note, created_by_user_id)
        VALUES (?, ?, 'draft', ?, 1, ?, ?)`, [
        period.id,
        next,
        published ? published.id : null,
        `Legacy-import ${importUid}`,
        actorUserId || null
    ]);
    await insertDesiredShifts(db, result.lastID, shifts, actorUserId);
    return result.lastID;
}

async function auditImport(db, actorUserId, entityType, entityId, action, note, importUid, after = null) {
    await run(db, `INSERT INTO audit_events
        (actor_user_id, entity_type, entity_id, action, after_json, note, correlation_id, cml_visible)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)`, [
        actorUserId || null,
        entityType,
        String(entityId),
        action,
        after ? JSON.stringify(after) : null,
        note || null,
        importUid
    ]);
}

async function previousImportedPeriods(db) {
    const latest = await get(db, 'SELECT id FROM roster_legacy_import_batches ORDER BY id DESC LIMIT 1');
    if (!latest) return [];
    return all(db, `SELECT location_id AS locationId, week_start AS weekStart
        FROM roster_legacy_import_periods WHERE batch_id=?`, [latest.id]);
}

async function reconcilePeriod(db, {
    locationId,
    weekStart,
    desiredShifts,
    actorUserId,
    importUid
}) {
    const period = await ensurePeriod(db, locationId, weekStart);
    const versions = await currentPeriodVersions(db, period.id);

    if (versions.draft) {
        const current = await versionShifts(db, versions.draft.id);
        if (!await draftIsImportManaged(db, versions.draft.id)) {
            return {
                periodId: period.id,
                versionId: versions.draft.id,
                action: 'protected_draft',
                canonicalShiftCount: current.length,
                detail: 'Bestaande draft bevat handmatige of pattern-data en is niet door de Excel-adapter overschreven.'
            };
        }
        if (shiftListsEqual(current, desiredShifts)) {
            return {
                periodId: period.id,
                versionId: versions.draft.id,
                action: 'matched_draft',
                canonicalShiftCount: current.length,
                detail: null
            };
        }
        await run(db, 'DELETE FROM roster_shifts WHERE version_id=?', [versions.draft.id]);
        await insertDesiredShifts(db, versions.draft.id, desiredShifts, actorUserId);
        await run(db, `UPDATE roster_versions
            SET revision=revision+1, change_note=?, created_by_user_id=COALESCE(?, created_by_user_id)
            WHERE id=? AND state='draft'`, [`Legacy-import ${importUid}`, actorUserId || null, versions.draft.id]);
        await auditImport(db, actorUserId, 'roster_version', versions.draft.id, 'legacy_reconciled',
            `${desiredShifts.length} legacy dienst(en) gereconcilieerd.`, importUid);
        return {
            periodId: period.id,
            versionId: versions.draft.id,
            action: 'reconciled_draft',
            canonicalShiftCount: desiredShifts.length,
            detail: null
        };
    }

    if (versions.published) {
        const publishedShifts = await versionShifts(db, versions.published.id);
        if (shiftListsEqual(publishedShifts, desiredShifts)) {
            return {
                periodId: period.id,
                versionId: versions.published.id,
                action: 'matched_published',
                canonicalShiftCount: publishedShifts.length,
                detail: 'Excel en de nieuwste gepubliceerde versie zijn gelijk; er is geen nieuwe draft gemaakt.'
            };
        }
    }

    if (!versions.published && desiredShifts.length === 0) {
        return {
            periodId: period.id,
            versionId: null,
            action: 'skipped_empty',
            canonicalShiftCount: 0,
            detail: 'Geen bronshifts en geen gepubliceerde versie om te wijzigen.'
        };
    }

    const versionId = await createImportDraft(db, period, versions.published, desiredShifts, actorUserId, importUid);
    await auditImport(db, actorUserId, 'roster_version', versionId, 'legacy_draft_created',
        `Canonical draft uit legacy-rooster gemaakt (${desiredShifts.length} dienst(en)).`, importUid);
    return {
        periodId: period.id,
        versionId,
        action: 'created_draft',
        canonicalShiftCount: desiredShifts.length,
        detail: versions.published ? 'Nieuwe draft gebaseerd op afwijkend legacy-rooster; published versie bleef immutable.' : null
    };
}

async function latestSourceImportId(db) {
    if (!await tableExists(db, 'roster_imports')) return null;
    const row = await get(db, `SELECT id FROM roster_imports
        WHERE status='success' ORDER BY id DESC LIMIT 1`);
    return row ? row.id : null;
}

async function importLegacyRosterToCanonical(db, {
    actorUserId = null,
    planningBaseline = DEFAULT_BASELINE,
    sourceImportId = null
} = {}) {
    await ensureLegacyRosterAdapterSchema(db);
    const importUid = `LEGACY-IMPORT:${crypto.randomUUID()}`;
    const effectiveItems = await loadEffectiveLegacyItems(db, planningBaseline);
    const maps = await loadMasterdataMaps(db);
    const groups = new Map();
    const nonshiftItems = [];
    const unresolved = [];

    for (const item of effectiveItems) {
        if (item.itemType !== 'shift') {
            nonshiftItems.push(item);
            continue;
        }
        const mapped = mapLegacyShift(item, maps);
        if (mapped.unresolved) {
            unresolved.push(mapped.unresolved);
            continue;
        }
        const key = `${mapped.shift.locationId}|${mapped.shift.weekStart}`;
        if (!groups.has(key)) groups.set(key, { locationId: mapped.shift.locationId, weekStart: mapped.shift.weekStart, shifts: [] });
        groups.get(key).shifts.push(mapped.shift);
    }

    const previousPeriods = await previousImportedPeriods(db);
    for (const previous of previousPeriods) {
        const key = `${previous.locationId}|${previous.weekStart}`;
        if (!groups.has(key)) groups.set(key, { locationId: previous.locationId, weekStart: previous.weekStart, shifts: [] });
    }

    const resolvedSourceImportId = sourceImportId || await latestSourceImportId(db);
    let transactionStarted = false;
    try {
        await exec(db, 'BEGIN IMMEDIATE TRANSACTION;');
        transactionStarted = true;
        const batch = await run(db, `INSERT INTO roster_legacy_import_batches
            (import_uid, source_import_id, planning_baseline, source_items, source_shift_items,
             staged_nonshift_items, canonical_shifts, unresolved_items, protected_periods, parity_status)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 'match')`, [
            importUid,
            resolvedSourceImportId,
            planningBaseline,
            effectiveItems.length,
            effectiveItems.filter((item) => item.itemType === 'shift').length,
            nonshiftItems.length,
            unresolved.length
        ]);

        for (const item of nonshiftItems) {
            await run(db, `INSERT INTO roster_legacy_nonshift_items
                (batch_id, source_identity, roster_date, employee_name, item_type, status, note,
                 source_sheet, source_cell, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                batch.lastID,
                item.rootIdentity || item.sourceIdentity,
                item.rosterDate,
                item.employeeName || null,
                item.itemType,
                item.status || null,
                item.note || null,
                item.sourceSheet || null,
                item.sourceCell || null,
                JSON.stringify(item)
            ]);
        }

        for (const item of unresolved) {
            await run(db, `INSERT INTO roster_legacy_unresolved_items
                (batch_id, source_identity, roster_date, employee_name, location_name, reason_code, detail, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                batch.lastID,
                item.sourceIdentity,
                item.rosterDate,
                item.employeeName,
                item.locationName,
                item.reasonCode,
                item.detail,
                JSON.stringify(item.payload)
            ]);
        }

        const periods = [];
        let canonicalShifts = 0;
        let protectedPeriods = 0;
        for (const group of [...groups.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.locationId - b.locationId)) {
            const result = await reconcilePeriod(db, {
                locationId: group.locationId,
                weekStart: group.weekStart,
                desiredShifts: group.shifts,
                actorUserId,
                importUid
            });
            if (result.action === 'protected_draft') protectedPeriods += 1;
            if (result.action !== 'protected_draft' && result.action !== 'skipped_empty') canonicalShifts += result.canonicalShiftCount;
            periods.push({
                locationId: group.locationId,
                weekStart: group.weekStart,
                sourceShiftCount: group.shifts.length,
                ...result
            });
            await run(db, `INSERT INTO roster_legacy_import_periods
                (batch_id, period_id, version_id, location_id, week_start, source_shift_count,
                 canonical_shift_count, action, detail)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                batch.lastID,
                result.periodId,
                result.versionId,
                group.locationId,
                group.weekStart,
                group.shifts.length,
                result.canonicalShiftCount,
                result.action,
                result.detail || null
            ]);
        }

        const parityStatus = unresolved.length || protectedPeriods ? 'attention' : 'match';
        const report = {
            importUid,
            batchId: batch.lastID,
            sourceImportId: resolvedSourceImportId,
            planningBaseline,
            totals: {
                sourceItems: effectiveItems.length,
                sourceShiftItems: effectiveItems.filter((item) => item.itemType === 'shift').length,
                stagedNonshiftItems: nonshiftItems.length,
                mappedShiftItems: [...groups.values()].reduce((sum, group) => sum + group.shifts.length, 0),
                canonicalShifts,
                unresolvedItems: unresolved.length,
                protectedPeriods
            },
            parityStatus,
            periods,
            unresolved: unresolved.map(({ payload, ...item }) => item),
            publicationSafety: 'Adapter maakt of wijzigt uitsluitend drafts; published versies worden nooit gemuteerd.'
        };

        await run(db, `UPDATE roster_legacy_import_batches
            SET canonical_shifts=?, protected_periods=?, parity_status=?, report_json=?
            WHERE id=?`, [canonicalShifts, protectedPeriods, parityStatus, JSON.stringify(report), batch.lastID]);
        await auditImport(db, actorUserId, 'roster_legacy_import', batch.lastID, 'completed',
            `Legacy parity: ${parityStatus}.`, importUid, report.totals);
        await exec(db, 'COMMIT;');
        transactionStarted = false;
        return report;
    } catch (error) {
        if (transactionStarted) await exec(db, 'ROLLBACK;').catch(() => {});
        throw error;
    }
}

async function latestLegacyParityReport(db) {
    const row = await get(db, `SELECT id, import_uid AS importUid, source_import_id AS sourceImportId,
        planning_baseline AS planningBaseline, parity_status AS parityStatus, report_json AS reportJson,
        created_at AS createdAt
        FROM roster_legacy_import_batches ORDER BY id DESC LIMIT 1`);
    if (!row) return null;
    return {
        id: row.id,
        importUid: row.importUid,
        sourceImportId: row.sourceImportId,
        planningBaseline: row.planningBaseline,
        parityStatus: row.parityStatus,
        createdAt: row.createdAt,
        report: row.reportJson ? JSON.parse(row.reportJson) : null
    };
}

module.exports = {
    DEFAULT_BASELINE,
    ensureLegacyRosterAdapterSchema,
    importLegacyRosterToCanonical,
    latestLegacyParityReport,
    legacyShiftUid,
    loadEffectiveLegacyItems,
    migrateLegacyRosterAdapter
};
