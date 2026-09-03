'use strict';

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { createRosterDomain, utcToLocal } = require('./roster-domain');
const { migrateRosterExport } = require('./roster-export');

const SHIFT_TYPES = new Set(['floor', 'administration', 'internship']);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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

function restoreError(message, code, status = 400, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details !== null) error.details = details;
    return error;
}

function cellValue(cell) {
    const value = cell?.value;
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') {
        if (value.result !== undefined) return value.result;
        if (value.text !== undefined) return value.text;
        if (value.richText) return value.richText.map((part) => part.text).join('');
    }
    return value;
}

function metadataFromSheet(sheet) {
    const result = {};
    if (!sheet) return result;
    sheet.eachRow((row) => {
        const key = String(cellValue(row.getCell(1)) || '').trim();
        if (!key) return;
        result[key] = cellValue(row.getCell(2));
    });
    return result;
}

function rowsFromDataSheet(sheet) {
    if (!sheet) throw restoreError('SSO_Data ontbreekt in deze Excel-export.', 'EXPORT_DATA_MISSING');
    const headers = new Map();
    sheet.getRow(1).eachCell((cell, column) => {
        headers.set(String(cellValue(cell) || '').trim(), column);
    });
    const required = [
        'export_uid','month','week_start','location_code','shift_uid','employee_code',
        'starts_at_utc','ends_at_utc','shift_type'
    ];
    const missing = required.filter((header) => !headers.has(header));
    if (missing.length) throw restoreError('SSO_Data heeft niet alle vereiste kolommen.', 'EXPORT_DATA_COLUMNS_MISSING', 400, { missing });
    const value = (row, header) => cellValue(row.getCell(headers.get(header)));
    const rows = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const shiftUid = String(value(row, 'shift_uid') || '').trim();
        if (!shiftUid) continue;
        rows.push({
            exportUid: String(value(row, 'export_uid') || '').trim(),
            month: String(value(row, 'month') || '').trim(),
            weekStart: String(value(row, 'week_start') || '').slice(0, 10),
            locationCode: String(value(row, 'location_code') || '').trim(),
            shiftUid,
            employeeCode: String(value(row, 'employee_code') || '').trim() || null,
            startsAtUtc: String(value(row, 'starts_at_utc') || '').trim(),
            endsAtUtc: String(value(row, 'ends_at_utc') || '').trim(),
            shiftType: String(value(row, 'shift_type') || '').trim(),
            note: headers.has('note') ? (String(value(row, 'note') || '').trim() || null) : null
        });
    }
    return rows;
}

async function inspectExportBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw restoreError('Excelbestand is leeg.', 'EXPORT_FILE_EMPTY');
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer);
    } catch (error) {
        throw restoreError(`Excelbestand kon niet worden gelezen: ${error.message}`, 'EXPORT_FILE_INVALID');
    }
    const meta = metadataFromSheet(workbook.getWorksheet('SSO_Export'));
    if (String(meta.format || '') !== 'SSO_ROSTER_EXPORT_V1') {
        throw restoreError('Dit is geen ondersteunde SSO-roosterexport.', 'EXPORT_FORMAT_UNSUPPORTED');
    }
    const exportUid = String(meta.export_uid || '').trim();
    const month = String(meta.month || '').trim();
    if (!exportUid || !MONTH_RE.test(month) || String(meta.source_state || '') !== 'published') {
        throw restoreError('Exportmetadata is onvolledig of ongeldig.', 'EXPORT_METADATA_INVALID');
    }
    const rows = rowsFromDataSheet(workbook.getWorksheet('SSO_Data'));
    const duplicateKeys = new Set();
    const seen = new Set();
    for (const row of rows) {
        if (row.exportUid !== exportUid || row.month !== month) {
            throw restoreError('SSO_Data hoort niet bij de exportmetadata.', 'EXPORT_DATA_METADATA_MISMATCH');
        }
        const key = `${row.locationCode}|${row.weekStart}|${row.shiftUid}`;
        if (seen.has(key)) duplicateKeys.add(key);
        seen.add(key);
    }
    if (duplicateKeys.size) {
        throw restoreError('De export bevat dubbele dienst-ID’s.', 'EXPORT_DUPLICATE_SHIFTS', 400, { keys: [...duplicateKeys] });
    }
    return {
        exportUid,
        month,
        exportId: Number(meta.export_id) || null,
        checksumSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        rows
    };
}

async function verifiedExport(db, parsed) {
    const record = await get(db, `SELECT id, export_uid AS exportUid, month_key AS month,
        status, checksum_sha256 AS checksumSha256, file_name AS fileName
        FROM roster_exports WHERE export_uid=?`, [parsed.exportUid]);
    if (!record || record.status !== 'ready') {
        throw restoreError(
            'Deze export is niet terug te vinden in de SSO-exporthistorie en kan daarom niet als noodbron worden vertrouwd.',
            'EXPORT_NOT_VERIFIED',
            409
        );
    }
    if (record.month !== parsed.month || record.checksumSha256 !== parsed.checksumSha256) {
        throw restoreError(
            'Het Excelbestand wijkt af van de geregistreerde exportchecksum.',
            'EXPORT_CHECKSUM_MISMATCH',
            409,
            { expected: record.checksumSha256, actual: parsed.checksumSha256 }
        );
    }
    const mappings = await all(db, `SELECT ev.version_id AS sourceVersionId, ev.period_id AS periodId,
        ev.location_id AS locationId, ev.week_start AS weekStart,
        l.code AS locationCode, l.name AS locationName, l.timezone
        FROM roster_export_versions ev
        INNER JOIN locations l ON l.id=ev.location_id
        WHERE ev.export_id=?
        ORDER BY ev.week_start, l.sort_order`, [record.id]);
    if (!mappings.length) throw restoreError('Export heeft geen geregistreerde bronversies.', 'EXPORT_VERSION_MAP_MISSING', 409);
    return { record, mappings };
}

async function resolveDesiredRows(db, parsed, mappings) {
    const mappingByKey = new Map(mappings.map((row) => [`${row.locationCode}|${row.weekStart}`, row]));
    const employeeCache = new Map();
    const desired = new Map(mappings.map((row) => [`${row.locationCode}|${row.weekStart}`, []]));
    for (const row of parsed.rows) {
        const mapping = mappingByKey.get(`${row.locationCode}|${row.weekStart}`);
        if (!mapping) {
            throw restoreError('Exportdienst hoort niet bij een geregistreerde locatie/week.', 'EXPORT_SHIFT_PERIOD_UNKNOWN', 409, row);
        }
        if (!SHIFT_TYPES.has(row.shiftType)) throw restoreError('Export bevat een ongeldig diensttype.', 'EXPORT_SHIFT_TYPE_INVALID', 400, row);
        const start = new Date(row.startsAtUtc);
        const end = new Date(row.endsAtUtc);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            throw restoreError('Export bevat een ongeldige diensttijd.', 'EXPORT_SHIFT_TIME_INVALID', 400, row);
        }
        const local = utcToLocal(start.toISOString(), mapping.timezone || 'Europe/Amsterdam');
        if (!local.date.startsWith(`${parsed.month}-`)) {
            throw restoreError('Export bevat een dienst buiten de opgegeven kalendermaand.', 'EXPORT_SHIFT_OUTSIDE_MONTH', 400, row);
        }
        let employeeId = null;
        if (row.employeeCode) {
            if (!employeeCache.has(row.employeeCode)) {
                employeeCache.set(row.employeeCode, await get(db, `SELECT id, employee_code AS employeeCode, display_name AS displayName
                    FROM employees WHERE employee_code=? AND archived_at IS NULL`, [row.employeeCode]));
            }
            const employee = employeeCache.get(row.employeeCode);
            if (!employee) {
                throw restoreError(`Medewerker ${row.employeeCode} bestaat niet in de actuele masterdata.`, 'EXPORT_EMPLOYEE_UNKNOWN', 409, row);
            }
            employeeId = employee.id;
        }
        desired.get(`${row.locationCode}|${row.weekStart}`).push({
            ...row,
            employeeId,
            startsAtUtc: start.toISOString(),
            endsAtUtc: end.toISOString(),
            locationId: mapping.locationId
        });
    }
    return desired;
}

async function activeDrafts(db, mappings) {
    const periodIds = [...new Set(mappings.map((row) => Number(row.periodId)))];
    if (!periodIds.length) return [];
    const placeholders = periodIds.map(() => '?').join(',');
    return all(db, `SELECT v.id AS versionId, v.period_id AS periodId, p.week_start AS weekStart,
        l.code AS locationCode, l.name AS locationName
        FROM roster_versions v
        INNER JOIN roster_periods p ON p.id=v.period_id
        INNER JOIN locations l ON l.id=p.location_id
        WHERE v.state='draft' AND v.period_id IN (${placeholders})
        ORDER BY p.week_start, l.sort_order`, periodIds);
}

async function latestPublished(db, periodId) {
    return get(db, `SELECT id, version_no AS versionNo FROM roster_versions
        WHERE period_id=? AND state='published' ORDER BY version_no DESC LIMIT 1`, [periodId]);
}

async function createDraftFromPublished(db, mapping, actorUserId, exportUid) {
    const published = await latestPublished(db, mapping.periodId);
    if (!published) {
        throw restoreError('Noodherstel vereist een actuele gepubliceerde basisversie.', 'EXPORT_RESTORE_NO_PUBLISHED_BASE', 409, mapping);
    }
    const next = await get(db, 'SELECT COALESCE(MAX(version_no),0)+1 AS versionNo FROM roster_versions WHERE period_id=?', [mapping.periodId]);
    const created = await run(db, `INSERT INTO roster_versions
        (period_id, version_no, state, based_on_version_id, revision, change_note, created_by_user_id)
        VALUES (?, ?, 'draft', ?, 1, ?, ?)`, [
        mapping.periodId,
        Number(next.versionNo),
        published.id,
        `Noodherstel uit Excel-export ${exportUid}`,
        actorUserId
    ]);
    await run(db, `INSERT INTO roster_shifts
        (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type,
         source_pattern_id, source_pattern_revision, note, legacy_source_hash, created_by_user_id)
        SELECT shift_uid, ?, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type,
               source_pattern_id, source_pattern_revision, note, legacy_source_hash, ?
        FROM roster_shifts WHERE version_id=?`, [created.lastID, actorUserId, published.id]);
    await run(db, `INSERT INTO roster_pattern_exceptions
        (version_id, shift_uid, pattern_id, exception_type, note, created_by_user_id)
        SELECT ?, shift_uid, pattern_id, exception_type, note, ?
        FROM roster_pattern_exceptions WHERE version_id=?`, [created.lastID, actorUserId, published.id]);
    return { versionId: created.lastID, basedOnVersionId: published.id };
}

async function replaceMonthInDraft(db, mapping, draft, month, desiredRows, actorUserId, exportUid) {
    const currentRows = await all(db, `SELECT shift_uid AS shiftUid, employee_id AS employeeId,
        starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc, shift_type AS shiftType,
        source_pattern_id AS sourcePatternId, source_pattern_revision AS sourcePatternRevision,
        note, legacy_source_hash AS legacySourceHash
        FROM roster_shifts WHERE version_id=?`, [draft.versionId]);
    const currentMonth = currentRows.filter((row) =>
        utcToLocal(row.startsAtUtc, mapping.timezone || 'Europe/Amsterdam').date.startsWith(`${month}-`));
    const currentByUid = new Map(currentMonth.map((row) => [row.shiftUid, row]));
    const desiredUids = new Set(desiredRows.map((row) => row.shiftUid));

    for (const current of currentMonth) {
        if (current.sourcePatternId !== null && current.sourcePatternId !== undefined) {
            const type = desiredUids.has(current.shiftUid) ? 'override' : 'suppress';
            await run(db, `INSERT INTO roster_pattern_exceptions
                (version_id, shift_uid, pattern_id, exception_type, note, created_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(version_id, shift_uid) DO UPDATE SET
                    pattern_id=excluded.pattern_id,
                    exception_type=excluded.exception_type,
                    note=excluded.note,
                    created_by_user_id=excluded.created_by_user_id,
                    updated_at=CURRENT_TIMESTAMP`, [
                draft.versionId, current.shiftUid, current.sourcePatternId, type,
                `Noodherstel uit export ${exportUid}`, actorUserId
            ]);
        }
    }

    for (const current of currentMonth) {
        await run(db, 'DELETE FROM roster_shifts WHERE version_id=? AND shift_uid=?', [draft.versionId, current.shiftUid]);
    }

    for (const desired of desiredRows) {
        const previous = currentByUid.get(desired.shiftUid);
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type,
             source_pattern_id, source_pattern_revision, note, legacy_source_hash, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            desired.shiftUid,
            draft.versionId,
            desired.employeeId,
            mapping.locationId,
            desired.startsAtUtc,
            desired.endsAtUtc,
            desired.shiftType,
            previous?.sourcePatternId ?? null,
            previous?.sourcePatternRevision ?? null,
            desired.note,
            previous?.legacySourceHash ?? null,
            actorUserId
        ]);
    }

    await run(db, 'UPDATE roster_versions SET revision=revision+1 WHERE id=?', [draft.versionId]);
    await run(db, `INSERT INTO audit_events
        (actor_user_id, entity_type, entity_id, action, after_json, note, correlation_id, cml_visible)
        VALUES (?, 'roster_version', ?, 'emergency_export_restore', ?, ?, ?, 0)`, [
        actorUserId,
        String(draft.versionId),
        JSON.stringify({ exportUid, month, restoredShiftCount: desiredRows.length, basedOnVersionId: draft.basedOnVersionId }),
        `Excel-noodherstel ${month}; alleen concept aangemaakt.`,
        exportUid
    ]);
}

async function restoreMonthlyExport(db, { buffer, actorUserId, dryRun = false }) {
    await migrateRosterExport(db);
    const domain = createRosterDomain(db);
    await domain.ready;
    if (!await domain.AuthorizationService.canPublish(Number(actorUserId))) {
        throw restoreError('Alleen Admin mag een Excel-noodherstel voorbereiden.', 'EXPORT_RESTORE_ADMIN_REQUIRED', 403);
    }

    const parsed = await inspectExportBuffer(buffer);
    const verified = await verifiedExport(db, parsed);
    const desired = await resolveDesiredRows(db, parsed, verified.mappings);
    const conflicts = await activeDrafts(db, verified.mappings);
    if (conflicts.length) {
        throw restoreError(
            'Noodherstel is gestopt omdat voor één of meer betrokken weken al een actief concept bestaat.',
            'EXPORT_RESTORE_DRAFT_EXISTS',
            409,
            { conflicts }
        );
    }

    if (dryRun) {
        return {
            mode: 'dry-run',
            exportUid: parsed.exportUid,
            month: parsed.month,
            checksumSha256: parsed.checksumSha256,
            periodCount: verified.mappings.length,
            shiftCount: parsed.rows.length,
            verified: true,
            conflicts: []
        };
    }

    const drafts = [];
    try {
        await exec(db, 'BEGIN IMMEDIATE TRANSACTION;');
        for (const mapping of verified.mappings) {
            const draft = await createDraftFromPublished(db, mapping, Number(actorUserId), parsed.exportUid);
            await replaceMonthInDraft(
                db,
                mapping,
                draft,
                parsed.month,
                desired.get(`${mapping.locationCode}|${mapping.weekStart}`) || [],
                Number(actorUserId),
                parsed.exportUid
            );
            drafts.push({ ...mapping, ...draft });
        }
        await exec(db, 'COMMIT;');
    } catch (error) {
        await exec(db, 'ROLLBACK;').catch(() => {});
        throw error;
    }

    const validation = [];
    for (const draft of drafts) {
        validation.push({
            versionId: draft.versionId,
            locationCode: draft.locationCode,
            weekStart: draft.weekStart,
            validation: await domain.ValidationService.validateVersion(draft.versionId)
        });
    }
    return {
        mode: 'committed',
        exportUid: parsed.exportUid,
        month: parsed.month,
        checksumSha256: parsed.checksumSha256,
        periodCount: drafts.length,
        shiftCount: parsed.rows.length,
        drafts,
        validation,
        published: false
    };
}

module.exports = {
    inspectExportBuffer,
    restoreMonthlyExport,
    restoreError
};
