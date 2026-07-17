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
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de urenlinker.');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'sport-society.db'));
db.configure('busyTimeout', 5000);
const COOKIE = 'sso_session';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

async function waitForTable(table, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = await get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (row) return true;
        await sleep(50);
    }
    return false;
}

async function ensureDeclaredHoursColumn() {
    const exists = await waitForTable('roster_items', 1);
    if (!exists) return false;
    const columns = await all('PRAGMA table_info(roster_items)');
    if (!columns.some((column) => column.name === 'declared_hours')) {
        await run('ALTER TABLE roster_items ADD COLUMN declared_hours REAL');
    }
    return true;
}

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

function shiftHours(startTime, endTime) {
    const parse = (value) => {
        const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const start = parse(startTime);
    const end = parse(endTime);
    if (start === null || end === null) return 0;
    return round(((end <= start ? end + 1440 : end) - start) / 60);
}

function collectDeclaredGroups(rows) {
    const groups = new Map();
    let conflictingDeclaredDays = 0;

    for (const row of rows) {
        const rosterDate = String(row.rosterDate || '').slice(0, 10);
        const sourceEmployee = String(row.sourceSlotEmployee || row.employeeName || '').trim();
        if (!rosterDate || !sourceEmployee) continue;
        const key = `${rosterDate}|${employeeKey(sourceEmployee)}`;
        if (!groups.has(key)) {
            groups.set(key, {
                rosterDate,
                rowMonth: rosterDate.slice(0, 7),
                sourceEmployee,
                declaredHours: null,
                shifts: []
            });
        }
        const group = groups.get(key);
        const declared = row.declaredHours === null || row.declaredHours === undefined
            ? null
            : Number(row.declaredHours);
        if (Number.isFinite(declared)) {
            if (group.declaredHours !== null && Math.abs(group.declaredHours - declared) > 0.01) {
                conflictingDeclaredDays += 1;
            }
            if (group.declaredHours === null) group.declaredHours = round(declared);
        }
        group.shifts.push({
            employeeName: String(row.employeeName || sourceEmployee).trim(),
            rawHours: shiftHours(row.startTime, row.endTime)
        });
    }

    return { groups: [...groups.values()], conflictingDeclaredDays };
}

function addEmployeeCorrection(employees, employeeName, month, correction, linkedShifts, rosterDate) {
    const key = employeeKey(employeeName);
    if (!key || !MONTH_RE.test(month)) return;
    if (!employees.has(key)) employees.set(key, { employeeName, months: {} });
    const employee = employees.get(key);
    const current = employee.months[month] || {
        correction: 0,
        linkedShifts: 0,
        linkedDays: 0,
        _dates: new Set()
    };
    current.correction = round(current.correction + correction);
    current.linkedShifts += linkedShifts;
    if (!current._dates.has(rosterDate)) {
        current._dates.add(rosterDate);
        current.linkedDays += 1;
    }
    employee.months[month] = current;
}

function correctionsByEmployee(rows) {
    const { groups, conflictingDeclaredDays } = collectDeclaredGroups(rows);
    const employees = new Map();
    let linkedDays = 0;

    for (const group of groups) {
        if (group.declaredHours === null || !group.shifts.length) continue;
        linkedDays += 1;
        const actualEmployees = new Map();
        for (const shift of group.shifts) {
            const key = employeeKey(shift.employeeName);
            if (!key) continue;
            const current = actualEmployees.get(key) || {
                employeeName: shift.employeeName,
                rawHours: 0,
                linkedShifts: 0
            };
            current.rawHours = round(current.rawHours + shift.rawHours);
            current.linkedShifts += 1;
            actualEmployees.set(key, current);
        }

        const allocations = [...actualEmployees.values()];
        if (!allocations.length) continue;
        const rawTotal = round(allocations.reduce((sum, item) => sum + item.rawHours, 0));
        const totalCorrection = round(group.declaredHours - rawTotal);
        let allocatedCorrection = 0;

        allocations.forEach((item, index) => {
            const isLast = index === allocations.length - 1;
            const share = isLast
                ? round(totalCorrection - allocatedCorrection)
                : round(rawTotal > 0
                    ? totalCorrection * (item.rawHours / rawTotal)
                    : totalCorrection / allocations.length);
            allocatedCorrection = round(allocatedCorrection + share);
            addEmployeeCorrection(
                employees,
                item.employeeName,
                group.rowMonth,
                share,
                item.linkedShifts,
                group.rosterDate
            );
        });
    }

    const result = [...employees.values()].map((employee) => ({
        ...employee,
        months: Object.fromEntries(Object.entries(employee.months).map(([month, values]) => [month, {
            correction: round(values.correction),
            linkedShifts: values.linkedShifts,
            linkedDays: values.linkedDays
        }]))
    }));

    return { employees: result, linkedDays, conflictingDeclaredDays };
}

app.get('/api/hours/declared-corrections', async (req, res) => {
    try {
        const user = await authenticatedUser(req);
        if (!user) return res.status(401).json({ message: 'Log eerst in om de gekoppelde uren te bekijken.' });
        if (!['manager', 'admin'].includes(user.role)) return res.status(403).json({ message: 'Je hebt geen toegang tot deze uren.' });
        const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
        if (!await ensureDeclaredHoursColumn()) return res.json({ month, employees: [] });

        const rows = await all(`SELECT employee_name AS employeeName,
            source_slot_employee AS sourceSlotEmployee, roster_date AS rosterDate,
            start_time AS startTime, end_time AS endTime, declared_hours AS declaredHours
            FROM roster_items
            WHERE item_type='shift'
              AND date(roster_date) < date(?, '+1 month')
            ORDER BY date(roster_date), LOWER(COALESCE(source_slot_employee, employee_name)), start_time`,
        [`${month}-01`]);
        const result = correctionsByEmployee(rows);
        res.json({
            month,
            source: 'Excel-kolom Uren, één dagtotaal per medewerkerskolom',
            employees: result.employees,
            diagnostics: {
                linkedDays: result.linkedDays,
                conflictingDeclaredDays: result.conflictingDeclaredDays
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'De gekoppelde roosteruren konden niet worden berekend.' });
    }
});

ensureDeclaredHoursColumn().catch((error) => console.warn('Kolom declared_hours kon nog niet worden voorbereid.', error.message));
