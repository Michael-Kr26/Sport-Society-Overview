const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'sport-society.db');

const ARCHIVE_AFTER_DAYS = 7;
const ARCHIVED_PAGE_SIZE = 20;
const SESSION_COOKIE_NAME = 'sso_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_ROLES = ['employee', 'manager', 'admin'];
const ALLOWED_STATUSES = ['Open', 'In behandeling', 'Afgerond', 'Archived'];
const ALLOWED_LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const db = new sqlite3.Database(DB_PATH, (error) => {
    if (error) {
        console.error('Database kon niet worden geopend:', error.message);
        return;
    }

    console.log('Database verbonden:', DB_PATH);
});

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
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
        db.get(sql, params, (error, row) => {
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
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows || []);
        });
    });
}

function dbExec(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isIsoDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
        return false;
    }

    return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function addDaysToIsoDate(dateString, days) {
    const parts = String(dateString || '').split('-').map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return null;
    }

    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function insertFocusWeek(weeks, focusWeekStart) {
    if (!focusWeekStart || weeks.some((week) => week.weekStart === focusWeekStart)) {
        return weeks;
    }

    const weekEnd = addDaysToIsoDate(focusWeekStart, 6);

    if (!weekEnd) {
        return weeks;
    }

    return [
        ...weeks,
        { weekStart: focusWeekStart, weekEnd, weekItemCount: 0 }
    ].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

function parseCookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');

        if (separator === -1) {
            return cookies;
        }

        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();

        if (name) {
            cookies[name] = decodeURIComponent(value);
        }

        return cookies;
    }, {});
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
    const [algorithm, salt, expectedHex] = String(storedHash || '').split('$');

    if (algorithm !== 'scrypt' || !salt || !expectedHex) {
        return false;
    }

    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');

    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function sanitizeUser(user) {
    if (!user) {
        return null;
    }

    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isActive: Boolean(user.isActive),
        createdAt: user.createdAt || null,
        lastLoginAt: user.lastLoginAt || null
    };
}

function validateUserInput({ username, displayName, password, role }) {
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return 'Gebruikersnaam moet 3 tot 32 tekens bevatten en mag alleen letters, cijfers, punten, underscores en streepjes gebruiken.';
    }

    if (!displayName || displayName.length > 80) {
        return 'Vul een geldige weergavenaam in.';
    }

    if (password.length < 8 || password.length > 128) {
        return 'Wachtwoord moet minimaal 8 en maximaal 128 tekens bevatten.';
    }

    if (!ALLOWED_ROLES.includes(role)) {
        return 'Ongeldige rol.';
    }

    return null;
}

async function createUser({ username, displayName, password, role }) {
    const normalized = {
        username: normalizeUsername(username),
        displayName: String(displayName || '').trim(),
        password: String(password || ''),
        role: String(role || '').trim().toLowerCase()
    };
    const validationError = validateUserInput(normalized);

    if (validationError) {
        const error = new Error(validationError);
        error.status = 400;
        throw error;
    }

    try {
        const result = await dbRun(
            `INSERT INTO users (username, display_name, password_hash, role)
             VALUES (?, ?, ?, ?)`,
            [
                normalized.username,
                normalized.displayName,
                hashPassword(normalized.password),
                normalized.role
            ]
        );

        return {
            id: result.lastID,
            username: normalized.username,
            displayName: normalized.displayName,
            role: normalized.role,
            isActive: true
        };
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
            const duplicateError = new Error('Deze gebruikersnaam bestaat al.');
            duplicateError.status = 409;
            throw duplicateError;
        }

        throw error;
    }
}

function setSessionCookie(res, token, expiresAt) {
    res.setHeader('Set-Cookie', [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Expires=${expiresAt.toUTCString()}`
    ].join('; '));
}

function clearSessionCookie(res) {
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    );
}

async function createSession(userId, res) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await dbRun(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES (?, ?, ?)`,
        [userId, hashSessionToken(token), expiresAt.toISOString()]
    );

    setSessionCookie(res, token, expiresAt);
}

async function getAuthenticatedUser(req) {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];

    if (!token) {
        return null;
    }

    const user = await dbGet(
        `SELECT
            users.id,
            users.username,
            users.display_name AS displayName,
            users.role,
            users.is_active AS isActive,
            users.created_at AS createdAt,
            users.last_login_at AS lastLoginAt
         FROM auth_sessions
         INNER JOIN users ON users.id = auth_sessions.user_id
         WHERE auth_sessions.token_hash = ?
           AND datetime(auth_sessions.expires_at) > datetime('now')
           AND users.is_active = 1
         LIMIT 1`,
        [hashSessionToken(token)]
    );

    return sanitizeUser(user);
}

function requireRoles(...roles) {
    return asyncRoute(async (req, res, next) => {
        const user = await getAuthenticatedUser(req);

        if (!user) {
            res.status(401).json({ message: 'Log eerst in.' });
            return;
        }

        if (!roles.includes(user.role)) {
            res.status(403).json({ message: 'Je hebt geen toegang tot deze functie.' });
            return;
        }

        req.user = user;
        next();
    });
}

async function archiveOldCompletedChanges() {
    await dbRun(
        `UPDATE changes
         SET status = 'Archived'
         WHERE status = 'Afgerond'
           AND date(change_date) <= date('now', 'localtime', '-' || ? || ' days')`,
        [ARCHIVE_AFTER_DAYS]
    );
}

async function initializeDatabase() {
    await dbExec(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS auth_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            change_date TEXT NOT NULL,
            reported_date TEXT NOT NULL,
            location TEXT NOT NULL,
            employee_1 TEXT NOT NULL,
            employee_2 TEXT,
            change_type TEXT NOT NULL,
            reason TEXT,
            status TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

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
        );

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
        );

        DELETE FROM auth_sessions
        WHERE datetime(expires_at) <= datetime('now');
    `);
}

app.get('/api/auth/setup-status', asyncRoute(async (req, res) => {
    const row = await dbGet('SELECT COUNT(*) AS userCount FROM users');
    res.json({ needsBootstrap: !row || row.userCount === 0 });
}));

app.post('/api/auth/bootstrap', asyncRoute(async (req, res) => {
    const row = await dbGet('SELECT COUNT(*) AS userCount FROM users');

    if (row && row.userCount > 0) {
        res.status(409).json({ message: 'Het eerste adminaccount is al aangemaakt.' });
        return;
    }

    const user = await createUser({
        username: req.body.username,
        displayName: req.body.displayName,
        password: req.body.password,
        role: 'admin'
    });

    await createSession(user.id, res);
    res.status(201).json({ message: 'Eerste adminaccount aangemaakt.', user });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');

    if (!username || !password) {
        res.status(400).json({ message: 'Vul je gebruikersnaam en wachtwoord in.' });
        return;
    }

    const user = await dbGet(
        `SELECT
            id,
            username,
            display_name AS displayName,
            password_hash AS passwordHash,
            role,
            is_active AS isActive,
            created_at AS createdAt,
            last_login_at AS lastLoginAt
         FROM users
         WHERE username = ? COLLATE NOCASE
         LIMIT 1`,
        [username]
    );

    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ message: 'Onjuiste gebruikersnaam of wachtwoord.' });
        return;
    }

    await dbRun('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    await createSession(user.id, res);

    res.json({
        message: 'Ingelogd.',
        user: sanitizeUser({ ...user, lastLoginAt: new Date().toISOString() })
    });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];

    if (token) {
        await dbRun('DELETE FROM auth_sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    }

    clearSessionCookie(res);
    res.json({ message: 'Uitgelogd.' });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
    const user = await getAuthenticatedUser(req);

    res.json({
        authenticated: Boolean(user),
        role: user ? user.role : 'guest',
        user
    });
}));

app.get('/api/users', requireRoles('admin'), asyncRoute(async (req, res) => {
    const users = await dbAll(
        `SELECT
            id,
            username,
            display_name AS displayName,
            role,
            is_active AS isActive,
            created_at AS createdAt,
            last_login_at AS lastLoginAt
         FROM users
         ORDER BY
            CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
            LOWER(display_name) ASC`
    );

    res.json(users.map(sanitizeUser));
}));

app.post('/api/users', requireRoles('admin'), asyncRoute(async (req, res) => {
    const user = await createUser(req.body);
    res.status(201).json({ message: 'Account aangemaakt.', user });
}));

app.get('/cf.html', asyncRoute(async (req, res) => {
    const user = await getAuthenticatedUser(req);

    if (!user || user.role !== 'admin') {
        res.redirect('/login.html?next=cf.html');
        return;
    }

    res.sendFile(path.join(ROOT_DIR, 'cf.html'));
}));

app.get('/create.html', asyncRoute(async (req, res) => {
    const row = await dbGet('SELECT COUNT(*) AS userCount FROM users');

    if (!row || row.userCount === 0) {
        res.sendFile(path.join(ROOT_DIR, 'create.html'));
        return;
    }

    const user = await getAuthenticatedUser(req);

    if (!user || user.role !== 'admin') {
        res.redirect('/login.html?next=create.html');
        return;
    }

    res.sendFile(path.join(ROOT_DIR, 'create.html'));
}));

app.use('/data', (req, res) => {
    res.status(403).json({ message: 'Databestanden zijn niet publiek toegankelijk.' });
});

app.post('/api/changes', requireRoles('admin'), asyncRoute(async (req, res) => {
    const { date, reportedDate, location, employee, employee2, type, reason, status } = req.body;

    if (!date || !reportedDate || !location || !employee || !type || !status) {
        res.status(400).json({ message: 'Niet alle verplichte velden zijn ingevuld.' });
        return;
    }

    if (!ALLOWED_STATUSES.includes(status) || !ALLOWED_LOCATIONS.includes(location)) {
        res.status(400).json({ message: 'Ongeldige status of locatie.' });
        return;
    }

    const result = await dbRun(
        `INSERT INTO changes (
            change_date, reported_date, location, employee_1, employee_2,
            change_type, reason, status, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            date,
            reportedDate,
            location,
            String(employee).trim(),
            String(employee2 || '').trim(),
            type,
            String(reason || '').trim(),
            status,
            req.user.displayName
        ]
    );

    res.status(201).json({ message: 'Wijziging opgeslagen.', id: result.lastID });
}));

app.get('/api/changes', requireRoles('manager', 'admin'), asyncRoute(async (req, res) => {
    await archiveOldCompletedChanges();

    const { name, focusWeekStart, month, location, type, status } = req.query;
    const requestedPage = parsePositiveInteger(req.query.page, 1);
    const weekStartExpression = `date(change_date, '-' || ((CAST(strftime('%w', change_date) AS INTEGER) + 6) % 7) || ' days')`;
    let whereQuery = 'FROM changes WHERE 1 = 1';
    const values = [];

    if (name) {
        whereQuery += ' AND (LOWER(employee_1) LIKE LOWER(?) OR LOWER(employee_2) LIKE LOWER(?))';
        values.push(`%${name}%`, `%${name}%`);
    }

    if (month) {
        whereQuery += ' AND substr(change_date, 6, 2) = ?';
        values.push(month);
    }

    if (location) {
        whereQuery += ' AND location = ?';
        values.push(location);
    }

    if (type) {
        whereQuery += ' AND change_type = ?';
        values.push(type);
    }

    if (status) {
        whereQuery += ' AND status = ?';
        values.push(status);
    } else {
        whereQuery += " AND status != 'Archived'";
    }

    const selectFields = `SELECT
        id,
        change_date AS date,
        reported_date AS reportedDate,
        location,
        employee_1 AS employee,
        employee_2 AS employee2,
        change_type AS type,
        reason,
        status,
        created_by AS createdBy,
        created_at AS createdAt`;

    if (status === 'Archived') {
        const countRow = await dbGet(`SELECT COUNT(*) AS totalItems ${whereQuery}`, values);
        const totalItems = countRow ? countRow.totalItems : 0;
        const totalPages = Math.max(1, Math.ceil(totalItems / ARCHIVED_PAGE_SIZE));
        const page = Math.min(requestedPage, totalPages);
        const offset = (page - 1) * ARCHIVED_PAGE_SIZE;
        const items = totalItems === 0 ? [] : await dbAll(
            `${selectFields} ${whereQuery}
             ORDER BY change_date DESC, created_at DESC, id DESC
             LIMIT ? OFFSET ?`,
            [...values, ARCHIVED_PAGE_SIZE, offset]
        );

        res.json({
            items,
            pagination: {
                mode: 'archive',
                page,
                totalPages,
                totalItems,
                pageSize: ARCHIVED_PAGE_SIZE,
                weekStart: null,
                weekEnd: null
            }
        });
        return;
    }

    const weekRows = await dbAll(
        `SELECT weekStart, date(weekStart, '+6 days') AS weekEnd, COUNT(*) AS weekItemCount
         FROM (SELECT ${weekStartExpression} AS weekStart ${whereQuery})
         GROUP BY weekStart
         ORDER BY weekStart DESC`,
        values
    );
    const weeks = insertFocusWeek(weekRows, focusWeekStart);

    if (weeks.length === 0) {
        res.json({
            items: [],
            pagination: {
                mode: 'week',
                page: 1,
                totalPages: 1,
                totalWeeks: 0,
                totalItems: 0,
                weekStart: null,
                weekEnd: null
            }
        });
        return;
    }

    const totalPages = weeks.length;
    const focusWeekIndex = focusWeekStart
        ? weeks.findIndex((week) => week.weekStart === focusWeekStart)
        : -1;
    const page = focusWeekIndex >= 0 ? focusWeekIndex + 1 : Math.min(requestedPage, totalPages);
    const selectedWeek = weeks[page - 1];
    const items = await dbAll(
        `${selectFields} ${whereQuery}
         AND ${weekStartExpression} = ?
         ORDER BY change_date DESC, created_at DESC, id DESC`,
        [...values, selectedWeek.weekStart]
    );

    res.json({
        items,
        pagination: {
            mode: 'week',
            page,
            totalPages,
            totalWeeks: totalPages,
            totalItems: selectedWeek.weekItemCount,
            weekStart: selectedWeek.weekStart,
            weekEnd: selectedWeek.weekEnd
        }
    });
}));

app.get('/api/changes/latest', requireRoles('manager', 'admin'), asyncRoute(async (req, res) => {
    await archiveOldCompletedChanges();
    const change = await dbGet(
        `SELECT
            id,
            change_date AS date,
            reported_date AS reportedDate,
            location,
            employee_1 AS employee,
            employee_2 AS employee2,
            change_type AS type,
            reason,
            status,
            created_by AS createdBy,
            created_at AS createdAt
         FROM changes
         WHERE status != 'Archived'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
    );

    if (!change) {
        res.status(404).json({ message: 'Geen wijzigingen gevonden.' });
        return;
    }

    res.json(change);
}));

app.patch('/api/changes/:id/status', requireRoles('admin'), asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body.status;

    if (!Number.isInteger(id) || id <= 0 || !ALLOWED_STATUSES.includes(status)) {
        res.status(400).json({ message: 'Ongeldig wijziging-ID of status.' });
        return;
    }

    const result = await dbRun('UPDATE changes SET status = ? WHERE id = ?', [status, id]);

    if (result.changes === 0) {
        res.status(404).json({ message: 'Wijziging niet gevonden.' });
        return;
    }

    res.json({ message: 'Status bijgewerkt.', id, status });
}));

app.patch('/api/changes/:id', requireRoles('admin'), asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const date = String(req.body.date || '').trim();
    const location = String(req.body.location || '').trim();
    const employee = String(req.body.employee || '').trim();
    const employee2 = String(req.body.employee2 || '').trim();
    const reason = String(req.body.reason || '').trim();

    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ message: 'Ongeldig wijziging-ID.' });
        return;
    }

    if (!date || !location || !employee || !isIsoDateString(date) || !ALLOWED_LOCATIONS.includes(location)) {
        res.status(400).json({ message: 'Datum, locatie en medewerker 1 moeten geldig zijn.' });
        return;
    }

    const result = await dbRun(
        `UPDATE changes
         SET change_date = ?, location = ?, employee_1 = ?, employee_2 = ?, reason = ?
         WHERE id = ?`,
        [date, location, employee, employee2, reason, id]
    );

    if (result.changes === 0) {
        res.status(404).json({ message: 'Wijziging niet gevonden.' });
        return;
    }

    res.json({ message: 'Wijziging bijgewerkt.', id });
}));

app.delete('/api/changes/:id', requireRoles('admin'), asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ message: 'Ongeldig wijziging-ID.' });
        return;
    }

    const result = await dbRun('DELETE FROM changes WHERE id = ?', [id]);

    if (result.changes === 0) {
        res.status(404).json({ message: 'Wijziging niet gevonden.' });
        return;
    }

    res.json({ message: 'Wijziging verwijderd.', id });
}));

app.get('/api/roster', asyncRoute(async (req, res) => {
    const { name, location, type, status, from, to } = req.query;
    let query = `SELECT
        id,
        import_id AS importId,
        roster_date AS rosterDate,
        day_name AS dayName,
        employee_name AS employeeName,
        source_slot_employee AS sourceSlotEmployee,
        item_type AS itemType,
        location,
        start_time AS startTime,
        end_time AS endTime,
        status,
        note,
        source_sheet AS sourceSheet,
        source_cell AS sourceCell,
        source_hash AS sourceHash,
        created_at AS createdAt
        FROM roster_items
        WHERE 1 = 1`;
    const values = [];

    if (name) {
        query += " AND (LOWER(employee_name) LIKE LOWER(?) OR employee_name = 'ALL')";
        values.push(`%${name}%`);
    }

    if (location) {
        query += ' AND location = ?';
        values.push(location);
    }

    if (type) {
        query += ' AND item_type = ?';
        values.push(type);
    }

    if (status) {
        query += ' AND status = ?';
        values.push(status);
    }

    if (from) {
        query += ' AND date(roster_date) >= date(?)';
        values.push(from);
    }

    if (to) {
        query += ' AND date(roster_date) <= date(?)';
        values.push(to);
    }

    query += ` ORDER BY
        CASE WHEN date(roster_date) >= date('now') THEN 0 ELSE 1 END,
        CASE WHEN date(roster_date) >= date('now') THEN date(roster_date) END ASC,
        CASE WHEN date(roster_date) < date('now') THEN date(roster_date) END DESC,
        LOWER(COALESCE(location, '')) ASC,
        start_time ASC,
        employee_name ASC
        LIMIT 10000`;

    res.json(await dbAll(query, values));
}));

app.get('/api/roster-preview', asyncRoute(async (req, res) => {
    const previewPath = path.join(DATA_DIR, 'imports', 'roster-preview.json');

    if (!fs.existsSync(previewPath)) {
        res.status(404).json({
            message: 'Nog geen rooster-preview gevonden. Draai eerst npm run import:roster.'
        });
        return;
    }

    const content = await fs.promises.readFile(previewPath, 'utf8');
    res.json(JSON.parse(content));
}));

app.use(express.static(ROOT_DIR));

app.use((error, req, res, next) => {
    console.error(error);

    if (res.headersSent) {
        next(error);
        return;
    }

    res.status(error.status || 500).json({
        message: error.status ? error.message : 'Er ging iets mis op de server.'
    });
});

initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Sport Society Overview draait op http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Database kon niet worden voorbereid:', error);
        process.exitCode = 1;
    });
