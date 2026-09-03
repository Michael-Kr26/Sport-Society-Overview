'use strict';

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { migrateRosterOperations } = require('./roster-operations');
const { utcToLocal } = require('./roster-domain');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_ZONE = 'Europe/Amsterdam';
const LOCATION_FILLS = Object.freeze({
    BVE: null,
    AVE: 'FFFFFF00',
    VHU: 'FF7030A0',
    WEK: 'FF00B0F0',
    HAR: 'FF92D050'
});
const MONTH_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
const DAY_LABELS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

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

function exportError(message, code, status = 400, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details !== null) error.details = details;
    return error;
}

function assertMonth(value) {
    const month = String(value || '');
    if (!MONTH_RE.test(month)) throw exportError('Gebruik een geldige maand in formaat JJJJ-MM.', 'INVALID_EXPORT_MONTH');
    return month;
}

function monthRange(month) {
    const [year, number] = assertMonth(month).split('-').map(Number);
    const start = `${year}-${String(number).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10);
    return { start, end };
}

function addDays(value, amount) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + amount, 12)).toISOString().slice(0, 10);
}

function mondayOf(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
}

function intersectingWeekStarts(month) {
    const { start, end } = monthRange(month);
    const weeks = [];
    for (let week = mondayOf(start); week <= end; week = addDays(week, 7)) weeks.push(week);
    return weeks;
}

function datesInMonth(month) {
    const { start, end } = monthRange(month);
    const dates = [];
    for (let value = start; value <= end; value = addDays(value, 1)) dates.push(value);
    return dates;
}

function currentAmsterdamMonth(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(now).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}`;
}

function sheetName(month) {
    const [year, number] = month.split('-').map(Number);
    return `${MONTH_LABELS[number - 1]} ${String(year).slice(-2)}`;
}

function shortDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
}

function durationMinutes(startUtc, endUtc) {
    const milliseconds = new Date(endUtc).getTime() - new Date(startUtc).getTime();
    return Math.max(0, Math.round(milliseconds / 60000));
}

function applyLocationFill(cell, code) {
    const argb = LOCATION_FILLS[code];
    if (!argb) return;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function visibleShiftText(shift, showLocation = false) {
    const base = `${shift.localStartTime}-${shift.localEndTime}`;
    return showLocation ? `${base} (${shift.locationCode})` : base;
}

async function migrateRosterExport(db) {
    await migrateRosterOperations(db);
    await exec(db, `
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS roster_exports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            export_uid TEXT NOT NULL UNIQUE,
            month_key TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'organization' CHECK (scope='organization'),
            source_state TEXT NOT NULL DEFAULT 'published' CHECK (source_state='published'),
            status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','ready','failed')),
            file_name TEXT,
            checksum_sha256 TEXT,
            byte_size INTEGER,
            created_by_user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            error_message TEXT,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS roster_export_versions (
            export_id INTEGER NOT NULL,
            version_id INTEGER NOT NULL,
            period_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            week_start TEXT NOT NULL,
            PRIMARY KEY (export_id, version_id),
            FOREIGN KEY (export_id) REFERENCES roster_exports(id) ON DELETE CASCADE,
            FOREIGN KEY (version_id) REFERENCES roster_versions(id) ON DELETE RESTRICT,
            FOREIGN KEY (period_id) REFERENCES roster_periods(id) ON DELETE RESTRICT,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS roster_export_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            export_id INTEGER NOT NULL,
            channel TEXT NOT NULL CHECK (channel IN ('download','sharepoint_current','sharepoint_archive')),
            status TEXT NOT NULL CHECK (status IN ('success','failed','skipped')),
            remote_drive_id TEXT,
            remote_item_id TEXT,
            remote_name TEXT,
            details_json TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (export_id) REFERENCES roster_exports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_roster_exports_month_created
            ON roster_exports(month_key, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_roster_export_deliveries_export
            ON roster_export_deliveries(export_id, created_at);
    `);
    return {
        exports: Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_exports'))?.count || 0)
    };
}

async function latestPublishedVersions(db, month) {
    const { start, end } = monthRange(month);
    return all(db, `WITH latest AS (
        SELECT p.id AS period_id, MAX(v.version_no) AS version_no
        FROM roster_periods p
        INNER JOIN roster_versions v ON v.period_id=p.id AND v.state='published'
        WHERE date(p.week_end) >= date(?) AND date(p.week_start) <= date(?)
        GROUP BY p.id
    )
    SELECT v.id AS versionId, p.id AS periodId, p.location_id AS locationId,
        p.week_start AS weekStart, p.week_end AS weekEnd,
        l.code AS locationCode, l.name AS locationName, l.sort_order AS locationSortOrder,
        v.version_no AS versionNo
    FROM latest
    INNER JOIN roster_periods p ON p.id=latest.period_id
    INNER JOIN roster_versions v ON v.period_id=p.id AND v.version_no=latest.version_no AND v.state='published'
    INNER JOIN locations l ON l.id=p.location_id
    ORDER BY p.week_start, l.sort_order`, [start, end]);
}

async function assertCompletePublishedMonth(db, month, versions) {
    const locations = await all(db, `SELECT id, code, name FROM locations WHERE is_active=1 ORDER BY sort_order, name`);
    const weeks = intersectingWeekStarts(month);
    const present = new Set(versions.map((row) => `${row.locationCode}|${row.weekStart}`));
    const missing = [];
    for (const weekStart of weeks) {
        for (const location of locations) {
            if (!present.has(`${location.code}|${weekStart}`)) {
                missing.push({ weekStart, locationCode: location.code, locationName: location.name });
            }
        }
    }
    if (missing.length) {
        throw exportError(
            `Maand ${month} is nog niet volledig gepubliceerd voor alle vestigingen.`,
            'ROSTER_EXPORT_INCOMPLETE',
            409,
            { month, missing }
        );
    }
    return { locations, weeks };
}

async function exportEmployees(db, month, shiftRows) {
    const { start, end } = monthRange(month);
    const scheduledIds = new Set(shiftRows.filter((row) => row.employeeId).map((row) => Number(row.employeeId)));
    const rows = await all(db, `SELECT DISTINCT e.id, e.employee_code AS employeeCode, e.display_name AS displayName
        FROM employees e
        INNER JOIN employment_periods ep ON ep.employee_id=e.id
        WHERE e.archived_at IS NULL
          AND date(ep.known_from) <= date(?)
          AND (ep.starts_on IS NULL OR date(ep.starts_on) <= date(?))
          AND (ep.ends_on IS NULL OR date(ep.ends_on) >= date(?))
        ORDER BY e.employee_code`, [end, end, start]);
    if (!scheduledIds.size) return rows;
    const known = new Set(rows.map((row) => Number(row.id)));
    const missingIds = [...scheduledIds].filter((id) => !known.has(id));
    if (!missingIds.length) return rows;
    const placeholders = missingIds.map(() => '?').join(',');
    const extras = await all(db, `SELECT id, employee_code AS employeeCode, display_name AS displayName
        FROM employees WHERE id IN (${placeholders}) ORDER BY employee_code`, missingIds);
    return [...rows, ...extras].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, 'nl', { numeric: true }));
}

async function publishedShifts(db, month, versions) {
    if (!versions.length) return [];
    const ids = versions.map((row) => row.versionId);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await all(db, `SELECT
        s.version_id AS versionId, s.shift_uid AS shiftUid, s.employee_id AS employeeId,
        e.employee_code AS employeeCode, e.display_name AS employeeName,
        s.starts_at_utc AS startsAtUtc, s.ends_at_utc AS endsAtUtc,
        s.shift_type AS shiftType, s.note,
        p.id AS periodId, p.week_start AS weekStart,
        l.id AS locationId, l.code AS locationCode, l.name AS locationName, l.timezone
        FROM roster_shifts s
        INNER JOIN roster_versions v ON v.id=s.version_id AND v.state='published'
        INNER JOIN roster_periods p ON p.id=v.period_id
        INNER JOIN locations l ON l.id=p.location_id
        LEFT JOIN employees e ON e.id=s.employee_id
        WHERE s.version_id IN (${placeholders})
        ORDER BY s.starts_at_utc, l.sort_order, e.employee_code, s.shift_uid`, ids);
    return rows.map((row) => {
        const start = utcToLocal(row.startsAtUtc, row.timezone || TIME_ZONE);
        const end = utcToLocal(row.endsAtUtc, row.timezone || TIME_ZONE);
        return {
            ...row,
            localDate: start.date,
            localStartTime: start.time,
            localEndDate: end.date,
            localEndTime: end.time,
            durationMinutes: durationMinutes(row.startsAtUtc, row.endsAtUtc)
        };
    }).filter((row) => row.localDate.startsWith(`${month}-`));
}

function styleVisibleSheet(sheet, employees, month) {
    sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    sheet.getColumn(1).width = 11;
    sheet.getColumn(2).width = 13;
    sheet.getCell('A1').value = 'Datum';
    sheet.getCell('B1').value = 'Dag';
    sheet.getRow(1).height = 24;
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    const headerFont = { bold: true };
    ['A1', 'B1'].forEach((address) => {
        sheet.getCell(address).fill = headerFill;
        sheet.getCell(address).font = headerFont;
        sheet.getCell(address).alignment = { vertical: 'middle', horizontal: 'center' };
    });
    employees.forEach((employee, index) => {
        const startColumn = 3 + index * 3;
        sheet.getCell(1, startColumn).value = employee.displayName;
        sheet.getCell(1, startColumn + 1).value = '';
        sheet.getCell(1, startColumn + 2).value = 'Uren';
        [startColumn, startColumn + 1, startColumn + 2].forEach((column) => {
            const cell = sheet.getCell(1, column);
            cell.fill = headerFill;
            cell.font = headerFont;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        sheet.getColumn(startColumn).width = 17;
        sheet.getColumn(startColumn + 1).width = 17;
        sheet.getColumn(startColumn + 2).width = 9;
    });
    sheet.autoFilter = { from: 'A1', to: sheet.getCell(1, Math.max(2, 2 + employees.length * 3)).address };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    sheet.headerFooter.oddHeader = `&C&BSport Society rooster — ${sheetName(month)}`;
}

function addVisibleRows(sheet, employees, month, shifts) {
    const employeeIndex = new Map(employees.map((employee, index) => [Number(employee.id), index]));
    const grouped = new Map();
    shifts.filter((shift) => shift.employeeId).forEach((shift) => {
        const key = `${shift.localDate}|${shift.employeeId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(shift);
    });
    for (const value of grouped.values()) value.sort((a, b) => a.localStartTime.localeCompare(b.localStartTime));

    datesInMonth(month).forEach((date, offset) => {
        const rowNumber = offset + 2;
        const row = sheet.getRow(rowNumber);
        const dateObject = shortDate(date);
        row.getCell(1).value = dateObject;
        row.getCell(1).numFmt = 'dd-mm';
        row.getCell(2).value = DAY_LABELS[dateObject.getUTCDay()];
        row.height = 22;
        employees.forEach((employee) => {
            const index = employeeIndex.get(Number(employee.id));
            const startColumn = 3 + index * 3;
            const employeeShifts = grouped.get(`${date}|${employee.id}`) || [];
            const totalMinutes = employeeShifts.reduce((sum, shift) => sum + shift.durationMinutes, 0);
            row.getCell(startColumn + 2).value = totalMinutes ? Math.round((totalMinutes / 60) * 100) / 100 : null;
            row.getCell(startColumn + 2).numFmt = '0.00';
            if (!employeeShifts.length) return;

            const first = employeeShifts[0];
            row.getCell(startColumn).value = visibleShiftText(first);
            applyLocationFill(row.getCell(startColumn), first.locationCode);
            row.getCell(startColumn).alignment = { vertical: 'middle', wrapText: true };

            if (employeeShifts.length > 1) {
                const rest = employeeShifts.slice(1);
                const mixedLocations = new Set(rest.map((shift) => shift.locationCode)).size > 1;
                row.getCell(startColumn + 1).value = rest.map((shift) => visibleShiftText(shift, mixedLocations)).join('\n');
                if (!mixedLocations) applyLocationFill(row.getCell(startColumn + 1), rest[0].locationCode);
                row.getCell(startColumn + 1).alignment = { vertical: 'middle', wrapText: true };
                if (rest.length > 1) row.height = Math.max(row.height, 18 + rest.length * 13);
            }
        });
    });
}

function addEmergencyDataSheet(workbook, exportMeta, versions, shifts) {
    const sheet = workbook.addWorksheet('SSO_Data', { state: 'veryHidden' });
    sheet.columns = [
        ['export_uid','exportUid'],['month','month'],['version_id','versionId'],['period_id','periodId'],
        ['week_start','weekStart'],['location_id','locationId'],['location_code','locationCode'],['location_name','locationName'],
        ['shift_uid','shiftUid'],['employee_id','employeeId'],['employee_code','employeeCode'],['employee_name','employeeName'],
        ['starts_at_utc','startsAtUtc'],['ends_at_utc','endsAtUtc'],['local_date','localDate'],['local_start','localStartTime'],
        ['local_end_date','localEndDate'],['local_end','localEndTime'],['shift_type','shiftType'],['note','note']
    ].map(([header, key]) => ({ header, key, width: 20 }));
    shifts.forEach((shift) => sheet.addRow({ exportUid: exportMeta.exportUid, month: exportMeta.month, ...shift }));

    const meta = workbook.addWorksheet('SSO_Export', { state: 'veryHidden' });
    meta.addRow(['format', 'SSO_ROSTER_EXPORT_V1']);
    meta.addRow(['export_uid', exportMeta.exportUid]);
    meta.addRow(['export_id', exportMeta.exportId]);
    meta.addRow(['month', exportMeta.month]);
    meta.addRow(['scope', 'organization']);
    meta.addRow(['source_state', 'published']);
    meta.addRow(['version_ids', versions.map((row) => row.versionId).join(',')]);
    meta.addRow(['generated_at', new Date().toISOString()]);
}

async function buildWorkbook({ month, exportId, exportUid, versions, employees, shifts }) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sport Society Overview';
    workbook.company = 'Sport Society';
    workbook.subject = `Gepubliceerd rooster ${month}`;
    workbook.created = new Date();
    workbook.modified = new Date();
    const sheet = workbook.addWorksheet(sheetName(month));
    styleVisibleSheet(sheet, employees, month);
    addVisibleRows(sheet, employees, month, shifts);
    addEmergencyDataSheet(workbook, { month, exportId, exportUid }, versions, shifts);
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function createMonthlyExport(db, { month, actorUserId }) {
    await migrateRosterExport(db);
    const normalizedMonth = assertMonth(month);
    if (!Number.isInteger(Number(actorUserId)) || Number(actorUserId) < 1) {
        throw exportError('Een geldige gebruiker is verplicht voor exportlogging.', 'EXPORT_ACTOR_REQUIRED');
    }
    const exportUid = crypto.randomUUID();
    const inserted = await run(db, `INSERT INTO roster_exports
        (export_uid, month_key, created_by_user_id, status)
        VALUES (?, ?, ?, 'building')`, [exportUid, normalizedMonth, Number(actorUserId)]);
    const exportId = inserted.lastID;
    try {
        const versions = await latestPublishedVersions(db, normalizedMonth);
        await assertCompletePublishedMonth(db, normalizedMonth, versions);
        const shifts = await publishedShifts(db, normalizedMonth, versions);
        const employees = await exportEmployees(db, normalizedMonth, shifts);
        const buffer = await buildWorkbook({ month: normalizedMonth, exportId, exportUid, versions, employees, shifts });
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
        const fileName = `SSO-Rooster-${normalizedMonth}-exp-${String(exportId).padStart(6, '0')}.xlsx`;
        await run(db, `UPDATE roster_exports SET status='ready', file_name=?, checksum_sha256=?, byte_size=?,
            completed_at=CURRENT_TIMESTAMP WHERE id=?`, [fileName, checksum, buffer.length, exportId]);
        for (const version of versions) {
            await run(db, `INSERT OR IGNORE INTO roster_export_versions
                (export_id, version_id, period_id, location_id, week_start)
                VALUES (?, ?, ?, ?, ?)`, [exportId, version.versionId, version.periodId, version.locationId, version.weekStart]);
        }
        return {
            exportId,
            exportUid,
            month: normalizedMonth,
            fileName,
            checksumSha256: checksum,
            byteSize: buffer.length,
            versions,
            employees,
            shifts,
            buffer
        };
    } catch (error) {
        await run(db, `UPDATE roster_exports SET status='failed', error_message=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`,
            [String(error.message || error).slice(0, 2000), exportId]).catch(() => {});
        throw error;
    }
}

async function recordDelivery(db, exportId, { channel, status, remoteDriveId = null, remoteItemId = null, remoteName = null, details = null, errorMessage = null }) {
    const inserted = await run(db, `INSERT INTO roster_export_deliveries
        (export_id, channel, status, remote_drive_id, remote_item_id, remote_name, details_json, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        exportId, channel, status, remoteDriveId, remoteItemId, remoteName,
        details === null ? null : JSON.stringify(details), errorMessage ? String(errorMessage).slice(0, 2000) : null
    ]);
    return inserted.lastID;
}

async function exportHistory(db, { limit = 30 } = {}) {
    await migrateRosterExport(db);
    const safeLimit = Math.min(Math.max(1, Number(limit) || 30), 200);
    return all(db, `SELECT e.id, e.export_uid AS exportUid, e.month_key AS month, e.status,
        e.file_name AS fileName, e.checksum_sha256 AS checksumSha256, e.byte_size AS byteSize,
        e.created_at AS createdAt, e.completed_at AS completedAt, e.error_message AS errorMessage,
        u.display_name AS createdBy,
        (SELECT COUNT(*) FROM roster_export_versions ev WHERE ev.export_id=e.id) AS versionCount,
        (SELECT COUNT(*) FROM roster_export_deliveries d WHERE d.export_id=e.id AND d.status='success') AS successfulDeliveries
        FROM roster_exports e
        INNER JOIN users u ON u.id=e.created_by_user_id
        ORDER BY e.id DESC LIMIT ?`, [safeLimit]);
}

function monthsTouchedByWeeks(weekStarts) {
    const months = new Set();
    for (const weekStart of weekStarts || []) {
        for (let offset = 0; offset < 7; offset += 1) months.add(addDays(weekStart, offset).slice(0, 7));
    }
    return [...months].sort();
}

module.exports = {
    LOCATION_FILLS,
    addDays,
    assertMonth,
    createMonthlyExport,
    currentAmsterdamMonth,
    exportError,
    exportHistory,
    intersectingWeekStarts,
    migrateRosterExport,
    monthRange,
    monthsTouchedByWeeks,
    recordDelivery,
    sheetName
};
