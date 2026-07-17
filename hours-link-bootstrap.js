const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const expressPath = require.resolve('express');
const express = require('express');
let app = null;
require.cache[expressPath].exports = new Proxy(express, {
    apply(target, thisArg, args) {
        app = Reflect.apply(target, thisArg, args);
        return app;
    }
});
require('./manager-standards-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de Excel-urenlaag.');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'sport-society.db'));
db.configure('busyTimeout', 5000);

const COOKIE = 'sso_session';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FIELDS = ['scheduledHours', 'minimumHours', 'overtimeThisMonth', 'overtimePreviousMonth', 'overtimeAfterMonth'];
const FIELD_LABELS = {
    scheduledHours: 'Ingepland',
    minimumHours: 'Minstens',
    overtimeThisMonth: 'Overuren deze maand',
    overtimePreviousMonth: 'Overuren vorige maand',
    overtimeAfterMonth: 'Overuren na deze maand'
};

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

function parseJson(value, fallback = []) {
    try { return JSON.parse(value || ''); }
    catch { return fallback; }
}

async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

async function createTables() {
    await run(`CREATE TABLE IF NOT EXISTS excel_hour_periods (
        period_key TEXT PRIMARY KEY,
        sheet_name TEXT NOT NULL,
        date_count INTEGER NOT NULL,
        week_count REAL NOT NULL,
        source_file TEXT,
        issues_json TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS excel_hour_summaries (
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
    await run(`CREATE TABLE IF NOT EXISTS excel_hour_overrides (
        period_key TEXT NOT NULL,
        employee_name TEXT NOT NULL COLLATE NOCASE,
        minimum_hours REAL,
        scheduled_hours REAL,
        overtime_this_month REAL,
        overtime_previous_month REAL,
        overtime_after_month REAL,
        note TEXT,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (period_key, employee_name)
    )`);
    await ensureColumn('excel_hour_overrides', 'scheduled_hours', 'REAL');
    await run('CREATE INDEX IF NOT EXISTS idx_excel_hour_summary_employee ON excel_hour_summaries(employee_name, period_key)');
}
const ready = createTables();

function cookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((result, part) => {
        const index = part.indexOf('=');
        if (index > -1) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        return result;
    }, {});
}
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function authenticatedUser(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    return get(`SELECT users.id, users.username, users.display_name AS displayName, users.role
        FROM auth_sessions JOIN users ON users.id=auth_sessions.user_id
        WHERE auth_sessions.token_hash=? AND datetime(auth_sessions.expires_at)>datetime('now')
          AND users.is_active=1 LIMIT 1`, [tokenHash(token)]);
}

function requireManagement(handler, adminOnly = false) {
    return async (req, res) => {
        try {
            await ready;
            const user = await authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in om de Excel-uren te bekijken.' });
            if (adminOnly ? user.role !== 'admin' : !['manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
            }
            await handler(req, res, user);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.status(error.status || 500).json({ message: error.message || 'De Excel-uren konden niet worden verwerkt.' });
        }
    };
}

function publicPeriod(row) {
    if (!row) return null;
    return {
        periodKey: row.periodKey,
        sheetName: row.sheetName,
        dateCount: Number(row.dateCount || 0),
        weekCount: Number(row.weekCount || 0),
        sourceFile: row.sourceFile || null,
        importedAt: row.importedAt || null,
        issues: parseJson(row.issuesJson)
    };
}

function publicSummary(row) {
    if (!row) return null;
    return {
        periodKey: row.periodKey,
        employeeName: row.employeeName,
        sourceColumn: row.sourceColumn || null,
        scheduledHours: row.scheduledHours === null ? null : Number(row.scheduledHours),
        minimumHours: row.minimumHours === null ? null : Number(row.minimumHours),
        overtimeThisMonth: row.overtimeThisMonth === null ? null : Number(row.overtimeThisMonth),
        overtimePreviousMonth: row.overtimePreviousMonth === null ? null : Number(row.overtimePreviousMonth),
        overtimeAfterMonth: row.overtimeAfterMonth === null ? null : Number(row.overtimeAfterMonth),
        sheetTotalHours: row.sheetTotalHours === null ? null : Number(row.sheetTotalHours),
        missingFields: parseJson(row.missingFieldsJson),
        sourceIssues: parseJson(row.issuesJson)
    };
}

function publicOverride(row) {
    if (!row) return null;
    return {
        periodKey: row.periodKey,
        employeeName: row.employeeName,
        scheduledHours: row.scheduledHours === null ? null : Number(row.scheduledHours),
        minimumHours: row.minimumHours === null ? null : Number(row.minimumHours),
        overtimeThisMonth: row.overtimeThisMonth === null ? null : Number(row.overtimeThisMonth),
        overtimePreviousMonth: row.overtimePreviousMonth === null ? null : Number(row.overtimePreviousMonth),
        overtimeAfterMonth: row.overtimeAfterMonth === null ? null : Number(row.overtimeAfterMonth),
        note: row.note || '',
        updatedBy: row.updatedBy || null,
        updatedAt: row.updatedAt || null
    };
}

function mergeSummary(raw, override) {
    const merged = { ...(raw || {}) };
    for (const field of FIELDS) {
        if (override && override[field] !== null && override[field] !== undefined) merged[field] = override[field];
        else if (!(field in merged)) merged[field] = null;
    }
    merged.isComplete = FIELDS.every((field) => Number.isFinite(merged[field]));
    merged.missingFields = FIELDS.filter((field) => !Number.isFinite(merged[field]));
    merged.hasOverride = Boolean(override && FIELDS.some((field) => override[field] !== null && override[field] !== undefined));
    merged.overrideNote = override?.note || '';
    merged.overrideUpdatedBy = override?.updatedBy || null;
    merged.overrideUpdatedAt = override?.updatedAt || null;
    return merged;
}

async function contractEmployeesForMonth(month) {
    const employees = await all(`SELECT employee_name AS employeeName, contract_type AS contractType,
        weekly_contract_hours AS weeklyContractHours, is_active AS isActive, active_from AS activeFrom
        FROM hour_employee_settings WHERE is_active=1`)
        .catch((error) => String(error.message).includes('no such table') ? [] : Promise.reject(error));
    const periods = await all(`SELECT employee_name AS employeeName, effective_from AS effectiveFrom,
        effective_to AS effectiveTo, weekly_hours AS weeklyHours
        FROM hour_contract_periods ORDER BY date(effective_from) DESC`)
        .catch((error) => String(error.message).includes('no such table') ? [] : Promise.reject(error));
    const first = `${month}-01`;
    const [year, number] = month.split('-').map(Number);
    const last = new Date(year, number, 0).toISOString().slice(0, 10);
    const byEmployee = new Map();
    for (const period of periods) {
        const key = employeeKey(period.employeeName);
        if (!byEmployee.has(key)) byEmployee.set(key, []);
        byEmployee.get(key).push(period);
    }

    return employees.flatMap((employee) => {
        if (employee.activeFrom && employee.activeFrom > last) return [];
        const applicable = (byEmployee.get(employeeKey(employee.employeeName)) || [])
            .find((period) => period.effectiveFrom <= last && (!period.effectiveTo || period.effectiveTo >= first));
        const weeklyContractHours = applicable
            ? Number(applicable.weeklyHours)
            : (employee.contractType === 'contract' ? Number(employee.weeklyContractHours || 0) : 0);
        return weeklyContractHours > 0 ? [{ employeeName: employee.employeeName, weeklyContractHours }] : [];
    });
}

async function excelAnalysis(requestedMonth, user) {
    const periods = (await all(`SELECT period_key AS periodKey, sheet_name AS sheetName,
        date_count AS dateCount, week_count AS weekCount, source_file AS sourceFile,
        issues_json AS issuesJson, imported_at AS importedAt
        FROM excel_hour_periods ORDER BY period_key`)).map(publicPeriod);
    if (!periods.length) {
        return {
            requestedMonth,
            period: null,
            employees: [],
            issues: user.role === 'admin' ? [{ type: 'no_import', message: 'Er zijn nog geen Excel-urenpagina’s geïmporteerd.' }] : [],
            issueCount: 1,
            permissions: { canEdit: user.role === 'admin' }
        };
    }

    const exactPeriod = periods.find((period) => period.periodKey === requestedMonth);
    const selectedPeriod = exactPeriod
        || [...periods].reverse().find((period) => period.periodKey <= requestedMonth)
        || periods.at(-1);
    const summaries = (await all(`SELECT period_key AS periodKey, employee_name AS employeeName,
        source_column AS sourceColumn, scheduled_hours AS scheduledHours,
        minimum_hours AS minimumHours, overtime_this_month AS overtimeThisMonth,
        overtime_previous_month AS overtimePreviousMonth, overtime_after_month AS overtimeAfterMonth,
        sheet_total_hours AS sheetTotalHours, missing_fields_json AS missingFieldsJson,
        issues_json AS issuesJson FROM excel_hour_summaries
        WHERE period_key<=? ORDER BY period_key`, [selectedPeriod.periodKey])).map(publicSummary);
    const overrides = (await all(`SELECT period_key AS periodKey, employee_name AS employeeName,
        scheduled_hours AS scheduledHours, minimum_hours AS minimumHours,
        overtime_this_month AS overtimeThisMonth, overtime_previous_month AS overtimePreviousMonth,
        overtime_after_month AS overtimeAfterMonth, note, updated_by AS updatedBy,
        updated_at AS updatedAt FROM excel_hour_overrides
        WHERE period_key<=? ORDER BY period_key`, [selectedPeriod.periodKey])).map(publicOverride);

    const summaryMap = new Map(summaries.map((row) => [`${row.periodKey}|${employeeKey(row.employeeName)}`, row]));
    const overrideMap = new Map(overrides.map((row) => [`${row.periodKey}|${employeeKey(row.employeeName)}`, row]));
    const expected = await contractEmployeesForMonth(requestedMonth);
    const expectedMap = new Map(expected.map((row) => [employeeKey(row.employeeName), row]));
    const currentRows = summaries.filter((row) => row.periodKey === selectedPeriod.periodKey);
    const names = new Map(expected.map((row) => [employeeKey(row.employeeName), row.employeeName]));
    for (const row of currentRows) {
        if (FIELDS.some((field) => Number.isFinite(row[field]))) names.set(employeeKey(row.employeeName), row.employeeName);
    }

    const issues = [];
    if (!exactPeriod) {
        issues.push({
            type: 'period_fallback',
            periodKey: requestedMonth,
            sourcePeriodKey: selectedPeriod.periodKey,
            message: `Pagina ${requestedMonth} ontbreekt; ${selectedPeriod.sheetName} wordt als meest recente leesbare pagina gebruikt.`
        });
    }
    for (const message of selectedPeriod.issues || []) {
        issues.push({ type: 'period_structure', periodKey: selectedPeriod.periodKey, message });
    }

    const periodKeysDescending = periods
        .filter((period) => period.periodKey <= selectedPeriod.periodKey)
        .map((period) => period.periodKey)
        .sort().reverse();
    const employees = [];

    for (const [key, name] of names) {
        const expectedEmployee = expectedMap.get(key) || null;
        const currentRaw = summaryMap.get(`${selectedPeriod.periodKey}|${key}`) || null;
        const currentOverride = overrideMap.get(`${selectedPeriod.periodKey}|${key}`) || null;
        const current = mergeSummary(currentRaw, currentOverride);
        let effective = current;
        let sourcePeriodKey = selectedPeriod.periodKey;
        let usedFallback = false;

        if (!current.isComplete) {
            for (const periodKey of periodKeysDescending) {
                if (periodKey === selectedPeriod.periodKey) continue;
                const candidate = mergeSummary(
                    summaryMap.get(`${periodKey}|${key}`) || null,
                    overrideMap.get(`${periodKey}|${key}`) || null
                );
                if (candidate.isComplete) {
                    effective = candidate;
                    sourcePeriodKey = periodKey;
                    usedFallback = true;
                    break;
                }
            }
        }

        const sourcePeriod = periods.find((period) => period.periodKey === sourcePeriodKey) || selectedPeriod;
        const employeeIssues = [...(currentRaw?.sourceIssues || [])];
        if (!current.isComplete) {
            const missing = current.missingFields.map((field) => FIELD_LABELS[field] || field).join(', ');
            issues.push({
                type: usedFallback ? 'employee_fallback' : 'employee_missing',
                periodKey: selectedPeriod.periodKey,
                employeeName: name,
                missingFields: current.missingFields,
                sourcePeriodKey: usedFallback ? sourcePeriodKey : null,
                message: usedFallback
                    ? `${name}: ${missing} ontbreekt op ${selectedPeriod.sheetName}; waarden uit ${sourcePeriod.sheetName} worden tijdelijk gebruikt.`
                    : `${name}: ${missing} ontbreekt en er is geen eerdere complete maand beschikbaar.`
            });
        }
        if (!expectedEmployee) {
            issues.push({
                type: 'employee_not_configured',
                periodKey: selectedPeriod.periodKey,
                employeeName: name,
                message: `${name} heeft Excel-urenvelden maar staat niet als actieve contractmedewerker ingesteld.`
            });
        }
        for (const message of employeeIssues) {
            issues.push({ type: 'source_validation', periodKey: selectedPeriod.periodKey, employeeName: name, message: `${name}: ${message}` });
        }

        employees.push({
            employeeName: name,
            weeklyContractHours: expectedEmployee?.weeklyContractHours || null,
            scheduledHours: effective.scheduledHours,
            minimumHours: effective.minimumHours,
            overtimeThisMonth: effective.overtimeThisMonth,
            overtimePreviousMonth: effective.overtimePreviousMonth,
            overtimeAfterMonth: effective.overtimeAfterMonth,
            requestedPeriodKey: requestedMonth,
            periodKey: selectedPeriod.periodKey,
            sourcePeriodKey,
            sourceSheetName: sourcePeriod.sheetName,
            sourceColumn: currentRaw?.sourceColumn || effective.sourceColumn || null,
            isComplete: effective.isComplete,
            usedFallback,
            hasOverride: current.hasOverride,
            overrideNote: current.overrideNote,
            status: !effective.isComplete ? 'missing' : usedFallback ? 'fallback' : current.hasOverride ? 'corrected' : 'excel'
        });
    }

    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'));
    return {
        requestedMonth,
        period: { ...selectedPeriod, isFallback: !exactPeriod },
        employees,
        issues: user.role === 'admin' ? issues : [],
        issueCount: issues.length,
        availablePeriods: periods.map((period) => period.periodKey),
        permissions: { canEdit: user.role === 'admin' }
    };
}

function numericOrNull(value, label) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < -2000 || number > 2000) {
        const error = new Error(`${label} moet een geldig aantal uren tussen -2000 en 2000 zijn.`);
        error.status = 400;
        throw error;
    }
    return round(number);
}

app.get('/api/hours/excel-analysis', requireManagement(async (req, res, user) => {
    const requestedMonth = MONTH_RE.test(String(req.query.month || ''))
        ? String(req.query.month)
        : new Date().toISOString().slice(0, 7);
    res.json(await excelAnalysis(requestedMonth, user));
}));

app.get('/api/hours/excel-periods', requireManagement(async (req, res) => {
    const periods = await all(`SELECT period_key AS periodKey, sheet_name AS sheetName,
        date_count AS dateCount, week_count AS weekCount, source_file AS sourceFile,
        issues_json AS issuesJson, imported_at AS importedAt
        FROM excel_hour_periods ORDER BY period_key DESC`);
    res.json({ periods: periods.map(publicPeriod) });
}));

app.put('/api/hours/excel-overrides', requireManagement(async (req, res, user) => {
    const periodKey = String(req.body.periodKey || '').trim();
    const employeeName = String(req.body.employeeName || '').trim();
    if (!MONTH_RE.test(periodKey)) return res.status(400).json({ message: 'Kies een geldige maand.' });
    if (!employeeName || employeeName.length > 120) return res.status(400).json({ message: 'Kies een geldige medewerker.' });
    const period = await get('SELECT period_key FROM excel_hour_periods WHERE period_key=?', [periodKey]);
    if (!period) return res.status(404).json({ message: 'Deze Excel-maand is niet geïmporteerd.' });

    const values = {
        scheduledHours: numericOrNull(req.body.scheduledHours, 'Ingepland'),
        minimumHours: numericOrNull(req.body.minimumHours, 'Minstens'),
        overtimeThisMonth: numericOrNull(req.body.overtimeThisMonth, 'Overuren deze maand'),
        overtimePreviousMonth: numericOrNull(req.body.overtimePreviousMonth, 'Overuren vorige maand'),
        overtimeAfterMonth: numericOrNull(req.body.overtimeAfterMonth, 'Overuren na deze maand')
    };
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (!FIELDS.some((field) => values[field] !== null)) {
        return res.status(400).json({ message: 'Vul minimaal één handmatige waarde in.' });
    }

    await run(`INSERT INTO excel_hour_overrides (
        period_key, employee_name, scheduled_hours, minimum_hours, overtime_this_month,
        overtime_previous_month, overtime_after_month, note, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(period_key, employee_name) DO UPDATE SET
        scheduled_hours=excluded.scheduled_hours,
        minimum_hours=excluded.minimum_hours,
        overtime_this_month=excluded.overtime_this_month,
        overtime_previous_month=excluded.overtime_previous_month,
        overtime_after_month=excluded.overtime_after_month,
        note=excluded.note, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`, [
        periodKey, employeeName, values.scheduledHours, values.minimumHours,
        values.overtimeThisMonth, values.overtimePreviousMonth,
        values.overtimeAfterMonth, note, user.displayName || user.username
    ]);
    res.json({ message: 'Handmatige Excel-urencorrectie opgeslagen.' });
}, true));

app.delete('/api/hours/excel-overrides', requireManagement(async (req, res) => {
    const periodKey = String(req.body.periodKey || '').trim();
    const employeeName = String(req.body.employeeName || '').trim();
    if (!MONTH_RE.test(periodKey) || !employeeName) return res.status(400).json({ message: 'Maand en medewerker zijn verplicht.' });
    const result = await run('DELETE FROM excel_hour_overrides WHERE period_key=? AND employee_name=? COLLATE NOCASE', [periodKey, employeeName]);
    res.json({ message: result.changes ? 'Handmatige correctie verwijderd.' : 'Er was geen handmatige correctie.' });
}, true));

app.get('/api/hours/declared-corrections', requireManagement(async (req, res) => {
    res.json({ month: String(req.query.month || ''), source: 'Vervangen door Excel-maandoverzicht', employees: [] });
}));
