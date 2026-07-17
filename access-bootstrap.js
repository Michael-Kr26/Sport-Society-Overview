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
require('./roster-sync-bootstrap');
require.cache[expressPath].exports = express;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan de toegangslaag.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const COOKIE = 'sso_session';
const ROLES = ['employee', 'manager', 'admin'];
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const ROLE_LEVEL = { guest: 0, employee: 1, manager: 2, admin: 3 };
const PAGE_ACCESS = {
    'staffing.html': 'manager',
    'staffing-standards.html': 'manager',
    'cml.html': 'manager',
    'hours.html': 'manager',
    'employee-settings.html': 'admin',
    'cf.html': 'admin',
    'dashboard.html': 'admin',
    'create.html': 'admin'
};
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
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForTable(table, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const row = await get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (row) return;
        await sleep(50);
    }
    throw new Error(`Databasetabel ${table} is niet beschikbaar.`);
}

async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

const ready = (async () => {
    await waitForTable('users');
    await ensureColumn('users', 'location', 'TEXT');
})();

function cookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((result, part) => {
        const index = part.indexOf('=');
        if (index > -1) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        return result;
    }, {});
}
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const passwordHash = (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const normalizeLocation = (value) => LOCATIONS.includes(String(value || '').trim()) ? String(value).trim() : null;

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        location: user.location || null,
        isActive: Boolean(user.isActive),
        createdAt: user.createdAt || null,
        lastLoginAt: user.lastLoginAt || null
    };
}

async function authenticatedUser(req) {
    await ready;
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const user = await get(
        `SELECT users.id, users.username, users.display_name AS displayName, users.role,
                users.location, users.is_active AS isActive, users.created_at AS createdAt,
                users.last_login_at AS lastLoginAt
         FROM auth_sessions JOIN users ON users.id=auth_sessions.user_id
         WHERE auth_sessions.token_hash=? AND datetime(auth_sessions.expires_at)>datetime('now')
           AND users.is_active=1 LIMIT 1`,
        [tokenHash(token)]
    );
    return publicUser(user);
}

function requireAdmin(handler) {
    return async (req, res) => {
        try {
            const user = await authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in.' });
            if (user.role !== 'admin') return res.status(403).json({ message: 'Alleen een admin heeft toegang.' });
            await handler(req, res, user);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.status(error.status || 500).json({ message: error.message || 'De aanvraag is mislukt.' });
        }
    };
}

function validateUser({ username, displayName, password, role, location }, passwordRequired) {
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return 'Gebruikersnaam moet 3 tot 32 geldige tekens bevatten.';
    if (!displayName || displayName.length > 80) return 'Vul een geldige weergavenaam in.';
    if (!ROLES.includes(role)) return 'Kies een geldige rol.';
    if (passwordRequired && (password.length < 8 || password.length > 128)) return 'Wachtwoord moet minimaal 8 en maximaal 128 tekens bevatten.';
    if (password && (password.length < 8 || password.length > 128)) return 'Wachtwoord moet minimaal 8 en maximaal 128 tekens bevatten.';
    if (role === 'manager' && !location) return 'Koppel een manager aan een vestiging.';
    return null;
}

app.get('/api/access/me', async (req, res) => {
    try {
        const user = await authenticatedUser(req);
        res.json({ authenticated: Boolean(user), role: user?.role || 'guest', user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Profiel kon niet worden geladen.' });
    }
});

app.get('/api/access/users', requireAdmin(async (req, res) => {
    const users = await all(
        `SELECT id, username, display_name AS displayName, role, location,
                is_active AS isActive, created_at AS createdAt, last_login_at AS lastLoginAt
         FROM users ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, LOWER(display_name)`
    );
    res.json({ users: users.map(publicUser), locations: LOCATIONS });
}));

app.post('/api/access/users', requireAdmin(async (req, res) => {
    const input = {
        username: normalizeUsername(req.body.username),
        displayName: String(req.body.displayName || '').trim(),
        password: String(req.body.password || ''),
        role: String(req.body.role || '').trim().toLowerCase(),
        location: normalizeLocation(req.body.location)
    };
    const validation = validateUser(input, true);
    if (validation) return res.status(400).json({ message: validation });
    try {
        const result = await run(
            `INSERT INTO users (username, display_name, password_hash, role, location)
             VALUES (?, ?, ?, ?, ?)`,
            [input.username, input.displayName, passwordHash(input.password), input.role, input.role === 'admin' ? null : input.location]
        );
        res.status(201).json({ message: 'Account aangemaakt.', user: publicUser({ ...input, id: result.lastID, isActive: 1 }) });
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) return res.status(409).json({ message: 'Deze gebruikersnaam bestaat al.' });
        throw error;
    }
}));

app.patch('/api/access/users/:id', requireAdmin(async (req, res, currentUser) => {
    const id = Number(req.params.id);
    const existing = Number.isInteger(id) ? await get(
        `SELECT id, username, display_name AS displayName, role, location, is_active AS isActive
         FROM users WHERE id=?`, [id]
    ) : null;
    if (!existing) return res.status(404).json({ message: 'Account niet gevonden.' });

    const input = {
        username: existing.username,
        displayName: String(req.body.displayName ?? existing.displayName).trim(),
        password: String(req.body.password || ''),
        role: String(req.body.role ?? existing.role).trim().toLowerCase(),
        location: normalizeLocation(req.body.location),
        isActive: req.body.isActive === false || req.body.isActive === 0 ? 0 : 1
    };
    const validation = validateUser(input, false);
    if (validation) return res.status(400).json({ message: validation });
    if (currentUser.id === id && (!input.isActive || input.role !== 'admin')) {
        return res.status(400).json({ message: 'Je kunt je eigen adminaccount niet deactiveren of verlagen.' });
    }

    const fields = ['display_name=?', 'role=?', 'location=?', 'is_active=?'];
    const values = [input.displayName, input.role, input.role === 'admin' ? null : input.location, input.isActive];
    if (input.password) {
        fields.push('password_hash=?');
        values.push(passwordHash(input.password));
    }
    values.push(id);
    await run(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, values);
    if (!input.isActive) await run('DELETE FROM auth_sessions WHERE user_id=?', [id]);
    res.json({ message: 'Account bijgewerkt.' });
}));

app.get('/api/access/staffing-standards', async (req, res) => {
    try {
        const user = await authenticatedUser(req);
        if (!user) return res.status(401).json({ message: 'Log eerst in om de bezettingsstandaarden te bekijken.' });
        if (!['manager', 'admin'].includes(user.role)) return res.status(403).json({ message: 'Je hebt geen toegang tot de bezettingsstandaarden.' });
        await waitForTable('staffing_settings');
        const row = await get(`SELECT settings_json AS settingsJson, updated_by AS updatedBy, updated_at AS updatedAt FROM staffing_settings WHERE id=1`);
        if (!row) return res.status(404).json({ message: 'Bezettingsstandaarden zijn nog niet ingesteld.' });
        const standards = JSON.parse(row.settingsJson);
        const allowedLocations = user.role === 'admin' ? LOCATIONS : [user.location].filter(Boolean);
        if (!allowedLocations.length) {
            return res.status(409).json({ message: 'Dit managerprofiel heeft nog geen vestiging. Laat een admin de vestiging koppelen via Accounts.' });
        }
        if (user.role === 'manager') {
            standards.locations = Object.fromEntries(allowedLocations.map((location) => [location, standards.locations[location]]));
        }
        res.json({
            standards,
            permissions: { canEdit: user.role === 'admin', allowedLocations },
            profile: { role: user.role, location: user.location || null },
            updatedBy: row.updatedBy || null,
            updatedAt: row.updatedAt || null
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Bezettingsstandaarden konden niet worden geladen.' });
    }
});

async function pageAccessMiddleware(req, res, next) {
    const page = String(req.path || '').split('/').pop();
    const minimumRole = PAGE_ACCESS[page];
    if (!minimumRole) return next();
    try {
        await ready;
        if (page === 'create.html') {
            const count = await get('SELECT COUNT(*) AS count FROM users');
            if (!count?.count) return next();
        }
        const user = await authenticatedUser(req);
        if (!user) return res.redirect(`/login.html?next=${encodeURIComponent(page)}`);
        if ((ROLE_LEVEL[user.role] || 0) < ROLE_LEVEL[minimumRole]) return res.redirect('/index.html');
        next();
    } catch (error) {
        next(error);
    }
}

app.use(pageAccessMiddleware);
const router = app.router || app._router;
if (router?.stack?.length) {
    const layer = router.stack.pop();
    const staticIndex = router.stack.findIndex((item) => item.name === 'serveStatic');
    router.stack.splice(staticIndex >= 0 ? staticIndex : 0, 0, layer);
}
