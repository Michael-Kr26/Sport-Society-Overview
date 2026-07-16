const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const expressModulePath = require.resolve('express');
const originalExpress = require('express');
let capturedApp = null;

const capturingExpress = new Proxy(originalExpress, {
    apply(target, thisArg, args) {
        capturedApp = Reflect.apply(target, thisArg, args);
        return capturedApp;
    }
});

require.cache[expressModulePath].exports = capturingExpress;
require('./staffing-bootstrap');
require.cache[expressModulePath].exports = originalExpress;

if (!capturedApp) {
    throw new Error('Express-app kon niet worden gekoppeld aan de urenanalyse.');
}

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const SESSION_COOKIE_NAME = 'sso_session';
const CONTRACT_TYPES = ['flex', 'contract'];
const ADJUSTMENT_TYPES = ['credited', 'bank'];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEED_VERSION = 1;
const hoursDb = new sqlite3.Database(DB_PATH);
hoursDb.configure('busyTimeout', 5000);

const DEFAULT_CONTRACTS = [
    { employeeName: 'Leroy', weeklyHours: 36, effectiveFrom: '2026-01-01' },
    { employeeName: 'Leon', weeklyHours: 38, effectiveFrom: '2026-01-01' },
    { employeeName: 'Mario', weeklyHours: 32, effectiveFrom: '2026-01-01' },
    { employeeName: 'Koen', weeklyHours: 21, effectiveFrom: '2026-01-01' },
    { employeeName: 'Lucas V', weeklyHours: 36, effectiveFrom: '2026-01-01' },
    { employeeName: 'Dysianne', weeklyHours: 34, effectiveFrom: '2026-01-01' },
    { employeeName: 'Michael', weeklyHours: 28, effectiveFrom: '2026-01-01' },
    { employeeName: 'Tristan', weeklyHours: 15, effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31' },
    { employeeName: 'Tristan', weeklyHours: 8, effectiveFrom: '2026-06-01' },
    { employeeName: 'Denise', weeklyHours: 22, effectiveFrom: '2026-01-01' }
];

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        hoursDb.run(sql, params, function (error) {
            if (error) {
                reject(error);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        hoursDb.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        hoursDb.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(rows || []);
        });
    });
}

function parseCookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return cookies;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function getAuthenticatedUser(req) {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    if (!token) return null;

    return dbGet(
        `SELECT users.id, users.username, users.display_name AS displayName, users.role
         FROM auth_sessions
         INNER JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND datetime(auth_sessions.expires_at) > datetime('now')
           AND users.is_active = 1
         LIMIT 1`,
        [hashSessionToken(token)]
    );
}

function sendApiError(res, error, fallback = 'De urenmodule kon de aanvraag niet verwerken.') {
    console.error(error);
    if (!res.headersSent) {
        res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
    }
}

function requireHoursRoles(...roles) {
    return async (req, res, next) => {
        try {
            await hoursReady;
            const user = await getAuthenticatedUser(req);
            if (!user) {
                res.status(401).json({ message: 'Log eerst in om de urenanalyse te bekijken.' });
                return;
            }
            if (!roles.includes(user.role)) {
                res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
                return;
            }
            req.hoursUser = user;
            next();
        } catch (error) {
            sendApiError(res, error);
        }
    };
}

function roundHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function currentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeMonth(value, fallback = currentMonth()) {
    return MONTH_PATTERN.test(String(value || '')) ? String(value) : fallback;
}

function monthStart(month) {
    return `${month}-01`;
}

function monthEnd(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(year, monthNumber, 0).toISOString().slice(0, 10);
}

function addMonths(month, amount) {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(year, monthNumber - 1 + amount, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function enumerateMonths(fromMonth, toMonth) {
    if (fromMonth > toMonth) return [];
    const months = [];
    let cursor = fromMonth;
    while (cursor <= toMonth && months.length < 240) {
        months.push(cursor);
        cursor = addMonths(cursor, 1);
    }
    return months;
}

function timeToMinutes(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

function getShiftHours(item) {
    const start = timeToMinutes(item.startTime);
    const end = timeToMinutes(item.endTime);
    if (start === null || end === null) return 0;
    const duration = end <= start ? end + 1440 - start : end - start;
    return roundHours(duration / 60);
}

function keyFor(employeeName, month) {
    return `${String(employeeName).toLocaleLowerCase('nl-NL')}|${month}`;
}

function employeeKey(employeeName) {
    return String(employeeName || '').toLocaleLowerCase('nl-NL');
}

function mapAdd(map, key, value) {
    map.set(key, roundHours((map.get(key) || 0) + value));
}

function getContractHoursForMonth(employee, periodsByEmployee, month) {
    const periods = periodsByEmployee.get(employeeKey(employee.employeeName)) || [];
    const firstDay = monthStart(month);
    const lastDay = monthEnd(month);
    const applicable = periods
        .filter((period) => period.effectiveFrom <= lastDay && (!period.effectiveTo || period.effectiveTo >= firstDay))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

    if (applicable) return roundHours(applicable.weeklyHours);
    return employee.contractType === 'contract' ? roundHours(employee.weeklyContractHours) : 0;
}

async function ensureRosterEmployees() {
    const names = await dbAll(
        `SELECT DISTINCT TRIM(employee_name) AS employeeName
         FROM roster_items
         WHERE employee_name IS NOT NULL
           AND TRIM(employee_name) != ''
           AND UPPER(TRIM(employee_name)) != 'ALL'`
    ).catch((error) => {
        if (String(error.message).includes('no such table: roster_items')) return [];
        throw error;
    });

    for (const row of names) {
        await dbRun(
            `INSERT OR IGNORE INTO hour_employee_settings (
                employee_name, contract_type, weekly_contract_hours,
                opening_bank_hours, opening_bank_month, is_active, updated_by
             ) VALUES (?, 'flex', 0, 0, ?, 1, 'Automatisch uit rooster')`,
            [row.employeeName, currentMonth()]
        );
    }
}

async function seedContractData() {
    const seedRow = await dbGet('SELECT version FROM hour_seed_state WHERE id = 1');
    if (seedRow && Number(seedRow.version) >= SEED_VERSION) return;

    for (const contract of DEFAULT_CONTRACTS) {
        await dbRun(
            `INSERT INTO hour_employee_settings (
                employee_name, contract_type, weekly_contract_hours,
                opening_bank_hours, opening_bank_month, is_active, updated_by, updated_at
             ) VALUES (?, 'contract', ?, 0, '2026-01', 1, 'Aangeleverde contracturen', CURRENT_TIMESTAMP)
             ON CONFLICT(employee_name) DO UPDATE SET
                contract_type = 'contract',
                weekly_contract_hours = excluded.weekly_contract_hours,
                is_active = 1,
                updated_by = excluded.updated_by,
                updated_at = CURRENT_TIMESTAMP`,
            [contract.employeeName, contract.weeklyHours]
        );

        await dbRun(
            `INSERT OR IGNORE INTO hour_contract_periods (
                employee_name, effective_from, effective_to, weekly_hours, created_by
             ) VALUES (?, ?, ?, ?, 'Aangeleverde contracturen')`,
            [contract.employeeName, contract.effectiveFrom, contract.effectiveTo || null, contract.weeklyHours]
        );
    }

    await dbRun(
        `INSERT INTO hour_seed_state (id, version, updated_at)
         VALUES (1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = CURRENT_TIMESTAMP`,
        [SEED_VERSION]
    );
}

const hoursReady = (async () => {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS hour_employee_settings (
            employee_name TEXT PRIMARY KEY COLLATE NOCASE,
            contract_type TEXT NOT NULL DEFAULT 'flex',
            weekly_contract_hours REAL NOT NULL DEFAULT 0,
            opening_bank_hours REAL NOT NULL DEFAULT 0,
            opening_bank_month TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_by TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS hour_contract_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT NOT NULL COLLATE NOCASE,
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            weekly_hours REAL NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_name, effective_from),
            FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name)
                ON UPDATE CASCADE ON DELETE CASCADE
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS hour_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT NOT NULL COLLATE NOCASE,
            adjustment_date TEXT NOT NULL,
            adjustment_type TEXT NOT NULL,
            hours REAL NOT NULL,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name)
                ON UPDATE CASCADE ON DELETE CASCADE
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS hour_seed_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await dbRun('CREATE INDEX IF NOT EXISTS idx_hour_adjustments_date ON hour_adjustments(adjustment_date)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_hour_adjustments_employee ON hour_adjustments(employee_name)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_hour_contract_periods_employee ON hour_contract_periods(employee_name)');
    await ensureRosterEmployees();
    await seedContractData();
})();

async function loadEmployeesWithPeriods() {
    const employees = await dbAll(
        `SELECT
            employee_name AS employeeName,
            contract_type AS contractType,
            weekly_contract_hours AS weeklyContractHours,
            opening_bank_hours AS openingBankHours,
            opening_bank_month AS openingBankMonth,
            is_active AS isActive,
            updated_by AS updatedBy,
            updated_at AS updatedAt
         FROM hour_employee_settings
         ORDER BY is_active DESC, LOWER(employee_name)`
    );

    const periods = await dbAll(
        `SELECT
            id,
            employee_name AS employeeName,
            effective_from AS effectiveFrom,
            effective_to AS effectiveTo,
            weekly_hours AS weeklyHours,
            created_by AS createdBy,
            created_at AS createdAt
         FROM hour_contract_periods
         ORDER BY LOWER(employee_name), date(effective_from)`
    );

    const periodsByEmployee = new Map();
    periods.forEach((period) => {
        const key = employeeKey(period.employeeName);
        if (!periodsByEmployee.has(key)) periodsByEmployee.set(key, []);
        periodsByEmployee.get(key).push(period);
    });

    return { employees, periods, periodsByEmployee };
}

async function loadAnalysis(month) {
    await ensureRosterEmployees();
    const { employees, periodsByEmployee } = await loadEmployeesWithPeriods();
    const activeEmployees = employees.filter((employee) => employee.isActive);

    const earliestOpening = activeEmployees
        .map((employee) => normalizeMonth(employee.openingBankMonth, month))
        .sort()[0] || month;
    const previousMonth = addMonths(month, -1);
    const queryFromMonth = [earliestOpening, previousMonth].sort()[0];
    const queryToMonth = addMonths(month, 1);

    const shifts = await dbAll(
        `SELECT
            roster_date AS rosterDate,
            employee_name AS employeeName,
            location,
            start_time AS startTime,
            end_time AS endTime
         FROM roster_items
         WHERE item_type = 'shift'
           AND employee_name IS NOT NULL
           AND UPPER(TRIM(employee_name)) != 'ALL'
           AND date(roster_date) >= date(?)
           AND date(roster_date) < date(?)`,
        [monthStart(queryFromMonth), monthStart(queryToMonth)]
    ).catch((error) => {
        if (String(error.message).includes('no such table: roster_items')) return [];
        throw error;
    });

    const adjustments = await dbAll(
        `SELECT
            id,
            employee_name AS employeeName,
            adjustment_date AS adjustmentDate,
            adjustment_type AS adjustmentType,
            hours,
            note,
            created_by AS createdBy,
            created_at AS createdAt
         FROM hour_adjustments
         WHERE date(adjustment_date) >= date(?)
           AND date(adjustment_date) < date(?)
         ORDER BY date(adjustment_date) DESC, id DESC`,
        [monthStart(queryFromMonth), monthStart(queryToMonth)]
    );

    const scheduledByEmployeeMonth = new Map();
    const locationsByEmployeeMonth = new Map();

    shifts.forEach((shift) => {
        const shiftMonth = String(shift.rosterDate || '').slice(0, 7);
        const key = keyFor(shift.employeeName, shiftMonth);
        mapAdd(scheduledByEmployeeMonth, key, getShiftHours(shift));
        if (!locationsByEmployeeMonth.has(key)) locationsByEmployeeMonth.set(key, new Set());
        if (shift.location) locationsByEmployeeMonth.get(key).add(shift.location);
    });

    const creditedByEmployeeMonth = new Map();
    const bankByEmployeeMonth = new Map();
    adjustments.forEach((adjustment) => {
        const adjustmentMonth = String(adjustment.adjustmentDate || '').slice(0, 7);
        const key = keyFor(adjustment.employeeName, adjustmentMonth);
        if (adjustment.adjustmentType === 'bank') {
            mapAdd(bankByEmployeeMonth, key, adjustment.hours);
        } else {
            mapAdd(creditedByEmployeeMonth, key, adjustment.hours);
        }
    });

    const resultEmployees = activeEmployees.map((employee) => {
        const selectedKey = keyFor(employee.employeeName, month);
        const previousKey = keyFor(employee.employeeName, previousMonth);
        const scheduledHours = roundHours(scheduledByEmployeeMonth.get(selectedKey) || 0);
        const creditedAdjustment = roundHours(creditedByEmployeeMonth.get(selectedKey) || 0);
        const bankAdjustment = roundHours(bankByEmployeeMonth.get(selectedKey) || 0);
        const creditedHours = roundHours(scheduledHours + creditedAdjustment);
        const previousScheduledHours = roundHours(scheduledByEmployeeMonth.get(previousKey) || 0);
        const weeklyContractHours = getContractHoursForMonth(employee, periodsByEmployee, month);
        const contractType = weeklyContractHours > 0 ? 'contract' : 'flex';
        const monthlyNorm = contractType === 'contract' ? roundHours(weeklyContractHours * 4.33) : null;
        const monthDelta = contractType === 'contract'
            ? roundHours(creditedHours - monthlyNorm + bankAdjustment)
            : null;

        let bankBalance = null;
        if (contractType === 'contract') {
            const openingMonth = normalizeMonth(employee.openingBankMonth, month);
            bankBalance = roundHours(employee.openingBankHours);
            enumerateMonths(openingMonth, month).forEach((bankMonth) => {
                const monthKey = keyFor(employee.employeeName, bankMonth);
                const planned = scheduledByEmployeeMonth.get(monthKey) || 0;
                const credited = creditedByEmployeeMonth.get(monthKey) || 0;
                const bank = bankByEmployeeMonth.get(monthKey) || 0;
                const contractHours = getContractHoursForMonth(employee, periodsByEmployee, bankMonth);
                const norm = contractHours > 0 ? roundHours(contractHours * 4.33) : 0;
                bankBalance = roundHours(bankBalance + planned + credited - norm + bank);
            });
        }

        return {
            employeeName: employee.employeeName,
            contractType,
            weeklyContractHours,
            monthlyNorm,
            scheduledHours,
            creditedAdjustment,
            creditedHours,
            bankAdjustment,
            monthDelta,
            bankBalance,
            previousScheduledHours,
            trendHours: roundHours(scheduledHours - previousScheduledHours),
            locations: [...(locationsByEmployeeMonth.get(selectedKey) || [])].sort(),
            openingBankHours: roundHours(employee.openingBankHours),
            openingBankMonth: normalizeMonth(employee.openingBankMonth, month)
        };
    });

    const flexEmployees = resultEmployees.filter((employee) => employee.contractType === 'flex');
    const contractEmployees = resultEmployees.filter((employee) => employee.contractType === 'contract');
    const flexAverageHours = flexEmployees.length
        ? roundHours(flexEmployees.reduce((sum, employee) => sum + employee.creditedHours, 0) / flexEmployees.length)
        : 0;

    resultEmployees.forEach((employee) => {
        employee.flexDifference = employee.contractType === 'flex'
            ? roundHours(employee.creditedHours - flexAverageHours)
            : null;
    });

    const selectedAdjustments = adjustments.filter(
        (adjustment) => String(adjustment.adjustmentDate || '').slice(0, 7) === month
    );

    return {
        month,
        previousMonth,
        generatedAt: new Date().toISOString(),
        summary: {
            employeeCount: resultEmployees.length,
            contractEmployeeCount: contractEmployees.length,
            flexEmployeeCount: flexEmployees.length,
            totalScheduledHours: roundHours(resultEmployees.reduce((sum, employee) => sum + employee.scheduledHours, 0)),
            totalCreditedHours: roundHours(resultEmployees.reduce((sum, employee) => sum + employee.creditedHours, 0)),
            contractMonthDelta: roundHours(contractEmployees.reduce((sum, employee) => sum + employee.monthDelta, 0)),
            flexAverageHours
        },
        employees: resultEmployees,
        adjustments: selectedAdjustments,
        permissions: { canEdit: false }
    };
}

capturedApp.get('/api/hours/analysis', requireHoursRoles('manager', 'admin'), async (req, res) => {
    try {
        const month = normalizeMonth(req.query.month);
        const analysis = await loadAnalysis(month);
        analysis.permissions.canEdit = req.hoursUser.role === 'admin';
        res.json(analysis);
    } catch (error) {
        sendApiError(res, error);
    }
});

capturedApp.get('/api/hours/employees', requireHoursRoles('manager', 'admin'), async (req, res) => {
    try {
        await ensureRosterEmployees();
        const { employees, periodsByEmployee } = await loadEmployeesWithPeriods();
        res.json({
            employees: employees.map((employee) => ({
                ...employee,
                contractPeriods: periodsByEmployee.get(employeeKey(employee.employeeName)) || []
            })),
            permissions: { canEdit: req.hoursUser.role === 'admin' }
        });
    } catch (error) {
        sendApiError(res, error);
    }
});

capturedApp.put('/api/hours/employees/:employeeName', requireHoursRoles('admin'), async (req, res) => {
    try {
        const employeeName = String(req.params.employeeName || '').trim();
        const contractType = String(req.body.contractType || '').trim();
        const weeklyContractHours = Number(req.body.weeklyContractHours || 0);
        const effectiveFrom = String(req.body.effectiveFrom || '').trim();
        const openingBankHours = Number(req.body.openingBankHours || 0);
        const openingBankMonth = normalizeMonth(req.body.openingBankMonth);
        const isActive = req.body.isActive === false || req.body.isActive === 0 ? 0 : 1;

        if (!employeeName || employeeName.length > 120) {
            res.status(400).json({ message: 'Vul een geldige medewerker in.' });
            return;
        }
        if (!CONTRACT_TYPES.includes(contractType)) {
            res.status(400).json({ message: 'Kies flex of contract.' });
            return;
        }
        if (!Number.isFinite(weeklyContractHours) || weeklyContractHours < 0 || weeklyContractHours > 60) {
            res.status(400).json({ message: 'Contracturen moeten tussen 0 en 60 uur per week liggen.' });
            return;
        }
        if (contractType === 'contract' && (weeklyContractHours <= 0 || !DATE_PATTERN.test(effectiveFrom))) {
            res.status(400).json({ message: 'Vul contracturen en een geldige ingangsdatum in.' });
            return;
        }
        if (!Number.isFinite(openingBankHours) || Math.abs(openingBankHours) > 1000) {
            res.status(400).json({ message: 'De startstand van de urenbank is ongeldig.' });
            return;
        }

        await dbRun(
            `INSERT INTO hour_employee_settings (
                employee_name, contract_type, weekly_contract_hours,
                opening_bank_hours, opening_bank_month, is_active, updated_by, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(employee_name) DO UPDATE SET
                contract_type = excluded.contract_type,
                weekly_contract_hours = excluded.weekly_contract_hours,
                opening_bank_hours = excluded.opening_bank_hours,
                opening_bank_month = excluded.opening_bank_month,
                is_active = excluded.is_active,
                updated_by = excluded.updated_by,
                updated_at = CURRENT_TIMESTAMP`,
            [
                employeeName,
                contractType,
                contractType === 'contract' ? roundHours(weeklyContractHours) : 0,
                roundHours(openingBankHours),
                openingBankMonth,
                isActive,
                req.hoursUser.displayName || req.hoursUser.username
            ]
        );

        if (contractType === 'contract') {
            await dbRun(
                `INSERT INTO hour_contract_periods (
                    employee_name, effective_from, effective_to, weekly_hours, created_by
                 ) VALUES (?, ?, NULL, ?, ?)
                 ON CONFLICT(employee_name, effective_from) DO UPDATE SET
                    weekly_hours = excluded.weekly_hours,
                    effective_to = NULL,
                    created_by = excluded.created_by`,
                [
                    employeeName,
                    effectiveFrom,
                    roundHours(weeklyContractHours),
                    req.hoursUser.displayName || req.hoursUser.username
                ]
            );
        }

        res.json({ message: 'Medewerkerinstellingen opgeslagen.' });
    } catch (error) {
        sendApiError(res, error);
    }
});

capturedApp.post('/api/hours/adjustments', requireHoursRoles('admin'), async (req, res) => {
    try {
        const employeeName = String(req.body.employeeName || '').trim();
        const adjustmentDate = String(req.body.adjustmentDate || '').trim();
        const adjustmentType = String(req.body.adjustmentType || '').trim();
        const hours = Number(req.body.hours);
        const note = String(req.body.note || '').trim().slice(0, 300);

        if (!employeeName || !DATE_PATTERN.test(adjustmentDate)) {
            res.status(400).json({ message: 'Medewerker en datum zijn verplicht.' });
            return;
        }
        if (!ADJUSTMENT_TYPES.includes(adjustmentType)) {
            res.status(400).json({ message: 'Ongeldig correctietype.' });
            return;
        }
        if (!Number.isFinite(hours) || hours === 0 || Math.abs(hours) > 250) {
            res.status(400).json({ message: 'Correctie-uren moeten tussen -250 en 250 liggen en mogen niet nul zijn.' });
            return;
        }

        const employee = await dbGet(
            'SELECT employee_name AS employeeName FROM hour_employee_settings WHERE employee_name = ? COLLATE NOCASE',
            [employeeName]
        );
        if (!employee) {
            res.status(404).json({ message: 'Medewerker niet gevonden.' });
            return;
        }

        const result = await dbRun(
            `INSERT INTO hour_adjustments (
                employee_name, adjustment_date, adjustment_type, hours, note, created_by
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                employee.employeeName,
                adjustmentDate,
                adjustmentType,
                roundHours(hours),
                note,
                req.hoursUser.displayName || req.hoursUser.username
            ]
        );

        res.status(201).json({ message: 'Urencorrectie opgeslagen.', id: result.lastID });
    } catch (error) {
        sendApiError(res, error);
    }
});

capturedApp.delete('/api/hours/adjustments/:id', requireHoursRoles('admin'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ message: 'Ongeldig correctie-ID.' });
            return;
        }
        const result = await dbRun('DELETE FROM hour_adjustments WHERE id = ?', [id]);
        if (!result.changes) {
            res.status(404).json({ message: 'Correctie niet gevonden.' });
            return;
        }
        res.json({ message: 'Correctie verwijderd.' });
    } catch (error) {
        sendApiError(res, error);
    }
});
