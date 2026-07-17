const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();

const workbookPath = process.argv[2] || path.join(__dirname, 'data', 'imports', 'Rooster.xlsx');
const dbPath = path.join(__dirname, 'data', 'sport-society.db');

const METRICS = {
    'minstens': { field: 'minimumHours', column: 'minimum_hours' },
    'overuren deze maand': { field: 'overtimeThisMonth', column: 'overtime_this_month' },
    'overuren vorige maand': { field: 'overtimePreviousMonth', column: 'overtime_previous_month' },
    'overuren na deze maand': { field: 'overtimeAfterMonth', column: 'overtime_after_month' }
};
const REQUIRED_FIELDS = {
    scheduledHours: 'scheduled_hours',
    minimumHours: 'minimum_hours',
    overtimeThisMonth: 'overtime_this_month',
    overtimePreviousMonth: 'overtime_previous_month',
    overtimeAfterMonth: 'overtime_after_month'
};
const MONTHS = [
    [1, ['januari', 'jan']], [2, ['februari', 'feb']], [3, ['maart', 'mrt', 'maa']],
    [4, ['april', 'apr']], [5, ['mei']], [6, ['juni', 'jun']], [7, ['juli', 'jul']],
    [8, ['augustus', 'aug']], [9, ['september', 'sept', 'sep']], [10, ['oktober', 'okt']],
    [11, ['november', 'nov']], [12, ['december', 'dec']]
];
const EMPLOYEE_ALIASES = new Map([['lucas v', 'Lucas Veenendaal']]);

function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
    return cleanText(value).toLocaleLowerCase('nl-NL');
}

function cellCandidates(cell) {
    if (!cell) return [];
    const candidates = [];
    const value = cell.value;
    candidates.push(value);
    if (value && typeof value === 'object') {
        if (Object.hasOwn(value, 'result')) candidates.push(value.result);
        if (value.text !== undefined) candidates.push(value.text);
        if (Array.isArray(value.richText)) candidates.push(value.richText.map((part) => part.text).join(''));
    }
    candidates.push(cell.text);
    return candidates;
}

function isExplicitZero(cell) {
    return cellCandidates(cell).some((candidate) => {
        if (typeof candidate === 'number') return Object.is(candidate, 0) || Object.is(candidate, -0);
        if (candidate === null || candidate === undefined || typeof candidate === 'object') return false;
        const text = cleanText(candidate).replace(/\s+/g, ' ');
        return /^[+-]?0+(?:[.,]0+)?(?:\s*u(?:ur)?)?$/.test(text.toLocaleLowerCase('nl-NL'));
    });
}

function getCellText(cell) {
    if (!cell) return '';
    for (const candidate of cellCandidates(cell)) {
        if (candidate === null || candidate === undefined || typeof candidate === 'object') continue;
        const text = cleanText(candidate);
        if (text) return text;
    }
    return '';
}

function canonicalEmployeeName(value) {
    const name = cleanText(value);
    return EMPLOYEE_ALIASES.get(normalized(name)) || name;
}

function parsePeriodKey(sheetName) {
    const base = cleanText(sheetName).replace(/\s*\(\d+\)\s*$/, '');
    const compact = base.toLocaleLowerCase('nl-NL').replace(/[’']/g, '').replace(/[.\s_-]+/g, '');
    const yearToken = (base.match(/\d{2,4}/g) || []).at(-1);
    if (!yearToken || ![2, 4].includes(yearToken.length)) return null;
    const year = yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken);
    const month = MONTHS.find(([, aliases]) => aliases.some((alias) => compact.startsWith(alias)))?.[0];
    return month && year >= 2000 && year <= 2100
        ? `${year}-${String(month).padStart(2, '0')}`
        : null;
}

function meaningfulEmployeeHeader(cell) {
    if (!cell || typeof cell.value === 'number') return false;
    const text = getCellText(cell);
    const key = normalized(text);
    return Boolean(text) && key !== 'uren' && !Object.hasOwn(METRICS, key) && !/^-?\d+(?:[.,]\d+)?$/.test(text);
}

function employeeBlocks(worksheet) {
    const result = [];
    const header = worksheet.getRow(1);
    let employeeName = null;
    let startColumn = null;

    for (let column = 3; column <= worksheet.actualColumnCount; column += 1) {
        const cell = header.getCell(column);
        if (normalized(getCellText(cell)) === 'uren') {
            if (employeeName) result.push({ employeeName, startColumn, hoursColumn: column });
            employeeName = null;
            startColumn = null;
        } else if (meaningfulEmployeeHeader(cell)) {
            employeeName = canonicalEmployeeName(getCellText(cell));
            startColumn = column;
        }
    }
    return result;
}

function zeroUpdates(workbook) {
    const updates = [];
    workbook.eachSheet((worksheet) => {
        const periodKey = parsePeriodKey(worksheet.name);
        if (!periodKey) return;

        for (const block of employeeBlocks(worksheet)) {
            let minimumRow = null;
            for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
                const row = worksheet.getRow(rowNumber);
                for (let column = block.startColumn; column < block.hoursColumn; column += 1) {
                    const metric = METRICS[normalized(getCellText(row.getCell(column)))];
                    if (!metric) continue;
                    if (metric.field === 'minimumHours') minimumRow = rowNumber;
                    if (isExplicitZero(row.getCell(block.hoursColumn))) {
                        updates.push({ periodKey, employeeName: block.employeeName, field: metric.field, column: metric.column });
                    }
                }
            }

            if (minimumRow && minimumRow > 1 && isExplicitZero(worksheet.getRow(minimumRow - 1).getCell(block.hoursColumn))) {
                updates.push({
                    periodKey,
                    employeeName: block.employeeName,
                    field: 'scheduledHours',
                    column: 'scheduled_hours'
                });
            }
        }
    });
    return updates;
}

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ changes: this.changes });
    });
});
const all = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function normalizeDatabase(updates) {
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);
    const affected = new Map();
    let changed = 0;

    try {
        await run(db, 'BEGIN IMMEDIATE');
        for (const update of updates) {
            const result = await run(db, `UPDATE excel_hour_summaries
                SET ${update.column}=0
                WHERE period_key=? AND employee_name=? COLLATE NOCASE
                  AND ${update.column} IS NULL`, [update.periodKey, update.employeeName]);
            changed += result.changes;
            affected.set(`${update.periodKey}|${normalized(update.employeeName)}`, {
                periodKey: update.periodKey,
                employeeName: update.employeeName
            });
        }

        for (const item of affected.values()) {
            const rows = await all(db, `SELECT scheduled_hours AS scheduledHours,
                minimum_hours AS minimumHours, overtime_this_month AS overtimeThisMonth,
                overtime_previous_month AS overtimePreviousMonth,
                overtime_after_month AS overtimeAfterMonth
                FROM excel_hour_summaries
                WHERE period_key=? AND employee_name=? COLLATE NOCASE`, [item.periodKey, item.employeeName]);
            const row = rows[0];
            if (!row) continue;
            const missing = Object.entries(REQUIRED_FIELDS)
                .filter(([field]) => row[field] === null || row[field] === undefined || !Number.isFinite(Number(row[field])))
                .map(([field]) => field);
            await run(db, `UPDATE excel_hour_summaries
                SET is_complete=?, missing_fields_json=?
                WHERE period_key=? AND employee_name=? COLLATE NOCASE`,
            [missing.length ? 0 : 1, JSON.stringify(missing), item.periodKey, item.employeeName]);
        }
        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await close(db);
    }
    return changed;
}

async function main() {
    if (!fs.existsSync(workbookPath)) throw new Error(`Roosterbestand niet gevonden: ${workbookPath}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const updates = zeroUpdates(workbook);
    const changed = await normalizeDatabase(updates);
    console.log(`Expliciete nulwaarden gecontroleerd: ${updates.length} nulcellen gevonden, ${changed} ontbrekende waarden naar 0 gecorrigeerd.`);
}

main().catch((error) => {
    console.error('Normaliseren van expliciete nulwaarden mislukt:', error);
    process.exit(1);
});
