const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();

const workbookPath = process.argv[2] || path.join(__dirname, 'data', 'imports', 'Rooster.xlsx');
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'sport-society.db');

const DAY_NAMES = new Set(['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']);
const METRICS = {
    'minstens': 'minimumHours',
    'overuren deze maand': 'overtimeThisMonth',
    'overuren vorige maand': 'overtimePreviousMonth',
    'overuren na deze maand': 'overtimeAfterMonth'
};
const METRIC_FIELDS = Object.values(METRICS);
const MONTH_ALIASES = [
    [1, ['januari', 'jan']],
    [2, ['februari', 'feb']],
    [3, ['maart', 'mrt', 'maa']],
    [4, ['april', 'apr']],
    [5, ['mei']],
    [6, ['juni', 'jun']],
    [7, ['juli', 'jul']],
    [8, ['augustus', 'aug']],
    [9, ['september', 'sept', 'sep']],
    [10, ['oktober', 'okt']],
    [11, ['november', 'nov']],
    [12, ['december', 'dec']]
];
const EMPLOYEE_ALIASES = new Map([
    ['lucas v', 'Lucas Veenendaal']
]);

function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedText(value) {
    return cleanText(value).toLocaleLowerCase('nl-NL');
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

function numberValue(cell) {
    if (!cell) return null;
    let value = cell.value;
    if (value && typeof value === 'object' && value.result !== undefined) value = value.result;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
    const text = getCellText(cell).replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function canonicalEmployeeName(value) {
    const name = cleanText(value);
    return EMPLOYEE_ALIASES.get(normalizedText(name)) || name;
}

function parsePeriodKey(sheetName) {
    const withoutDuplicateSuffix = cleanText(sheetName).replace(/\s*\(\d+\)\s*$/, '');
    const compact = withoutDuplicateSuffix.toLocaleLowerCase('nl-NL')
        .replace(/[’']/g, '')
        .replace(/[.\s_-]+/g, '');
    const yearTokens = withoutDuplicateSuffix.match(/\d{2,4}/g) || [];
    const yearToken = yearTokens.at(-1);
    if (!yearToken || ![2, 4].includes(yearToken.length)) return null;
    const year = yearToken.length === 2 ? 2000 + Number(yearToken) : Number(yearToken);
    const monthEntry = MONTH_ALIASES.find(([, aliases]) => aliases.some((alias) => compact.startsWith(alias)));
    if (!monthEntry || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
    return `${year}-${String(monthEntry[0]).padStart(2, '0')}`;
}

function isMeaningfulEmployeeHeader(cell) {
    if (!cell || typeof cell.value === 'number') return false;
    const text = getCellText(cell);
    if (!text || normalizedText(text) === 'uren' || Object.hasOwn(METRICS, normalizedText(text))) return false;
    return !/^-?\d+(?:[.,]\d+)?$/.test(text);
}

function findEmployeeBlocks(worksheet) {
    const blocks = [];
    const headerRow = worksheet.getRow(1);
    let employeeName = null;
    let startColumn = null;

    for (let column = 3; column <= worksheet.actualColumnCount; column += 1) {
        const cell = headerRow.getCell(column);
        const header = normalizedText(getCellText(cell));
        if (header === 'uren') {
            if (employeeName) blocks.push({ employeeName, startColumn, hoursColumn: column });
            employeeName = null;
            startColumn = null;
            continue;
        }
        if (isMeaningfulEmployeeHeader(cell)) {
            employeeName = canonicalEmployeeName(getCellText(cell));
            startColumn = column;
        }
    }
    return blocks;
}

function findDateRows(worksheet) {
    const rows = [];
    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const dayName = normalizedText(getCellText(row.getCell(2)));
        const dateCell = row.getCell(1);
        if (DAY_NAMES.has(dayName) && dateCell.value !== null && dateCell.value !== undefined && getCellText(dateCell)) {
            rows.push(rowNumber);
        }
    }
    return rows;
}

function parseEmployeeSummary(worksheet, block, dateRows) {
    const values = Object.fromEntries(METRIC_FIELDS.map((field) => [field, null]));
    const rows = {};
    const searchStart = dateRows.length ? Math.max(...dateRows) + 1 : 2;

    for (let rowNumber = searchStart; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        for (let column = block.startColumn; column < block.hoursColumn; column += 1) {
            const key = METRICS[normalizedText(getCellText(row.getCell(column)))];
            if (!key || rows[key]) continue;
            values[key] = numberValue(row.getCell(block.hoursColumn));
            rows[key] = rowNumber;
        }
    }

    const missingFields = METRIC_FIELDS.filter((field) => !Number.isFinite(values[field]));
    const scheduledHours = Number.isFinite(values.minimumHours) && Number.isFinite(values.overtimeThisMonth)
        ? Math.round((values.minimumHours + values.overtimeThisMonth) * 100) / 100
        : null;
    const minimumRow = rows.minimumHours || null;
    const sheetTotalHours = minimumRow && minimumRow > 1
        ? numberValue(worksheet.getRow(minimumRow - 1).getCell(block.hoursColumn))
        : null;
    const issues = [];
    if (missingFields.length) issues.push(`Ontbrekend: ${missingFields.join(', ')}`);
    if (Number.isFinite(sheetTotalHours) && Number.isFinite(scheduledHours) && Math.abs(sheetTotalHours - scheduledHours) > 0.01) {
        issues.push(`Totaalcel ${sheetTotalHours} wijkt af van Minstens + overuren (${scheduledHours})`);
    }

    return {
        employeeName: block.employeeName,
        sourceColumn: worksheet.getColumn(block.hoursColumn).letter,
        ...values,
        scheduledHours,
        sheetTotalHours,
        isComplete: missingFields.length === 0,
        missingFields,
        issues
    };
}

function parseWorkbook(workbook) {
    const periods = [];
    const seenPeriods = new Set();
    const skippedDuplicates = [];

    workbook.eachSheet((worksheet) => {
        const periodKey = parsePeriodKey(worksheet.name);
        if (!periodKey) return;
        if (seenPeriods.has(periodKey)) {
            skippedDuplicates.push(`${worksheet.name} (${periodKey})`);
            return;
        }
        seenPeriods.add(periodKey);

        const dateRows = findDateRows(worksheet);
        const dateCount = dateRows.length;
        const weekCount = dateCount ? Math.round((dateCount / 7) * 100) / 100 : 0;
        const periodIssues = [];
        if (!dateCount) periodIssues.push('Geen geldige datumregels in kolom A gevonden.');
        else if (dateCount % 7 !== 0) periodIssues.push(`${dateCount} datumregels is geen volledig aantal weken.`);

        const summaries = findEmployeeBlocks(worksheet)
            .map((block) => parseEmployeeSummary(worksheet, block, dateRows));
        periods.push({
            periodKey,
            sheetName: worksheet.name,
            dateCount,
            weekCount,
            issues: periodIssues,
            summaries
        });
    });

    return { periods, skippedDuplicates };
}

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function createTables(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS excel_hour_periods (
        period_key TEXT PRIMARY KEY,
        sheet_name TEXT NOT NULL,
        date_count INTEGER NOT NULL,
        week_count REAL NOT NULL,
        source_file TEXT,
        issues_json TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS excel_hour_summaries (
        period_key TEXT NOT NULL,
        employee_name TEXT NOT NULL COLLATE NOCASE,
        source_column TEXT,
        minimum_hours REAL,
        overtime_this_month REAL,
        overtime_previous_month REAL,
        overtime_after_month REAL,
        scheduled_hours REAL,
        sheet_total_hours REAL,
        is_complete INTEGER NOT NULL DEFAULT 0,
        missing_fields_json TEXT NOT NULL DEFAULT '[]',
        issues_json TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (period_key, employee_name)
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS excel_hour_overrides (
        period_key TEXT NOT NULL,
        employee_name TEXT NOT NULL COLLATE NOCASE,
        minimum_hours REAL,
        overtime_this_month REAL,
        overtime_previous_month REAL,
        overtime_after_month REAL,
        note TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (period_key, employee_name)
    )`);
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_excel_hour_summary_employee ON excel_hour_summaries(employee_name, period_key)');
}

async function saveParsedWorkbook(parsed) {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);
    try {
        await createTables(db);
        await run(db, 'BEGIN IMMEDIATE');
        await run(db, 'DELETE FROM excel_hour_summaries');
        await run(db, 'DELETE FROM excel_hour_periods');

        for (const period of parsed.periods) {
            await run(db, `INSERT INTO excel_hour_periods
                (period_key, sheet_name, date_count, week_count, source_file, issues_json, imported_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [period.periodKey, period.sheetName, period.dateCount, period.weekCount,
                path.basename(workbookPath), JSON.stringify(period.issues)]);
            for (const summary of period.summaries) {
                await run(db, `INSERT INTO excel_hour_summaries (
                    period_key, employee_name, source_column, minimum_hours,
                    overtime_this_month, overtime_previous_month, overtime_after_month,
                    scheduled_hours, sheet_total_hours, is_complete,
                    missing_fields_json, issues_json, imported_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [
                    period.periodKey, summary.employeeName, summary.sourceColumn,
                    summary.minimumHours, summary.overtimeThisMonth,
                    summary.overtimePreviousMonth, summary.overtimeAfterMonth,
                    summary.scheduledHours, summary.sheetTotalHours,
                    summary.isComplete ? 1 : 0,
                    JSON.stringify(summary.missingFields), JSON.stringify(summary.issues)
                ]);
            }
        }
        await run(db, 'COMMIT');
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await close(db);
    }
}

function printSummary(parsed) {
    const employeeRows = parsed.periods.flatMap((period) => period.summaries.map((summary) => ({ period, summary })));
    const complete = employeeRows.filter(({ summary }) => summary.isComplete).length;
    const incomplete = employeeRows.length - complete;
    console.log(`\nExcel-urenoverzichten opgeslagen: ${parsed.periods.length} maandpagina's, ${complete} complete en ${incomplete} onvolledige medewerkerregels.`);
    if (parsed.skippedDuplicates.length) console.warn(`Dubbele maandpagina's overgeslagen: ${parsed.skippedDuplicates.join(', ')}`);

    const current = parsed.periods.find((period) => period.periodKey === '2026-07');
    const leroy = current?.summaries.find((summary) => normalizedText(summary.employeeName) === 'leroy');
    if (current && leroy) {
        console.log('\n=== Controle Jul 26 · Leroy ===');
        console.table([{
            pagina: current.sheetName,
            weken: current.weekCount,
            minstens: leroy.minimumHours,
            overurenDezeMaand: leroy.overtimeThisMonth,
            ingepland: leroy.scheduledHours,
            overurenVorigeMaand: leroy.overtimePreviousMonth,
            overurenNaDezeMaand: leroy.overtimeAfterMonth
        }]);
    }
}

async function main() {
    if (!fs.existsSync(workbookPath)) throw new Error(`Roosterbestand niet gevonden: ${workbookPath}`);
    const workbook = new ExcelJS.Workbook();
    console.log(`Excel-urenpagina's lezen: ${workbookPath}`);
    await workbook.xlsx.readFile(workbookPath);
    const parsed = parseWorkbook(workbook);
    await saveParsedWorkbook(parsed);
    printSummary(parsed);
}

main().catch((error) => {
    console.error('Importeren van Excel-urenoverzichten mislukt:', error);
    process.exit(1);
});
