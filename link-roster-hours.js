const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();

const workbookPath = process.argv[2] || path.join(__dirname, 'data', 'imports', 'rooster.xlsx');
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'sport-society.db');

const REQUIRED_SHEETS = [
    'Jan 26', 'Feb26', 'Mrt 26', 'Apr 26', 'Mei 26', 'Jun 26',
    'Jul 26', 'Aug 26', 'Sep 26', 'Okt 26', 'Nov 26', 'Dec 26',
    'Jan 27', 'Feb 27'
];
const MONTHS = {
    jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12
};
const SHIFT_LOCATIONS_BY_COLOR = {
    NO_FILL: 'Barneveld',
    FFFFFF00: 'Achterveld',
    FF7030A0: 'Voorthuizen',
    FF00B0F0: 'Wekerom',
    FF92D050: 'Harskamp'
};

function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCellText(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    if (typeof cell.value === 'object') {
        if (cell.value.richText) return cleanText(cell.value.richText.map((part) => part.text).join(''));
        if (cell.value.result !== undefined) return cleanText(cell.value.result);
        if (cell.value.text) return cleanText(cell.value.text);
    }
    return cleanText(cell.text || cell.value);
}

function getFillKey(cell) {
    const fill = cell?.fill;
    if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid' || !fill.fgColor) return 'NO_FILL';
    if (fill.fgColor.argb) return fill.fgColor.argb.toUpperCase();
    if (fill.fgColor.rgb) return fill.fgColor.rgb.toUpperCase();
    if (fill.fgColor.theme !== undefined) return `THEME_${fill.fgColor.theme}`;
    return 'UNKNOWN_FILL';
}

function parseSheetInfo(sheetName) {
    const normalized = sheetName.toLowerCase().replace(/\s+/g, '');
    const monthKey = Object.keys(MONTHS).find((key) => normalized.startsWith(key));
    const yearMatch = normalized.match(/(\d{2})$/);
    if (!monthKey || !yearMatch) return null;
    return { month: MONTHS[monthKey], year: 2000 + Number(yearMatch[1]) };
}

function excelSerialToDate(serial) {
    return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function getRawDateParts(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return { month: value.getUTCMonth() + 1, day: value.getUTCDate() };
    if (typeof value === 'number') {
        const date = excelSerialToDate(value);
        return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    }
    if (typeof value === 'object' && value.result !== undefined) return getRawDateParts(value.result);
    return null;
}

function buildRosterDate(rawDateValue, sheetInfo) {
    const parts = getRawDateParts(rawDateValue);
    if (!parts || !sheetInfo) return null;
    let year = sheetInfo.year;
    if (sheetInfo.month === 1 && parts.month === 12) year -= 1;
    if (sheetInfo.month === 12 && parts.month === 1) year += 1;
    return `${year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function parseTimeRange(text) {
    const normalized = cleanText(text).replace(/[–—]/g, '-').replace(/;/g, ':');
    const match = normalized.match(/(\d{1,2})\s*[.:]\s*(\d{2})\s*-\s*(\d{1,2})\s*[.:]\s*(\d{2})/);
    if (!match) return null;
    return {
        startTime: `${match[1].padStart(2, '0')}:${match[2]}`,
        endTime: `${match[3].padStart(2, '0')}:${match[4]}`
    };
}

function isHoursHeader(text) {
    return cleanText(text).toLowerCase() === 'uren';
}

function parseDeclaredHours(cell) {
    let value = cell?.value;
    if (value && typeof value === 'object' && value.result !== undefined) value = value.result;
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 && value <= 24 ? Math.round(value * 100) / 100 : null;
    }
    const normalized = getCellText(cell).replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 24 ? Math.round(numeric * 100) / 100 : null;
}

function buildColumnLinks(worksheet) {
    const links = new Map();
    const headerRow = worksheet.getRow(1);
    let employee = null;
    let shiftColumns = [];

    const finalize = (hoursColumn = null) => {
        if (!employee) return;
        shiftColumns.forEach((shiftColumn) => links.set(shiftColumn, { employee, hoursColumn }));
        employee = null;
        shiftColumns = [];
    };

    for (let column = 3; column <= worksheet.actualColumnCount; column += 1) {
        const header = getCellText(headerRow.getCell(column));
        if (isHoursHeader(header)) {
            finalize(column);
            continue;
        }
        if (header) {
            finalize(null);
            employee = header;
            shiftColumns = [column];
            continue;
        }
        if (employee) shiftColumns.push(column);
    }
    finalize(null);
    return links;
}

function locationFromCells(shiftCell, hoursCell) {
    const shiftKey = getFillKey(shiftCell);
    const hoursKey = getFillKey(hoursCell);
    if (shiftKey !== 'NO_FILL' && SHIFT_LOCATIONS_BY_COLOR[shiftKey]) return SHIFT_LOCATIONS_BY_COLOR[shiftKey];
    if (hoursKey !== 'NO_FILL' && SHIFT_LOCATIONS_BY_COLOR[hoursKey]) return SHIFT_LOCATIONS_BY_COLOR[hoursKey];
    if (shiftKey === 'NO_FILL' || hoursKey === 'NO_FILL') return 'Barneveld';
    return null;
}

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});
const all = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function ensureDeclaredHoursColumn(db) {
    const table = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='roster_items'");
    if (!table) throw new Error('De tabel roster_items bestaat nog niet. Voer eerst de roosterimport uit.');
    const columns = await all(db, 'PRAGMA table_info(roster_items)');
    if (!columns.some((column) => column.name === 'declared_hours')) {
        await run(db, 'ALTER TABLE roster_items ADD COLUMN declared_hours REAL');
    }
}

async function collectWorkbookLinks(workbook) {
    const links = [];
    for (const sheetName of REQUIRED_SHEETS) {
        const worksheet = workbook.getWorksheet(sheetName);
        const sheetInfo = parseSheetInfo(sheetName);
        if (!worksheet || !sheetInfo) continue;
        const columnLinks = buildColumnLinks(worksheet);

        for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
            const row = worksheet.getRow(rowNumber);
            const rosterDate = buildRosterDate(row.getCell(1).value, sheetInfo);
            if (!rosterDate) continue;

            for (const [shiftColumn, descriptor] of columnLinks.entries()) {
                const shiftCell = row.getCell(shiftColumn);
                const parsedTime = parseTimeRange(getCellText(shiftCell));
                if (!parsedTime) continue;
                const hoursCell = descriptor.hoursColumn ? row.getCell(descriptor.hoursColumn) : null;
                links.push({
                    sourceSheet: sheetName,
                    sourceCell: shiftCell.address,
                    rosterDate,
                    employee: descriptor.employee,
                    declaredHours: parseDeclaredHours(hoursCell),
                    location: locationFromCells(shiftCell, hoursCell)
                });
            }
        }
    }
    return links;
}

async function applyLinks(db, links) {
    let linkedHours = 0;
    let correctedLocations = 0;
    let matchedRows = 0;

    await run(db, 'BEGIN IMMEDIATE');
    try {
        for (const link of links) {
            const row = await get(db, `SELECT id, roster_date AS rosterDate, employee_name AS employeeName,
                item_type AS itemType, location, start_time AS startTime, end_time AS endTime,
                status, note, declared_hours AS declaredHours
                FROM roster_items
                WHERE source_sheet=? AND source_cell=? AND roster_date=? LIMIT 1`,
            [link.sourceSheet, link.sourceCell, link.rosterDate]);
            if (!row) continue;
            matchedRows += 1;
            const nextLocation = link.location || row.location;
            const nextDeclaredHours = link.declaredHours ?? row.declaredHours ?? null;
            if (link.declaredHours !== null) linkedHours += 1;
            if (nextLocation && nextLocation !== row.location) correctedLocations += 1;
            await run(db, `UPDATE roster_items SET declared_hours=?, location=? WHERE id=?`,
                [nextDeclaredHours, nextLocation, row.id]);
        }
        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    }
    return { linkedHours, correctedLocations, matchedRows };
}

async function printLucasSummary(db) {
    const rows = await all(db, `SELECT location, COUNT(*) AS shifts,
        ROUND(SUM(COALESCE(declared_hours, 0)), 2) AS declaredHours,
        SUM(CASE WHEN declared_hours IS NOT NULL THEN 1 ELSE 0 END) AS linkedShifts
        FROM roster_items
        WHERE item_type='shift' AND LOWER(TRIM(employee_name))='lucas v'
        GROUP BY location ORDER BY location`);
    console.log('\n=== Lucas V: gekoppelde uren en locaties ===');
    if (rows.length) console.table(rows);
    else console.log('Geen diensten voor Lucas V gevonden in de geïmporteerde periode.');
}

async function main() {
    if (!fs.existsSync(workbookPath)) throw new Error(`Roosterbestand niet gevonden: ${workbookPath}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const links = await collectWorkbookLinks(workbook);
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);
    try {
        await ensureDeclaredHoursColumn(db);
        const result = await applyLinks(db, links);
        console.log(`\nUrenkoppeling voltooid: ${result.linkedHours} Uren-cellen gekoppeld, ${result.correctedLocations} locaties gecorrigeerd, ${result.matchedRows} diensten herkend.`);
        await printLucasSummary(db);
    } finally {
        await close(db);
    }
}

main().catch((error) => {
    console.error('Koppelen van roosteruren en locaties mislukt:', error);
    process.exit(1);
});
