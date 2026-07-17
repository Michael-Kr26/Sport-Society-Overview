const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const sqlite3 = require('sqlite3').verbose();

const workbookPath = process.argv[2] || path.join(__dirname, 'data', 'imports', 'Rooster.xlsx');
const dbPath = path.join(__dirname, 'data', 'sport-society.db');

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

function isNumericHeader(value) {
    return /^-?\d+(?:[.,]\d+)?$/.test(cleanText(value));
}

function employeeColumns(worksheet) {
    const result = new Map();
    const headerRow = worksheet.getRow(1);
    let activeEmployee = null;

    for (let column = 1; column <= worksheet.actualColumnCount; column += 1) {
        const text = getCellText(headerRow.getCell(column));
        const normalized = text.toLocaleLowerCase('nl-NL');
        if (column <= 2 || normalized === 'uren') {
            if (normalized === 'uren') activeEmployee = null;
            result.set(column, null);
            continue;
        }
        if (text && !isNumericHeader(text)) activeEmployee = text;
        result.set(column, activeEmployee);
    }
    return result;
}

function columnNumberFromAddress(address) {
    const match = String(address || '').match(/^([A-Z]+)\d+$/i);
    if (!match) return null;
    return match[1].toUpperCase().split('').reduce((number, character) => number * 26 + character.charCodeAt(0) - 64, 0);
}

function createSourceHash(row) {
    return crypto.createHash('sha256').update([
        row.rosterDate,
        row.employeeName,
        row.itemType,
        row.location || '',
        row.startTime || '',
        row.endTime || '',
        row.status,
        row.note || ''
    ].join('|')).digest('hex');
}

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const all = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function main() {
    if (!fs.existsSync(workbookPath)) throw new Error(`Roosterbestand niet gevonden: ${workbookPath}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const mappings = new Map();
    workbook.eachSheet((worksheet) => mappings.set(worksheet.name, employeeColumns(worksheet)));

    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);
    let correctedSlots = 0;
    let correctedEmployees = 0;

    try {
        const rows = await all(db, `SELECT id, roster_date AS rosterDate, employee_name AS employeeName,
            source_slot_employee AS sourceSlotEmployee, item_type AS itemType, location,
            start_time AS startTime, end_time AS endTime, status, note,
            source_sheet AS sourceSheet, source_cell AS sourceCell
            FROM roster_items WHERE source_sheet IS NOT NULL AND source_cell IS NOT NULL`);
        await run(db, 'BEGIN IMMEDIATE');
        try {
            for (const row of rows) {
                const column = columnNumberFromAddress(row.sourceCell);
                const expected = column ? mappings.get(row.sourceSheet)?.get(column) : null;
                if (!expected) continue;
                const numericSlot = isNumericHeader(row.sourceSlotEmployee);
                const numericEmployee = isNumericHeader(row.employeeName);
                const nextSourceSlot = numericSlot || !row.sourceSlotEmployee ? expected : row.sourceSlotEmployee;
                let nextEmployee = row.employeeName;
                if (row.employeeName !== 'ALL' && numericEmployee) nextEmployee = expected;
                if (nextSourceSlot === row.sourceSlotEmployee && nextEmployee === row.employeeName) continue;

                const nextHash = createSourceHash({ ...row, employeeName: nextEmployee });
                await run(db, `UPDATE roster_items
                    SET source_slot_employee=?, employee_name=?, source_hash=? WHERE id=?`,
                [nextSourceSlot, nextEmployee, nextHash, row.id]);
                if (nextSourceSlot !== row.sourceSlotEmployee) correctedSlots += 1;
                if (nextEmployee !== row.employeeName) correctedEmployees += 1;
            }
            await run(db, 'COMMIT');
        } catch (error) {
            await run(db, 'ROLLBACK').catch(() => {});
            throw error;
        }
    } finally {
        await close(db);
    }

    console.log(`Numerieke Excel-tussenkoppen hersteld: ${correctedSlots} bronkolommen en ${correctedEmployees} medewerkerregels.`);
}

main().catch((error) => {
    console.error('Normaliseren van Excel-medewerkerkoppen mislukt:', error);
    process.exit(1);
});
