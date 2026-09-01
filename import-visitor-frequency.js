const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();

const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const importedBy = String(process.argv[3] || 'CLI-import').trim().slice(0, 120) || 'CLI-import';
const dbPath = path.join(__dirname, 'data', 'sport-society.db');
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp', 'Sport Society totaal'];
const LOCATION_MAP = new Map(LOCATIONS.map((location) => [normalize(location), location]));
const MONTH_NAMES = new Map([
    ['januari', 1], ['jan', 1], ['februari', 2], ['feb', 2], ['maart', 3], ['mrt', 3], ['maa', 3],
    ['april', 4], ['apr', 4], ['mei', 5], ['juni', 6], ['jun', 6], ['juli', 7], ['jul', 7],
    ['augustus', 8], ['aug', 8], ['september', 9], ['sept', 9], ['sep', 9], ['oktober', 10], ['okt', 10],
    ['november', 11], ['nov', 11], ['december', 12], ['dec', 12]
]);
const HEADER_ALIASES = {
    periodMonth: ['periodmonth', 'month', 'maand', 'periode', 'periodemaand'],
    location: ['location', 'locatie', 'vestiging'],
    totalVisits: ['totalvisits', 'visits', 'bezoeken', 'totaalbezoeken', 'aantalbezoeken', 'bezoekentotaal'],
    activeMembers: ['activemembers', 'activeleden', 'actievelleden', 'actieveleden', 'ledenaantal', 'aantalactievelleden'],
    visitFrequency: ['visitfrequency', 'bezoekersfrequentie', 'bezoekfrequentie', 'frequentie'],
    note: ['note', 'notes', 'opmerking', 'opmerkingen', 'toelichting']
};

function clean(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
    return clean(value).toLocaleLowerCase('nl-NL')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function parseMonth(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
    }
    if (typeof value === 'number' && value > 20000 && value < 100000) {
        const date = new Date(Math.round((value - 25569) * 86400 * 1000));
        if (!Number.isNaN(date.getTime())) return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    const text = clean(value).toLocaleLowerCase('nl-NL').replace(/[’']/g, '');
    let match = text.match(/^(20\d{2})[-/.](0?[1-9]|1[0-2])$/);
    if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
    match = text.match(/^(0?[1-9]|1[0-2])[-/.](20\d{2})$/);
    if (match) return `${match[2]}-${String(Number(match[1])).padStart(2, '0')}`;

    const yearMatch = text.match(/20\d{2}/);
    if (!yearMatch) return null;
    const monthEntry = [...MONTH_NAMES.entries()].find(([name]) => text.includes(name));
    if (!monthEntry) return null;
    return `${yearMatch[0]}-${String(monthEntry[1]).padStart(2, '0')}`;
}

function parseNumber(value, { integer = false } = {}) {
    if (value === null || value === undefined || clean(value) === '') return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return integer ? Math.round(value) : Math.round(value * 100) / 100;
    }
    const text = clean(value)
        .replace(/\s/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.');
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return integer ? Math.round(number) : Math.round(number * 100) / 100;
}

function canonicalLocation(value) {
    const key = normalize(value);
    if (['totaal', 'sportsociety', 'sportsocietytotaal', 'organisatie', 'alletakken'].includes(key)) return 'Sport Society totaal';
    return LOCATION_MAP.get(key) || null;
}

function parseDelimited(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '"') {
            if (quoted && text[index + 1] === '"') {
                value += '"';
                index += 1;
            } else quoted = !quoted;
            continue;
        }
        if (!quoted && char === delimiter) {
            row.push(value);
            value = '';
            continue;
        }
        if (!quoted && (char === '\n' || char === '\r')) {
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            row.push(value);
            if (row.some((cell) => clean(cell))) rows.push(row);
            row = [];
            value = '';
            continue;
        }
        value += char;
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
    if (extension === '.csv' || extension === '.txt') {
        return parseDelimited(fs.readFileSync(filePath, 'utf8'));
    }
    if (!['.xlsx', '.xlsm'].includes(extension)) {
        throw new Error('Gebruik een .csv-, .xlsx- of .xlsm-bestand.');
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets.find((sheet) => /bezoek|visitor|frequent/i.test(sheet.name)) || workbook.worksheets[0];
    if (!worksheet) throw new Error('Het Excelbestand bevat geen werkblad.');
    const rows = [];
    for (let rowNumber = 1; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        rows.push(Array.from({ length: worksheet.actualColumnCount }, (_, index) => excelCellValue(row.getCell(index + 1))));
    }
    return rows;
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
        if (mapping.periodMonth !== undefined && mapping.location !== undefined &&
            (mapping.totalVisits !== undefined || mapping.visitFrequency !== undefined)) {
            return { rowIndex: index, mapping };
        }
    }
    throw new Error('Geen geldige kopregel gevonden. Vereist: maand, locatie en totaal bezoeken of bezoekersfrequentie.');
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
        const periodMonth = parseMonth(valueAt(row, mapping, 'periodMonth'));
        const location = canonicalLocation(valueAt(row, mapping, 'location'));
        const totalVisits = parseNumber(valueAt(row, mapping, 'totalVisits'), { integer: true });
        const activeMembers = parseNumber(valueAt(row, mapping, 'activeMembers'), { integer: true });
        const visitFrequency = parseNumber(valueAt(row, mapping, 'visitFrequency'));
        const note = clean(valueAt(row, mapping, 'note')).slice(0, 500) || null;

        if (!periodMonth) errors.push(`Rij ${sourceRow}: ongeldige of ontbrekende maand.`);
        if (!location) errors.push(`Rij ${sourceRow}: onbekende vestiging.`);
        if (totalVisits === null && visitFrequency === null) errors.push(`Rij ${sourceRow}: totaal bezoeken en bezoekersfrequentie zijn beide leeg of ongeldig.`);
        if (totalVisits !== null && totalVisits < 0) errors.push(`Rij ${sourceRow}: totaal bezoeken mag niet negatief zijn.`);
        if (activeMembers !== null && activeMembers < 0) errors.push(`Rij ${sourceRow}: actieve leden mag niet negatief zijn.`);
        if (visitFrequency !== null && visitFrequency < 0) errors.push(`Rij ${sourceRow}: bezoekersfrequentie mag niet negatief zijn.`);
        if (!periodMonth || !location || (totalVisits === null && visitFrequency === null)) continue;

        const key = `${periodMonth}|${normalize(location)}`;
        if (seen.has(key)) {
            errors.push(`Rij ${sourceRow}: dubbele combinatie ${periodMonth} / ${location}.`);
            continue;
        }
        seen.add(key);

        const calculated = totalVisits !== null && activeMembers > 0 ? Math.round((totalVisits / activeMembers) * 100) / 100 : null;
        if (visitFrequency !== null && calculated !== null && Math.abs(visitFrequency - calculated) > 0.05) {
            warnings.push(`Rij ${sourceRow}: aangeleverde frequentie ${visitFrequency} wijkt af van bezoeken/leden ${calculated}.`);
        }
        if (location === 'Sport Society totaal') {
            warnings.push(`Rij ${sourceRow}: totaalregel niet optellen bij vestigingsregels van dezelfde maand.`);
        }

        const sourceHash = sha256(JSON.stringify({ periodMonth, location, totalVisits, activeMembers, visitFrequency, note }));
        records.push({ periodMonth, location, totalVisits, activeMembers, visitFrequency, note, sourceRow, sourceHash });
    }

    if (!records.length && !errors.length) errors.push('Het bestand bevat geen importeerbare gegevensregels.');
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
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function ensureTables(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS visitor_frequency_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_file TEXT NOT NULL, source_hash TEXT NOT NULL,
        imported_by TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        row_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_hash)
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS visitor_frequency_months (
        id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER NOT NULL, period_month TEXT NOT NULL,
        location TEXT NOT NULL, total_visits INTEGER, active_members INTEGER, visit_frequency REAL,
        note TEXT, source_row INTEGER, source_hash TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(period_month, location),
        FOREIGN KEY (import_id) REFERENCES visitor_frequency_imports(id) ON DELETE RESTRICT
    )`);
}

async function saveImport(filePath, fileHash, parsed) {
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 10000);
    try {
        await ensureTables(db);
        const existing = await get(db, 'SELECT id, imported_at AS importedAt FROM visitor_frequency_imports WHERE source_hash=?', [fileHash]);
        if (existing) {
            console.log(`Dit exacte bestand is al geïmporteerd op ${existing.importedAt}. Geen wijzigingen uitgevoerd.`);
            return { duplicate: true, importId: existing.id };
        }

        await run(db, 'BEGIN IMMEDIATE');
        const importResult = await run(db, `INSERT INTO visitor_frequency_imports
            (source_file, source_hash, imported_by, row_count, warning_count)
            VALUES (?, ?, ?, ?, ?)`, [path.basename(filePath), fileHash, importedBy, parsed.records.length, parsed.warnings.length]);

        for (const record of parsed.records) {
            await run(db, `INSERT INTO visitor_frequency_months
                (import_id, period_month, location, total_visits, active_members, visit_frequency,
                 note, source_row, source_hash, imported_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(period_month, location) DO UPDATE SET
                    import_id=excluded.import_id, total_visits=excluded.total_visits,
                    active_members=excluded.active_members, visit_frequency=excluded.visit_frequency,
                    note=excluded.note, source_row=excluded.source_row, source_hash=excluded.source_hash,
                    imported_at=CURRENT_TIMESTAMP`, [
                importResult.lastID, record.periodMonth, record.location, record.totalVisits,
                record.activeMembers, record.visitFrequency, record.note, record.sourceRow, record.sourceHash
            ]);
        }
        await run(db, 'COMMIT');
        return { duplicate: false, importId: importResult.lastID };
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await close(db);
    }
}

async function main() {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error('Gebruik: npm run import:visitors -- "pad\\naar\\bezoekersbestand.xlsx"');
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const fileBuffer = fs.readFileSync(sourcePath);
    const rows = await readRows(sourcePath);
    const parsed = parseData(rows);

    if (parsed.errors.length) {
        console.error('\nImport afgebroken. Corrigeer eerst:');
        parsed.errors.forEach((error) => console.error(`- ${error}`));
        process.exitCode = 1;
        return;
    }

    console.log(`\nBezoekersbestand gecontroleerd: ${parsed.records.length} geldige regel(s), ${parsed.warnings.length} waarschuwing(en).`);
    parsed.warnings.forEach((warning) => console.warn(`- ${warning}`));
    const result = await saveImport(sourcePath, sha256(fileBuffer), parsed);
    if (!result.duplicate) console.log(`Import ${result.importId} opgeslagen in visitor_frequency_months.`);
    console.table(parsed.records.map((record) => ({
        maand: record.periodMonth,
        vestiging: record.location,
        bezoeken: record.totalVisits,
        actieveLeden: record.activeMembers,
        frequentie: record.visitFrequency
    })));
}

main().catch((error) => {
    console.error('Bezoekersfrequentie-import mislukt:', error.message);
    process.exit(1);
});
