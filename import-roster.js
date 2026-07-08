const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();

const workbookPath = process.argv[2] || path.join(__dirname, 'data', 'imports', 'rooster.xlsx');
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'sport-society.db');

const REQUIRED_SHEETS = [
    'Jan 26',
    'Feb26',
    'Mrt 26',
    'Apr 26',
    'Mei 26',
    'Jun 26',
    'Jul 26',
    'Aug 26',
    'Sep 26',
    'Okt 26',
    'Nov 26',
    'Dec 26',
    'Jan 27',
    'Feb 27'
];

const MONTHS = {
    jan: 1,
    feb: 2,
    mrt: 3,
    apr: 4,
    mei: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    okt: 10,
    nov: 11,
    dec: 12
};

const SHIFT_LOCATIONS_BY_COLOR = {
    NO_FILL: 'Barneveld',
    FFFFFF00: 'Achterveld',
    FF7030A0: 'Voorthuizen',
    FF00B0F0: 'Wekerom',
    FF92D050: 'Harskamp'
};

const SPECIAL_STATUS_BY_COLOR = {
    FFFF0000: 'Betaald verlof / vakantie',
    FFFFC000: 'Ziek',
    FF00B050: 'Feestdag',
    THEME_5: 'Feestdag',
    FFFF00D0: 'Tijd voor tijd',
    THEME_4: 'Ouderschapsverlof',
    FF0000FF: 'Ouderschapsverlof',
    FF002060: 'Ouderschapsverlof',
    FF0070C0: 'Ouderschapsverlof',
    FF1F4E78: 'Ouderschapsverlof'
};
function cleanText(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getCellText(cell) {
    if (!cell || cell.value === null || cell.value === undefined) {
        return '';
    }

    if (typeof cell.value === 'object') {
        if (cell.value.richText) {
            return cleanText(cell.value.richText.map((part) => part.text).join(''));
        }

        if (cell.value.result !== undefined) {
            return cleanText(cell.value.result);
        }

        if (cell.value.text) {
            return cleanText(cell.value.text);
        }
    }

    return cleanText(cell.text || cell.value);
}

function getFillKey(cell) {
    const fill = cell.fill;

    if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid' || !fill.fgColor) {
        return 'NO_FILL';
    }

    if (fill.fgColor.argb) {
        return fill.fgColor.argb.toUpperCase();
    }

    if (fill.fgColor.rgb) {
        return fill.fgColor.rgb.toUpperCase();
    }

    if (fill.fgColor.theme !== undefined) {
        return `THEME_${fill.fgColor.theme}`;
    }

    return 'UNKNOWN_FILL';
}

function parseSheetInfo(sheetName) {
    const normalized = sheetName.toLowerCase().replace(/\s+/g, '');
    const monthKey = Object.keys(MONTHS).find((key) => normalized.startsWith(key));

    if (!monthKey) {
        return null;
    }

    const yearMatch = normalized.match(/(\d{2})$/);

    if (!yearMatch) {
        return null;
    }

    return {
        month: MONTHS[monthKey],
        year: 2000 + Number(yearMatch[1])
    };
}

function excelSerialToDate(serial) {
    const milliseconds = Math.round((serial - 25569) * 86400 * 1000);

    return new Date(milliseconds);
}

function getRawDateParts(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (value instanceof Date) {
        return {
            month: value.getUTCMonth() + 1,
            day: value.getUTCDate()
        };
    }

    if (typeof value === 'number') {
        const date = excelSerialToDate(value);

        return {
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate()
        };
    }

    if (typeof value === 'object' && value.result !== undefined) {
        return getRawDateParts(value.result);
    }

    return null;
}

function buildRosterDate(rawDateValue, sheetInfo) {
    const rawDateParts = getRawDateParts(rawDateValue);

    if (!rawDateParts || !sheetInfo) {
        return null;
    }

    let year = sheetInfo.year;

    if (sheetInfo.month === 1 && rawDateParts.month === 12) {
        year = sheetInfo.year - 1;
    }

    if (sheetInfo.month === 12 && rawDateParts.month === 1) {
        year = sheetInfo.year + 1;
    }

    const month = String(rawDateParts.month).padStart(2, '0');
    const day = String(rawDateParts.day).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function parseTimeRange(text) {
    const normalized = cleanText(text)
        .replace(/[–—]/g, '-')
        .replace(/;/g, ':');

    const match = normalized.match(/(\d{1,2})\s*[.:]\s*(\d{2})\s*-\s*(\d{1,2})\s*[.:]\s*(\d{2})/);

    if (!match) {
        return null;
    }

    const startTime = `${match[1].padStart(2, '0')}:${match[2]}`;
    const endTime = `${match[3].padStart(2, '0')}:${match[4]}`;
    const extraText = cleanText(normalized.replace(match[0], ''));

    return {
        startTime,
        endTime,
        extraText
    };
}

function isHoursHeader(text) {
    return cleanText(text).toLowerCase() === 'uren';
}

function isEmptyHeader(text) {
    return cleanText(text) === '';
}

function isNumericOnly(text) {
    return /^\d+([.,]\d+)?$/.test(cleanText(text));
}

function getStatusFromText(text) {
    const normalized = cleanText(text).toLowerCase();

    if (!normalized) {
        return null;
    }

    if (normalized.includes('verlof') || normalized.includes('vakantie')) {
        return 'Betaald verlof / vakantie';
    }

    if (normalized.includes('ziek')) {
        return 'Ziek';
    }

    if (
        normalized.includes('feestdag') ||
        normalized.includes('gesloten') ||
        normalized.includes('kerstdag') ||
        normalized.includes('nieuwjaarsdag') ||
        normalized.includes('pasen') ||
        normalized.includes('pinkster') ||
        normalized.includes('koningsdag')
    ) {
        return 'Feestdag';
    }

    if (
        normalized.includes('tijd voor tijd') ||
        normalized.includes('tvt') ||
        normalized.includes('overuren')
    ) {
        return 'Tijd voor tijd';
    }

    return null;
}

function getEmployeeByColumn(worksheet) {
    const employeeByColumn = new Map();
    const headerRow = worksheet.getRow(1);

    let activeEmployee = null;

    for (let columnNumber = 1; columnNumber <= worksheet.actualColumnCount; columnNumber += 1) {
        const headerText = getCellText(headerRow.getCell(columnNumber));

        if (columnNumber <= 2) {
            employeeByColumn.set(columnNumber, null);
            continue;
        }

        if (isHoursHeader(headerText)) {
            activeEmployee = null;
            employeeByColumn.set(columnNumber, null);
            continue;
        }

        if (!isEmptyHeader(headerText)) {
            activeEmployee = headerText;
        }

        employeeByColumn.set(columnNumber, activeEmployee);
    }

    return employeeByColumn;
}

function getTakeoverNameFromNextCell(row, columnNumber, sourceEmployee, employeeByColumn) {
    const nextColumnNumber = columnNumber + 1;
    const nextColumnEmployee = employeeByColumn.get(nextColumnNumber);

    if (!sourceEmployee || nextColumnEmployee !== sourceEmployee) {
        return null;
    }

    const nextCellText = getCellText(row.getCell(nextColumnNumber));

    if (!nextCellText) {
        return null;
    }

    if (isNumericOnly(nextCellText)) {
        return null;
    }

    if (parseTimeRange(nextCellText)) {
        return null;
    }

    if (getStatusFromText(nextCellText)) {
        return null;
    }

    return nextCellText;
}

function isGlobalSpecialStatus(status, text) {
    const normalized = cleanText(text).toLowerCase();

    return status === 'Feestdag' || normalized.includes('gesloten');
}

function createSourceHash(item) {
    const hashInput = [
        item.rosterDate,
        item.employeeName,
        item.itemType,
        item.location || '',
        item.startTime || '',
        item.endTime || '',
        item.status,
        item.note || ''
    ].join('|');

    return crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');
}

function parseWorksheet(worksheet, sheetInfo) {
    const employeeByColumn = getEmployeeByColumn(worksheet);
    const items = [];
    const unknownColors = new Set();

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const rosterDate = buildRosterDate(row.getCell(1).value, sheetInfo);
        const dayName = getCellText(row.getCell(2));

        if (!rosterDate || !dayName) {
            continue;
        }

        const skippedColumns = new Set();

        for (let columnNumber = 3; columnNumber <= worksheet.actualColumnCount; columnNumber += 1) {
            if (skippedColumns.has(columnNumber)) {
                continue;
            }

            const sourceEmployee = employeeByColumn.get(columnNumber);

            if (!sourceEmployee) {
                continue;
            }

            const cell = row.getCell(columnNumber);
            const rawText = getCellText(cell);

            if (!rawText || isNumericOnly(rawText)) {
                continue;
            }

            const colorKey = getFillKey(cell);
            const parsedTime = parseTimeRange(rawText);
            const statusFromColor = SPECIAL_STATUS_BY_COLOR[colorKey];
            const statusFromText = getStatusFromText(rawText);
            const specialStatus = statusFromColor || statusFromText;
            const location = SHIFT_LOCATIONS_BY_COLOR[colorKey];

            if (!location && !specialStatus && colorKey !== 'NO_FILL') {
                unknownColors.add(`${colorKey} | ${rawText} | ${worksheet.name}!${cell.address}`);
            }

            if (specialStatus) {
                const employeeName = isGlobalSpecialStatus(specialStatus, rawText)
                    ? 'ALL'
                    : sourceEmployee;

                const item = {
                    sourceSheet: worksheet.name,
                    sourceCell: cell.address,
                    rosterDate,
                    dayName,
                    employeeName,
                    sourceSlotEmployee: sourceEmployee,
                    itemType: specialStatus === 'Feestdag' ? 'special' : 'absence',
                    location: null,
                    startTime: parsedTime ? parsedTime.startTime : null,
                    endTime: parsedTime ? parsedTime.endTime : null,
                    status: specialStatus,
                    note: parsedTime && parsedTime.extraText ? parsedTime.extraText : null,
                    rawText,
                    colorKey
                };

                item.sourceHash = createSourceHash(item);
                items.push(item);

                continue;
            }

            if (!parsedTime) {
                continue;
            }

            const takeoverNameFromSameCell = parsedTime.extraText || null;
            const takeoverNameFromNextCell = getTakeoverNameFromNextCell(
                row,
                columnNumber,
                sourceEmployee,
                employeeByColumn
            );

            const takeoverName = takeoverNameFromSameCell || takeoverNameFromNextCell;
            const employeeName = takeoverName || sourceEmployee;

            if (takeoverNameFromNextCell) {
                skippedColumns.add(columnNumber + 1);
            }

            const item = {
                sourceSheet: worksheet.name,
                sourceCell: cell.address,
                rosterDate,
                dayName,
                employeeName,
                sourceSlotEmployee: sourceEmployee,
                itemType: 'shift',
                location: location || 'Barneveld',
                startTime: parsedTime.startTime,
                endTime: parsedTime.endTime,
                status: 'Werkdienst',
                note: takeoverName ? `Overgenomen dienst van ${sourceEmployee}` : null,
                rawText,
                colorKey
            };

            item.sourceHash = createSourceHash(item);
            items.push(item);
        }
    }

    return {
        items,
        unknownColors: Array.from(unknownColors)
    };
}

function run(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (error) {
            if (error) {
                reject(error);
                return;
            }

            resolve(this);
        });
    });
}

function closeDatabase(db) {
    return new Promise((resolve, reject) => {
        db.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

async function createDatabaseTables(db) {
    await run(db, `
        CREATE TABLE IF NOT EXISTS roster_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL,
            source_file TEXT,
            source_url TEXT,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL,
            items_found INTEGER NOT NULL DEFAULT 0,
            changes_detected INTEGER NOT NULL DEFAULT 0,
            error_message TEXT
        )
    `);

    await run(db, `
        CREATE TABLE IF NOT EXISTS roster_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER,
            roster_date TEXT NOT NULL,
            day_name TEXT,
            employee_name TEXT NOT NULL,
            source_slot_employee TEXT,
            item_type TEXT NOT NULL,
            location TEXT,
            start_time TEXT,
            end_time TEXT,
            status TEXT NOT NULL,
            note TEXT,
            source_sheet TEXT,
            source_cell TEXT,
            source_hash TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (import_id) REFERENCES roster_imports(id)
        )
    `);
}

async function saveItemsToDatabase(items) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, {
            recursive: true
        });
    }

    const db = new sqlite3.Database(dbPath);

    try {
        await createDatabaseTables(db);

        await run(db, 'BEGIN TRANSACTION');

        const importResult = await run(db, `
            INSERT INTO roster_imports (
                source_type,
                source_file,
                status,
                items_found,
                changes_detected
            )
            VALUES (?, ?, ?, ?, ?)
        `, [
            'local_excel',
            path.basename(workbookPath),
            'success',
            items.length,
            0
        ]);

        const importId = importResult.lastID;

        await run(db, 'DELETE FROM roster_items');

        const insertQuery = `
            INSERT INTO roster_items (
                import_id,
                roster_date,
                day_name,
                employee_name,
                source_slot_employee,
                item_type,
                location,
                start_time,
                end_time,
                status,
                note,
                source_sheet,
                source_cell,
                source_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const item of items) {
            await run(db, insertQuery, [
                importId,
                item.rosterDate,
                item.dayName,
                item.employeeName,
                item.sourceSlotEmployee || null,
                item.itemType,
                item.location || null,
                item.startTime || null,
                item.endTime || null,
                item.status,
                item.note || null,
                item.sourceSheet || null,
                item.sourceCell || null,
                item.sourceHash
            ]);
        }

        await run(db, 'COMMIT');

        console.log(`\nRooster opgeslagen in SQLite: ${items.length} items`);
        console.log(`Import ID: ${importId}`);
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await closeDatabase(db);
    }
}

function savePreviewFile(items, unknownColors, missingSheets) {
    const outputPath = path.join(__dirname, 'data', 'imports', 'roster-preview.json');

    const previewData = {
        generatedAt: new Date().toISOString(),
        totalItems: items.length,
        unknownColors,
        missingSheets,
        items
    };

    fs.mkdirSync(path.dirname(outputPath), {
        recursive: true
    });

    fs.writeFileSync(outputPath, JSON.stringify(previewData, null, 2), 'utf8');

    console.log(`\nRooster-preview opgeslagen: ${outputPath}`);
}

function printSummary(items, unknownColors, missingSheets) {
    const totals = items.reduce((summary, item) => {
        summary.total += 1;
        summary[item.itemType] = (summary[item.itemType] || 0) + 1;

        if (item.note && item.note.includes('Overgenomen dienst')) {
            summary.takeover += 1;
        }

        return summary;
    }, {
        total: 0,
        shift: 0,
        absence: 0,
        special: 0,
        takeover: 0
    });

    const bySheet = items.reduce((summary, item) => {
        summary[item.sourceSheet] = (summary[item.sourceSheet] || 0) + 1;
        return summary;
    }, {});

    const byLocation = items.reduce((summary, item) => {
        if (item.location) {
            summary[item.location] = (summary[item.location] || 0) + 1;
        }

        return summary;
    }, {});

    const byStatus = items.reduce((summary, item) => {
        summary[item.status] = (summary[item.status] || 0) + 1;
        return summary;
    }, {});

    console.log('\n=== Import samenvatting ===');
    console.table(totals);

    console.log('\n=== Items per sheet ===');
    console.table(bySheet);

    console.log('\n=== Items per locatie ===');
    console.table(byLocation);

    console.log('\n=== Items per status ===');
    console.table(byStatus);

    if (missingSheets.length > 0) {
        console.log('\n=== Ontbrekende sheets ===');
        console.table(missingSheets);
    }

    if (unknownColors.length > 0) {
        console.log('\n=== Onbekende kleuren / cellen om te controleren ===');
        console.table(unknownColors.slice(0, 25));
    }
}

async function main() {
    const workbook = new ExcelJS.Workbook();

    console.log(`Roosterbestand lezen: ${workbookPath}`);

    await workbook.xlsx.readFile(workbookPath);

    const allItems = [];
    const allUnknownColors = [];
    const missingSheets = [];

    for (const sheetName of REQUIRED_SHEETS) {
        const worksheet = workbook.getWorksheet(sheetName);
        const sheetInfo = parseSheetInfo(sheetName);

        if (!worksheet || !sheetInfo) {
            missingSheets.push(sheetName);
            continue;
        }

        const result = parseWorksheet(worksheet, sheetInfo);

        allItems.push(...result.items);
        allUnknownColors.push(...result.unknownColors);
    }

    savePreviewFile(allItems, allUnknownColors, missingSheets);
    await saveItemsToDatabase(allItems);
    printSummary(allItems, allUnknownColors, missingSheets);
}

main().catch((error) => {
    console.error('Roosterimport mislukt:', error);
    process.exit(1);
});