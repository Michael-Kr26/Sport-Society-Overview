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
require('./staffing-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de urenanalyse.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const COOKIE = 'sso_session';
const CONTRACT_TYPES = new Set(['flex', 'contract']);
const ADJUSTMENT_TYPES = new Set(['credited', 'bank']);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEED_VERSION = 1;
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

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

const DEFAULT_CONTRACTS = [
    ['Leroy', 36, '2026-01-01'], ['Leon', 38, '2026-01-01'],
    ['Mario', 32, '2026-01-01'], ['Koen', 21, '2026-01-01'],
    ['Lucas V', 36, '2026-01-01'], ['Dysianne', 34, '2026-01-01'],
    ['Michael', 28, '2026-01-01'], ['Tristan', 15, '2026-01-01', '2026-05-31'],
    ['Tristan', 8, '2026-06-01'], ['Denise', 22, '2026-01-01']
].map(([employeeName, weeklyHours, effectiveFrom, effectiveTo = null]) => ({ employeeName, weeklyHours, effectiveFrom, effectiveTo }));

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
    return get(
        `SELECT users.id, users.username, users.display_name AS displayName, users.role
         FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ? AND datetime(auth_sessions.expires_at) > datetime('now')
           AND users.is_active = 1 LIMIT 1`,
        [tokenHash(token)]
    );
}
function apiError(res, error, fallback = 'De urenmodule kon de aanvraag niet verwerken.') {
    console.error(error);
    if (!res.headersSent) res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}
function requireRoles(...roles) {
    return async (req, res, next) => {
        try {
            await ready;
            const user = await authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in om de urenanalyse te bekijken.' });
            if (!roles.includes(user.role)) return res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
            req.hoursUser = user;
            next();
        } catch (error) { apiError(res, error); }
    };
}

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const employeeKey = (name) => String(name || '').toLocaleLowerCase('nl-NL');
const mapKey = (name, month) => `${employeeKey(name)}|${month}`;
const currentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const normalizeMonth = (value, fallback = currentMonth()) => MONTH_RE.test(String(value || '')) ? String(value) : fallback;
const monthStart = (month) => `${month}-01`;
const monthEnd = (month) => {
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number, 0).toISOString().slice(0, 10);
};
function addMonths(month, amount) {
    const [year, number] = month.split('-').map(Number);
    const date = new Date(year, number - 1 + amount, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function monthsBetween(from, to) {
    const result = [];
    for (let month = from; month <= to && result.length < 240; month = addMonths(month, 1)) result.push(month);
    return result;
}
function shiftHours({ startTime, endTime }) {
    const parse = (value) => {
        const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const start = parse(startTime), end = parse(endTime);
    if (start === null || end === null) return 0;
    return round(((end <= start ? end + 1440 : end) - start) / 60);
}
const addToMap = (map, key, value) => map.set(key, round((map.get(key) || 0) + value));

function contractHoursForMonth(employee, periodsByEmployee, month) {
    const periods = periodsByEmployee.get(employeeKey(employee.employeeName)) || [];
    const first = monthStart(month), last = monthEnd(month);
    const applicable = periods
        .filter((period) => period.effectiveFrom <= last && (!period.effectiveTo || period.effectiveTo >= first))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (applicable) return round(applicable.weeklyHours);
    if (periods.length) return 0;
    return employee.contractType === 'contract' ? round(employee.weeklyContractHours) : 0;
}

async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
async function ensureRosterEmployees() {
    const rows = await all(
        `SELECT TRIM(employee_name) AS employeeName, MIN(date(roster_date)) AS activeFrom
         FROM roster_items
         WHERE employee_name IS NOT NULL AND TRIM(employee_name) != '' AND UPPER(TRIM(employee_name)) != 'ALL'
         GROUP BY LOWER(TRIM(employee_name))`
    ).catch((error) => String(error.message).includes('no such table: roster_items') ? [] : Promise.reject(error));
    for (const row of rows) {
        await run(
            `INSERT OR IGNORE INTO hour_employee_settings
             (employee_name, contract_type, weekly_contract_hours, opening_bank_hours, opening_bank_month,
              active_from, is_active, updated_by)
             VALUES (?, 'flex', 0, 0, ?, ?, 1, 'Automatisch uit rooster')`,
            [row.employeeName, String(row.activeFrom || currentMonth()).slice(0, 7), row.activeFrom || monthStart(currentMonth())]
        );
    }
}
async function seedContracts() {
    const seed = await get('SELECT version FROM hour_seed_state WHERE id = 1');
    if (Number(seed?.version || 0) >= SEED_VERSION) return;
    for (const contract of DEFAULT_CONTRACTS) {
        await run(
            `INSERT INTO hour_employee_settings
             (employee_name, contract_type, weekly_contract_hours, opening_bank_hours, opening_bank_month,
              active_from, is_active, updated_by, updated_at)
             VALUES (?, 'contract', ?, 0, '2026-01', ?, 1, 'Aangeleverde contracturen', CURRENT_TIMESTAMP)
             ON CONFLICT(employee_name) DO UPDATE SET contract_type='contract', weekly_contract_hours=excluded.weekly_contract_hours,
                 active_from=MIN(active_from, excluded.active_from), is_active=1, updated_by=excluded.updated_by,
                 updated_at=CURRENT_TIMESTAMP`,
            [contract.employeeName, contract.weeklyHours, contract.effectiveFrom]
        );
        await run(
            `INSERT OR IGNORE INTO hour_contract_periods
             (employee_name, effective_from, effective_to, weekly_hours, created_by)
             VALUES (?, ?, ?, ?, 'Aangeleverde contracturen')`,
            [contract.employeeName, contract.effectiveFrom, contract.effectiveTo, contract.weeklyHours]
        );
    }
    await run(
        `INSERT INTO hour_seed_state (id, version, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET version=excluded.version, updated_at=CURRENT_TIMESTAMP`,
        [SEED_VERSION]
    );
}

const ready = (async () => {
    await run(`CREATE TABLE IF NOT EXISTS hour_employee_settings (
        employee_name TEXT PRIMARY KEY COLLATE NOCASE,
        contract_type TEXT NOT NULL DEFAULT 'flex', weekly_contract_hours REAL NOT NULL DEFAULT 0,
        opening_bank_hours REAL NOT NULL DEFAULT 0, opening_bank_month TEXT NOT NULL,
        active_from TEXT NOT NULL DEFAULT '1900-01-01', is_active INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await ensureColumn('hour_employee_settings', 'active_from', "TEXT NOT NULL DEFAULT '1900-01-01'");
    await run(`UPDATE hour_employee_settings SET active_from = COALESCE(
        (SELECT MIN(date(roster_date)) FROM roster_items
         WHERE LOWER(TRIM(employee_name)) = LOWER(TRIM(hour_employee_settings.employee_name))),
        opening_bank_month || '-01') WHERE active_from = '1900-01-01'`
    ).catch((error) => { if (!String(error.message).includes('no such table: roster_items')) throw error; });
    await run(`CREATE TABLE IF NOT EXISTS hour_contract_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employee_name TEXT NOT NULL COLLATE NOCASE,
        effective_from TEXT NOT NULL, effective_to TEXT, weekly_hours REAL NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_name, effective_from),
        FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name) ON UPDATE CASCADE ON DELETE CASCADE
    )`);
    await run(`CREATE TABLE IF NOT EXISTS hour_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, employee_name TEXT NOT NULL COLLATE NOCASE,
        adjustment_date TEXT NOT NULL, adjustment_type TEXT NOT NULL, hours REAL NOT NULL, note TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name) ON UPDATE CASCADE ON DELETE CASCADE
    )`);
    await run(`CREATE TABLE IF NOT EXISTS hour_seed_state (
        id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_hour_adjustments_date ON hour_adjustments(adjustment_date)');
    await run('CREATE INDEX IF NOT EXISTS idx_hour_adjustments_employee ON hour_adjustments(employee_name)');
    await run('CREATE INDEX IF NOT EXISTS idx_hour_contract_periods_employee ON hour_contract_periods(employee_name)');
    await ensureRosterEmployees();
    await seedContracts();
})();

async function employeesWithPeriods() {
    const employees = await all(`SELECT employee_name AS employeeName, contract_type AS contractType,
        weekly_contract_hours AS weeklyContractHours, opening_bank_hours AS openingBankHours,
        opening_bank_month AS openingBankMonth, active_from AS activeFrom, is_active AS isActive,
        updated_by AS updatedBy, updated_at AS updatedAt
        FROM hour_employee_settings ORDER BY is_active DESC, LOWER(employee_name)`);
    const periods = await all(`SELECT id, employee_name AS employeeName, effective_from AS effectiveFrom,
        effective_to AS effectiveTo, weekly_hours AS weeklyHours, created_by AS createdBy,
        created_at AS createdAt FROM hour_contract_periods ORDER BY LOWER(employee_name), date(effective_from)`);
    const periodsByEmployee = new Map();
    for (const period of periods) {
        const key = employeeKey(period.employeeName);
        if (!periodsByEmployee.has(key)) periodsByEmployee.set(key, []);
        periodsByEmployee.get(key).push(period);
    }
    return { employees, periodsByEmployee };
}

async function analysisFor(month) {
    await ensureRosterEmployees();
    const { employees, periodsByEmployee } = await employeesWithPeriods();
    const selectedEnd = monthEnd(month);
    const activeEmployees = employees.filter((employee) => employee.isActive && (!employee.activeFrom || employee.activeFrom <= selectedEnd));
    const previousMonth = addMonths(month, -1);
    const earliest = activeEmployees.map((employee) => [normalizeMonth(employee.openingBankMonth, month), String(employee.activeFrom || '').slice(0, 7) || month].sort().reverse()[0]).sort()[0] || month;
    const fromMonth = [earliest, previousMonth].sort()[0];
    const toMonth = addMonths(month, 1);

    const shifts = await all(`SELECT roster_date AS rosterDate, employee_name AS employeeName, location,
        start_time AS startTime, end_time AS endTime FROM roster_items
        WHERE item_type='shift' AND employee_name IS NOT NULL AND UPPER(TRIM(employee_name))!='ALL'
          AND date(roster_date)>=date(?) AND date(roster_date)<date(?)`,
        [monthStart(fromMonth), monthStart(toMonth)]
    ).catch((error) => String(error.message).includes('no such table: roster_items') ? [] : Promise.reject(error));
    const adjustments = await all(`SELECT id, employee_name AS employeeName, adjustment_date AS adjustmentDate,
        adjustment_type AS adjustmentType, hours, note, created_by AS createdBy, created_at AS createdAt
        FROM hour_adjustments WHERE date(adjustment_date)>=date(?) AND date(adjustment_date)<date(?)
        ORDER BY date(adjustment_date) DESC, id DESC`, [monthStart(fromMonth), monthStart(toMonth)]);

    const scheduled = new Map(), locations = new Map(), credited = new Map(), bank = new Map();
    for (const shift of shifts) {
        const key = mapKey(shift.employeeName, String(shift.rosterDate || '').slice(0, 7));
        addToMap(scheduled, key, shiftHours(shift));
        if (!locations.has(key)) locations.set(key, new Set());
        if (shift.location) locations.get(key).add(shift.location);
    }
    for (const adjustment of adjustments) {
        const key = mapKey(adjustment.employeeName, String(adjustment.adjustmentDate || '').slice(0, 7));
        addToMap(adjustment.adjustmentType === 'bank' ? bank : credited, key, adjustment.hours);
    }

    const result = activeEmployees.map((employee) => {
        const key = mapKey(employee.employeeName, month), previousKey = mapKey(employee.employeeName, previousMonth);
        const scheduledHours = round(scheduled.get(key)), creditedAdjustment = round(credited.get(key));
        const bankAdjustment = round(bank.get(key)), creditedHours = round(scheduledHours + creditedAdjustment);
        const previousScheduledHours = round(scheduled.get(previousKey));
        const weeklyContractHours = contractHoursForMonth(employee, periodsByEmployee, month);
        const contractType = weeklyContractHours > 0 ? 'contract' : 'flex';
        const monthlyNorm = contractType === 'contract' ? round(weeklyContractHours * 4.33) : null;
        const monthDelta = contractType === 'contract' ? round(creditedHours - monthlyNorm + bankAdjustment) : null;
        let bankBalance = null;
        if (contractType === 'contract') {
            const activeMonth = String(employee.activeFrom || '').slice(0, 7) || month;
            const openingMonth = [normalizeMonth(employee.openingBankMonth, month), activeMonth].sort().reverse()[0];
            bankBalance = round(employee.openingBankHours);
            for (const bankMonth of monthsBetween(openingMonth, month)) {
                const monthKey = mapKey(employee.employeeName, bankMonth);
                const norm = round(contractHoursForMonth(employee, periodsByEmployee, bankMonth) * 4.33);
                bankBalance = round(bankBalance + round(scheduled.get(monthKey)) + round(credited.get(monthKey)) - norm + round(bank.get(monthKey)));
            }
        }
        return {
            employeeName: employee.employeeName, contractType, weeklyContractHours, monthlyNorm,
            scheduledHours, creditedAdjustment, creditedHours, bankAdjustment, monthDelta, bankBalance,
            previousScheduledHours, trendHours: round(scheduledHours - previousScheduledHours),
            locations: [...(locations.get(key) || [])].sort(), openingBankHours: round(employee.openingBankHours),
            openingBankMonth: normalizeMonth(employee.openingBankMonth, month), activeFrom: employee.activeFrom
        };
    });
    const flex = result.filter((employee) => employee.contractType === 'flex');
    const contracts = result.filter((employee) => employee.contractType === 'contract');
    const flexAverageHours = flex.length ? round(flex.reduce((sum, employee) => sum + employee.creditedHours, 0) / flex.length) : 0;
    for (const employee of flex) employee.flexDifference = round(employee.creditedHours - flexAverageHours);
    return {
        month, previousMonth, generatedAt: new Date().toISOString(),
        summary: {
            employeeCount: result.length, contractEmployeeCount: contracts.length, flexEmployeeCount: flex.length,
            totalScheduledHours: round(result.reduce((sum, employee) => sum + employee.scheduledHours, 0)),
            totalCreditedHours: round(result.reduce((sum, employee) => sum + employee.creditedHours, 0)),
            contractMonthDelta: round(contracts.reduce((sum, employee) => sum + employee.monthDelta, 0)), flexAverageHours
        },
        employees: result,
        adjustments: adjustments.filter((adjustment) => String(adjustment.adjustmentDate || '').slice(0, 7) === month),
        permissions: { canEdit: false }
    };
}

app.get('/api/hours/analysis', requireRoles('manager', 'admin'), async (req, res) => {
    try {
        const result = await analysisFor(normalizeMonth(req.query.month));
        result.permissions.canEdit = req.hoursUser.role === 'admin';
        res.json(result);
    } catch (error) { apiError(res, error); }
});
app.get('/api/hours/employees', requireRoles('manager', 'admin'), async (req, res) => {
    try {
        await ensureRosterEmployees();
        const { employees, periodsByEmployee } = await employeesWithPeriods();
        res.json({
            employees: employees.map((employee) => ({ ...employee, contractPeriods: periodsByEmployee.get(employeeKey(employee.employeeName)) || [] })),
            permissions: { canEdit: req.hoursUser.role === 'admin' }
        });
    } catch (error) { apiError(res, error); }
});
app.put('/api/hours/employees/:employeeName', requireRoles('admin'), async (req, res) => {
    try {
        const employeeName = String(req.params.employeeName || '').trim();
        const existing = employeeName ? await get('SELECT active_from AS activeFrom FROM hour_employee_settings WHERE employee_name=? COLLATE NOCASE', [employeeName]) : null;
        const contractType = String(req.body.contractType || '').trim();
        const weeklyHours = Number(req.body.weeklyContractHours || 0);
        const effectiveFrom = String(req.body.effectiveFrom || '').trim();
        const activeFrom = String(req.body.activeFrom || existing?.activeFrom || effectiveFrom || monthStart(currentMonth())).trim();
        const openingBankHours = Number(req.body.openingBankHours || 0);
        const openingBankMonth = normalizeMonth(req.body.openingBankMonth, String(activeFrom).slice(0, 7));
        const isActive = req.body.isActive === false || req.body.isActive === 0 ? 0 : 1;
        if (!employeeName || employeeName.length > 120) return res.status(400).json({ message: 'Vul een geldige medewerker in.' });
        if (!CONTRACT_TYPES.has(contractType)) return res.status(400).json({ message: 'Kies flex of contract.' });
        if (!DATE_RE.test(activeFrom)) return res.status(400).json({ message: 'Vul een geldige startdatum in.' });
        if (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 60) return res.status(400).json({ message: 'Contracturen moeten tussen 0 en 60 uur per week liggen.' });
        if (contractType === 'contract' && (weeklyHours <= 0 || !DATE_RE.test(effectiveFrom))) return res.status(400).json({ message: 'Vul contracturen en een geldige ingangsdatum in.' });
        if (!Number.isFinite(openingBankHours) || Math.abs(openingBankHours) > 1000) return res.status(400).json({ message: 'De startstand van de urenbank is ongeldig.' });
        const updatedBy = req.hoursUser.displayName || req.hoursUser.username;
        await run(`INSERT INTO hour_employee_settings
            (employee_name, contract_type, weekly_contract_hours, opening_bank_hours, opening_bank_month,
             active_from, is_active, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(employee_name) DO UPDATE SET contract_type=excluded.contract_type,
                weekly_contract_hours=excluded.weekly_contract_hours, opening_bank_hours=excluded.opening_bank_hours,
                opening_bank_month=excluded.opening_bank_month, active_from=excluded.active_from,
                is_active=excluded.is_active, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`,
            [employeeName, contractType, contractType === 'contract' ? round(weeklyHours) : 0,
             round(openingBankHours), openingBankMonth, activeFrom, isActive, updatedBy]);
        if (contractType === 'contract') {
            await run(`INSERT INTO hour_contract_periods
                (employee_name, effective_from, effective_to, weekly_hours, created_by)
                VALUES (?, ?, NULL, ?, ?)
                ON CONFLICT(employee_name, effective_from) DO UPDATE SET weekly_hours=excluded.weekly_hours,
                    effective_to=NULL, created_by=excluded.created_by`,
                [employeeName, effectiveFrom, round(weeklyHours), updatedBy]);
        }
        res.json({ message: existing ? 'Medewerkerinstellingen opgeslagen.' : 'Medewerker toegevoegd.' });
    } catch (error) { apiError(res, error); }
});
app.post('/api/hours/adjustments', requireRoles('admin'), async (req, res) => {
    try {
        const employeeName = String(req.body.employeeName || '').trim();
        const adjustmentDate = String(req.body.adjustmentDate || '').trim();
        const adjustmentType = String(req.body.adjustmentType || '').trim();
        const hours = Number(req.body.hours), note = String(req.body.note || '').trim().slice(0, 300);
        if (!employeeName || !DATE_RE.test(adjustmentDate)) return res.status(400).json({ message: 'Medewerker en datum zijn verplicht.' });
        if (!ADJUSTMENT_TYPES.has(adjustmentType)) return res.status(400).json({ message: 'Ongeldig correctietype.' });
        if (!Number.isFinite(hours) || !hours || Math.abs(hours) > 250) return res.status(400).json({ message: 'Correctie-uren moeten tussen -250 en 250 liggen en mogen niet nul zijn.' });
        const employee = await get('SELECT employee_name AS employeeName FROM hour_employee_settings WHERE employee_name=? COLLATE NOCASE', [employeeName]);
        if (!employee) return res.status(404).json({ message: 'Medewerker niet gevonden.' });
        const result = await run(`INSERT INTO hour_adjustments
            (employee_name, adjustment_date, adjustment_type, hours, note, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [employee.employeeName, adjustmentDate, adjustmentType, round(hours), note, req.hoursUser.displayName || req.hoursUser.username]);
        res.status(201).json({ message: 'Urencorrectie opgeslagen.', id: result.lastID });
    } catch (error) { apiError(res, error); }
});
app.delete('/api/hours/adjustments/:id', requireRoles('admin'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Ongeldig correctie-ID.' });
        const result = await run('DELETE FROM hour_adjustments WHERE id=?', [id]);
        if (!result.changes) return res.status(404).json({ message: 'Correctie niet gevonden.' });
        res.json({ message: 'Correctie verwijderd.' });
    } catch (error) { apiError(res, error); }
});
