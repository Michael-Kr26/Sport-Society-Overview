const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();
const { clean, normalize, resolveMetric } = require('./healthplanner-metrics');

const args = process.argv.slice(2);
const commitMode = args.includes('--commit');
const positional = args.filter((argument) => !argument.startsWith('--'));
const sourcePath = positional[0] ? path.resolve(positional[0]) : null;
const importedBy = clean(positional[1] || 'CLI-import').slice(0, 120) || 'CLI-import';
const dbPath = path.join(__dirname, 'data', 'sport-society.db');
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp', 'Sport Society totaal'];
const LOCATION_MAP = new Map(LOCATIONS.map((location) => [normalize(location), location]));
const HEADER_ALIASES = {
    reportDate: ['reportdate', 'rapportdatum', 'datum', 'rapportagedatum'],
    location: ['location', 'locatie', 'vestiging'],
    scope: ['scope', 'venster', 'periode', 'periodevenster', 'kolom'],
    metric: ['metric', 'metrickey', 'kpi', 'kengetal', 'veld', 'metriclabel'],
    value: ['value', 'waarde', 'metricvalue', 'kpiwaarde'],
    note: ['note', 'notes', 'opmerking', 'opmerkingen', 'toelichting']
};

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function parseDelimited(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '"') {
            if (quoted && text[index + 1] === '"') {
                value += '"';
                index += 1;
            } else quoted = !quoted;
            continue;
        }
        if (!quoted && character === delimiter) {
            row.push(value);
            value = '';
            continue;
        }
        if (!quoted && (character === '\n' || character === '\r')) {
            if (character === '\r' && text[index + 1] === '\n') index += 1;
            row.push(value);
            if (row.some((cell) => clean(cell))) rows.push(row);
            row = [];
            value = '';
            continue;
        }
        value += character;
    }
    row.push(value);
    if (row.some((cell) => clean(cell))) rows.push(row);
    return rows;
}

function excelCellValue(cell) {
    const value = cell?.value;
    if (value && typeof value === 'object') {
        if (Object.hasOwn(value, 'result')) return value.result;
        if (value.text !== undefined) return value.text;
        if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    }
    return value;
}

async function readRows(filePath) {
    const extension = path.extname(filePath).toLocaleLowerCase('nl-NL');
    if (extension === '.csv' || extension === '.txt') return parseDelimited(fs.readFileSync(filePath, 'utf8'));
    if (!['.xlsx', '.xlsm'].includes(extension)) throw new Error('Gebruik een .csv-, .xlsx- of .xlsm-bestand.');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets.find((sheet) => /health|planner|management|rapport/i.test(sheet.name)) || workbook.worksheets[0];
    if (!worksheet) throw new Error('Het Excelbestand bevat geen werkblad.');
    const rows = [];
    for (let rowNumber = 1; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        rows.push(Array.from({ length: worksheet.actualColumnCount }, (_, index) => excelCellValue(row.getCell(index + 1))));
    }
    return rows;
}

function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    if (typeof value === 'number' && value > 20000 && value < 100000) {
        const date = new Date(Math.round((value - 25569) * 86400 * 1000));
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
    const text = clean(value);
    let match = text.match(/^(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])$/);
    if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
    match = text.match(/^(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})$/);
    if (match) return `${match[3]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
    return null;
}

function previousDate(value) {
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function canonicalLocation(value) {
    const key = normalize(value);
    if (['totaal', 'sportsociety', 'sportsocietytotaal', 'organisatie', 'allelocaties'].includes(key)) return 'Sport Society totaal';
    return LOCATION_MAP.get(key) || null;
}

function canonicalScope(value) {
    const key = normalize(value);
    if (['gisteren', 'yesterday', 'day', 'dag'].includes(key)) return 'day';
    if (['maand', 'month', 'monthtodate', 'mtd', 'maandtotnu', 'maandtotdatum'].includes(key)) return 'month_to_date';
    return null;
}

function parseNumericText(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = clean(value).replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    if (!/^[+-]?\d+(?:\.\d+)?%?$/.test(text)) return null;
    const number = Number(text.replace('%', ''));
    return Number.isFinite(number) ? number : null;
}

function parseDurationSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const text = clean(value).toLocaleLowerCase('nl-NL');
    if (!text) return null;
    if (/^\d{1,3}:\d{2}:\d{2}$/.test(text)) {
        const [hours, minutes, seconds] = text.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    }
    if (/^\d{1,3}:\d{2}$/.test(text)) {
        const [minutes, seconds] = text.split(':').map(Number);
        return minutes * 60 + seconds;
    }
    let seconds = 0;
    let found = false;
    const units = [
        [/([+-]?\d+(?:[.,]\d+)?)\s*dag(?:en)?/i, 86400],
        [/([+-]?\d+(?:[.,]\d+)?)\s*uur(?:\(en\))?/i, 3600],
        [/([+-]?\d+(?:[.,]\d+)?)\s*(?:min(?:uut|uten)?)/i, 60],
        [/([+-]?\d+(?:[.,]\d+)?)\s*(?:sec(?:onde|onden)?)/i, 1]
    ];
    for (const [pattern, multiplier] of units) {
        const match = text.match(pattern);
        if (!match) continue;
        found = true;
        seconds += Number(match[1].replace(',', '.')) * multiplier;
    }
    return found && Number.isFinite(seconds) ? Math.round(seconds) : null;
}

function parseMetricValue(value, metric) {
    if (value === null || value === undefined || clean(value) === '') return null;
    if (metric.unit === 'duration_seconds') return parseDurationSeconds(value);
    const number = parseNumericText(value);
    if (number === null) return null;
    if (metric.unit === 'percentage') return Math.round(number * 100) / 100;
    if (metric.unit === 'ratio') return Math.round(number * 10000) / 10000;
    if (metric.unit === 'count' || metric.unit === 'signed_count') return Number.isInteger(number) ? number : null;
    return Math.round(number * 100) / 100;
}

function headerMapping(row) {
    const mapping = {};
    row.forEach((value, index) => {
        const header = normalize(value);
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
            if (aliases.includes(header) && mapping[field] === undefined) mapping[field] = index;
        }
    });
    return mapping;
}

function findHeader(rows) {
    for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
        const mapping = headerMapping(rows[index]);
        if (['reportDate', 'location', 'scope', 'metric', 'value'].every((field) => mapping[field] !== undefined)) return { rowIndex: index, mapping };
    }
    throw new Error('Geen geldige kopregel gevonden. Vereist: rapportdatum, vestiging, periodevenster, metric en waarde.');
}

function valueAt(row, mapping, field) {
    return mapping[field] === undefined ? null : row[mapping[field]];
}

function parseData(rows) {
    const { rowIndex, mapping } = findHeader(rows);
    const records = [];
    const warnings = [];
    const errors = [];
    const seen = new Set();

    for (let index = rowIndex + 1; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row.some((cell) => clean(cell))) continue;
        const sourceRow = index + 1;
        const reportDate = parseDate(valueAt(row, mapping, 'reportDate'));
        const location = canonicalLocation(valueAt(row, mapping, 'location'));
        const periodType = canonicalScope(valueAt(row, mapping, 'scope'));
        const metric = resolveMetric(valueAt(row, mapping, 'metric'));
        const note = clean(valueAt(row, mapping, 'note')).slice(0, 500) || null;

        if (!reportDate) errors.push(`Rij ${sourceRow}: ongeldige of ontbrekende rapportdatum.`);
        if (!location) errors.push(`Rij ${sourceRow}: onbekende vestiging.`);
        if (!periodType) errors.push(`Rij ${sourceRow}: periodevenster moet Gisteren of Maand zijn.`);
        if (!metric) errors.push(`Rij ${sourceRow}: onbekende HealthPlanner-metric.`);
        if (!reportDate || !location || !periodType || !metric) continue;

        const metricValue = parseMetricValue(valueAt(row, mapping, 'value'), metric);
        if (metricValue === null) {
            errors.push(`Rij ${sourceRow}: waarde voor ${metric.label} is leeg of ongeldig.`);
            continue;
        }
        if (metric.unit === 'percentage' && (metricValue < 0 || metricValue > 100)) {
            errors.push(`Rij ${sourceRow}: percentage voor ${metric.label} moet tussen 0 en 100 liggen.`);
            continue;
        }
        if (metric.unit !== 'signed_count' && metricValue < 0) {
            errors.push(`Rij ${sourceRow}: ${metric.label} mag niet negatief zijn.`);
            continue;
        }

        const periodDate = periodType === 'day' ? previousDate(reportDate) : reportDate;
        const key = `${periodDate}|${periodType}|${normalize(location)}|${metric.key}`;
        if (seen.has(key)) {
            errors.push(`Rij ${sourceRow}: dubbele combinatie ${periodDate} / ${periodType} / ${location} / ${metric.key}.`);
            continue;
        }
        seen.add(key);

        const sourceHash = sha256(JSON.stringify({ reportDate, periodDate, periodType, location, metricKey: metric.key, metricValue, note }));
        records.push({ reportDate, periodDate, periodType, location, metricKey: metric.key, metricLabel: metric.label, metricDomain: metric.domain, metricUnit: metric.unit, metricValue, note, sourceRow, sourceHash });
    }

    if (!records.length && !errors.length) errors.push('Het bestand bevat geen importeerbare HealthPlanner-regels.');

    const recordMap = new Map(records.map((record) => [`${record.reportDate}|${record.periodType}|${record.location}|${record.metricKey}`, record]));
    const groups = new Set(records.map((record) => `${record.reportDate}|${record.periodType}|${record.location}`));
    for (const group of groups) {
        const sold = recordMap.get(`${group}|membershipsSold`);
        const active = recordMap.get(`${group}|membershipsSoldActive`);
        const passive = recordMap.get(`${group}|membershipsSoldPassive`);
        if (sold && active && passive && sold.metricValue !== active.metricValue + passive.metricValue) {
            warnings.push(`${group.replaceAll('|', ' / ')}: totaal verkochte lidmaatschappen wijkt af van actieve + passieve verkoop.`);
        }
    }

    const coverage = new Map();
    for (const record of records) {
        const key = `${record.reportDate}|${record.location}`;
        if (!coverage.has(key)) coverage.set(key, new Set());
        coverage.get(key).add(record.periodType);
    }
    for (const [key, scopes] of coverage) {
        if (!scopes.has('day') || !scopes.has('month_to_date')) warnings.push(`${key.replace('|', ' / ')}: niet zowel Gisteren als Maand aangeleverd.`);
    }

    return { records, warnings, errors };
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

async function ensureColumn(db, table, column, definition) {
    const columns = await all(db, `PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureTables(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS healthplanner_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_file TEXT NOT NULL, source_hash TEXT NOT NULL UNIQUE,
        imported_by TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS healthplanner_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER NOT NULL, period_date TEXT NOT NULL,
        period_type TEXT NOT NULL, location TEXT NOT NULL, metric_key TEXT NOT NULL, metric_value REAL,
        source_row INTEGER, source_hash TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(period_date, period_type, location, metric_key),
        FOREIGN KEY (import_id) REFERENCES healthplanner_imports(id) ON DELETE RESTRICT
    )`);
    await ensureColumn(db, 'healthplanner_metrics', 'report_date', 'TEXT');
    await ensureColumn(db, 'healthplanner_metrics', 'metric_label', 'TEXT');
    await ensureColumn(db, 'healthplanner_metrics', 'metric_domain', 'TEXT');
    await ensureColumn(db, 'healthplanner_metrics', 'metric_unit', 'TEXT');
    await ensureColumn(db, 'healthplanner_metrics', 'note', 'TEXT');
    await run(db, `CREATE TABLE IF NOT EXISTS healthplanner_metric_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, metric_id INTEGER NOT NULL,
        previous_import_id INTEGER NOT NULL, replacement_import_id INTEGER NOT NULL,
        previous_value REAL, replacement_value REAL, previous_source_hash TEXT,
        replacement_source_hash TEXT, revised_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (metric_id) REFERENCES healthplanner_metrics(id) ON DELETE RESTRICT
    )`);
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_healthplanner_report ON healthplanner_metrics(report_date, location, period_type)');
}

async function saveImport(filePath, fileHash, parsed) {
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 10000);
    try {
        await ensureTables(db);
        const existingImport = await get(db, 'SELECT id, imported_at AS importedAt FROM healthplanner_imports WHERE source_hash=?', [fileHash]);
        if (existingImport) throw new Error(`Dit bronbestand is al geïmporteerd op ${existingImport.importedAt}.`);

        await run(db, 'BEGIN IMMEDIATE');
        const importResult = await run(db, `INSERT INTO healthplanner_imports
            (source_file, source_hash, imported_by, row_count, warning_count) VALUES (?, ?, ?, ?, ?)`,
        [path.basename(filePath), fileHash, importedBy, parsed.records.length, parsed.warnings.length]);
        let inserted = 0;
        let revised = 0;
        let unchanged = 0;

        for (const record of parsed.records) {
            const existing = await get(db, `SELECT id, import_id AS importId, metric_value AS metricValue, source_hash AS sourceHash
                FROM healthplanner_metrics WHERE period_date=? AND period_type=? AND location=? AND metric_key=?`,
            [record.periodDate, record.periodType, record.location, record.metricKey]);

            if (!existing) {
                await run(db, `INSERT INTO healthplanner_metrics (
                    import_id, report_date, period_date, period_type, location, metric_key,
                    metric_label, metric_domain, metric_unit, metric_value, note, source_row, source_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    importResult.lastID, record.reportDate, record.periodDate, record.periodType, record.location,
                    record.metricKey, record.metricLabel, record.metricDomain, record.metricUnit,
                    record.metricValue, record.note, record.sourceRow, record.sourceHash
                ]);
                inserted += 1;
                continue;
            }

            if (Number(existing.metricValue) === Number(record.metricValue) && existing.sourceHash === record.sourceHash) {
                unchanged += 1;
                continue;
            }

            await run(db, `INSERT INTO healthplanner_metric_revisions (
                metric_id, previous_import_id, replacement_import_id, previous_value, replacement_value,
                previous_source_hash, replacement_source_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                existing.id, existing.importId, importResult.lastID, existing.metricValue, record.metricValue,
                existing.sourceHash, record.sourceHash
            ]);
            await run(db, `UPDATE healthplanner_metrics SET
                import_id=?, report_date=?, metric_label=?, metric_domain=?, metric_unit=?, metric_value=?,
                note=?, source_row=?, source_hash=?, imported_at=CURRENT_TIMESTAMP WHERE id=?`, [
                importResult.lastID, record.reportDate, record.metricLabel, record.metricDomain,
                record.metricUnit, record.metricValue, record.note, record.sourceRow, record.sourceHash, existing.id
            ]);
            revised += 1;
        }

        await run(db, 'COMMIT');
        return { importId: importResult.lastID, inserted, revised, unchanged };
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await close(db);
    }
}

function printPreview(parsed) {
    const reportDates = [...new Set(parsed.records.map((record) => record.reportDate))].sort();
    const locations = [...new Set(parsed.records.map((record) => record.location))].sort();
    console.log('\n=== HealthPlanner-importpreview ===');
    console.table([{ records: parsed.records.length, rapportdatums: reportDates.join(', '), vestigingen: locations.join(', '), waarschuwingen: parsed.warnings.length, fouten: parsed.errors.length }]);
    if (parsed.warnings.length) {
        console.warn('\nWaarschuwingen:');
        parsed.warnings.forEach((warning) => console.warn(`- ${warning}`));
    }
    if (parsed.errors.length) {
        console.error('\nFouten:');
        parsed.errors.forEach((error) => console.error(`- ${error}`));
    }
}

async function main() {
    if (!sourcePath) throw new Error('Gebruik: node import-healthplanner.js [--commit] <bestand.csv|xlsx> [naam importeur]');
    if (!fs.existsSync(sourcePath)) throw new Error(`HealthPlanner-bestand niet gevonden: ${sourcePath}`);
    const rows = await readRows(sourcePath);
    const parsed = parseData(rows);
    printPreview(parsed);
    if (parsed.errors.length) {
        process.exitCode = 1;
        return;
    }
    if (!commitMode) {
        console.log('\nPreview geslaagd. Gebruik --commit of npm run import:healthplanner om de gegevens op te slaan.');
        return;
    }
    const fileHash = sha256(fs.readFileSync(sourcePath));
    const result = await saveImport(sourcePath, fileHash, parsed);
    console.log(`\nHealthPlanner-import opgeslagen: import ${result.importId}, ${result.inserted} nieuw, ${result.revised} revisie(s), ${result.unchanged} ongewijzigd.`);
}

main().catch((error) => {
    console.error('HealthPlanner-import mislukt:', error.message || error);
    process.exit(1);
});
