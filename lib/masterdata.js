'use strict';

const SCHEMA_VERSION = 1;
const PLANNING_BASELINE = '2026-09-01';
const CANONICAL_NAMES_RELIABLE_FROM = '2026-06-01';

const LOCATIONS = Object.freeze([
    { code: 'AVE', name: 'Achterveld', sortOrder: 1 },
    { code: 'BVE', name: 'Barneveld', sortOrder: 2 },
    { code: 'VHU', name: 'Voorthuizen', sortOrder: 3 },
    { code: 'WEK', name: 'Wekerom', sortOrder: 4 },
    { code: 'HAR', name: 'Harskamp', sortOrder: 5 }
]);

const LEGACY_EMPLOYEE_ALIASES = Object.freeze([
    { aliasName: 'Lucas Veenendaal', canonicalName: 'Lucas V' },
    { aliasName: 'Lucas Leeuwis', canonicalName: 'Lucas L' }
]);

const ACCESS_SCOPE_SEEDS = Object.freeze([
    { principalName: 'Lucas V', targetRole: 'manager', locationCode: 'BVE' },
    { principalName: 'Leroy', targetRole: 'manager', locationCode: 'AVE' },
    { principalName: 'Leon', targetRole: 'manager', locationCode: 'VHU' },
    { principalName: 'Dysianne', targetRole: 'manager', locationCode: 'HAR' },
    { principalName: 'Jamie', targetRole: 'manager', locationCode: 'WEK' },
    { principalName: 'Michael', targetRole: 'admin', locationCode: null },
    { principalName: 'Chico', targetRole: 'admin', locationCode: null }
]);

function normalizeIdentity(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('nl-NL');
}

function canonicalEmployeeName(value) {
    const normalized = normalizeIdentity(value);
    const alias = LEGACY_EMPLOYEE_ALIASES.find((item) => normalizeIdentity(item.aliasName) === normalized);
    return alias ? alias.canonicalName : String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
}

function exec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (error) => error ? reject(error) : resolve());
    });
}

async function tableExists(db, tableName) {
    return Boolean(await get(db, "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [tableName]));
}

async function ensureMasterdataSchema(db) {
    await exec(db, `
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

        CREATE TABLE IF NOT EXISTS masterdata_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            planning_baseline TEXT NOT NULL,
            canonical_names_reliable_from TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            archived_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS employee_code_sequence (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            next_value INTEGER NOT NULL CHECK (next_value >= 1)
        );

        CREATE TABLE IF NOT EXISTS legacy_employee_aliases (
            alias_name TEXT PRIMARY KEY COLLATE NOCASE,
            canonical_name TEXT NOT NULL,
            canonical_from TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS employment_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            employment_type TEXT NOT NULL DEFAULT 'unknown' CHECK (employment_type IN ('contract', 'flex', 'unknown')),
            starts_on TEXT,
            ends_on TEXT,
            known_from TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CHECK (starts_on IS NULL OR ends_on IS NULL OR date(ends_on) >= date(starts_on))
        );

        CREATE TABLE IF NOT EXISTS contract_terms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employment_period_id INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            weekly_minutes INTEGER NOT NULL CHECK (weekly_minutes >= 0),
            note TEXT,
            created_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employment_period_id) REFERENCES employment_periods(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (employment_period_id, effective_from),
            CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from))
        );

        CREATE TABLE IF NOT EXISTS employee_location_eligibility (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
            can_be_scheduled INTEGER NOT NULL DEFAULT 1 CHECK (can_be_scheduled IN (0, 1)),
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
            UNIQUE (employee_id, location_id, effective_from),
            CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from))
        );

        CREATE TABLE IF NOT EXISTS user_employee_links (
            user_id INTEGER PRIMARY KEY,
            employee_id INTEGER NOT NULL UNIQUE,
            linked_by_user_id INTEGER,
            linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (linked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS user_location_scopes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            can_edit_roster INTEGER NOT NULL DEFAULT 1 CHECK (can_edit_roster IN (0, 1)),
            can_publish_roster INTEGER NOT NULL DEFAULT 0 CHECK (can_publish_roster IN (0, 1)),
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
            UNIQUE (user_id, location_id, effective_from),
            CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from))
        );

        CREATE TABLE IF NOT EXISTS masterdata_access_seeds (
            principal_name TEXT PRIMARY KEY COLLATE NOCASE,
            target_role TEXT NOT NULL CHECK (target_role IN ('manager', 'admin')),
            location_code TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (location_code) REFERENCES locations(code) ON UPDATE CASCADE ON DELETE RESTRICT,
            CHECK ((target_role = 'manager' AND location_code IS NOT NULL) OR (target_role = 'admin' AND location_code IS NULL))
        );

        CREATE INDEX IF NOT EXISTS idx_employment_periods_employee ON employment_periods(employee_id);
        CREATE INDEX IF NOT EXISTS idx_contract_terms_period ON contract_terms(employment_period_id, effective_from);
        CREATE INDEX IF NOT EXISTS idx_employee_location_eligibility_employee ON employee_location_eligibility(employee_id, effective_from);
        CREATE INDEX IF NOT EXISTS idx_employee_location_eligibility_location ON employee_location_eligibility(location_id, effective_from);
        CREATE INDEX IF NOT EXISTS idx_user_location_scopes_user ON user_location_scopes(user_id, effective_from);
        CREATE INDEX IF NOT EXISTS idx_user_location_scopes_location ON user_location_scopes(location_id, effective_from);
    `);

    await run(db, `INSERT INTO masterdata_meta
        (id, schema_version, planning_baseline, canonical_names_reliable_from, updated_at)
        VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,
            planning_baseline=excluded.planning_baseline,
            canonical_names_reliable_from=excluded.canonical_names_reliable_from,
            updated_at=CURRENT_TIMESTAMP`,
    [SCHEMA_VERSION, PLANNING_BASELINE, CANONICAL_NAMES_RELIABLE_FROM]);

    await run(db, `INSERT INTO employee_code_sequence (id, next_value) VALUES (1, 1)
        ON CONFLICT(id) DO NOTHING`);
}

async function seedStaticMasterdata(db) {
    for (const location of LOCATIONS) {
        await run(db, `INSERT INTO locations (code, name, timezone, is_active, sort_order)
            VALUES (?, ?, 'Europe/Amsterdam', 1, ?)
            ON CONFLICT(code) DO UPDATE SET name=excluded.name, timezone=excluded.timezone,
                is_active=1, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
        [location.code, location.name, location.sortOrder]);
    }

    for (const alias of LEGACY_EMPLOYEE_ALIASES) {
        await run(db, `INSERT INTO legacy_employee_aliases
            (alias_name, canonical_name, canonical_from, note)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(alias_name) DO UPDATE SET canonical_name=excluded.canonical_name,
                canonical_from=excluded.canonical_from, note=excluded.note`,
        [alias.aliasName, alias.canonicalName, CANONICAL_NAMES_RELIABLE_FROM,
            'Historische alias; de roostertabellen gebruiken vanaf juni 2026 de canonieke naam.']);
    }

    for (const seed of ACCESS_SCOPE_SEEDS) {
        await run(db, `INSERT INTO masterdata_access_seeds
            (principal_name, target_role, location_code, note)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(principal_name) DO UPDATE SET target_role=excluded.target_role,
                location_code=excluded.location_code, note=excluded.note`,
        [seed.principalName, seed.targetRole, seed.locationCode,
            seed.targetRole === 'manager'
                ? 'Manager mag organisatiebreed rooster bekijken; edit-scope is beperkt tot deze vestiging.'
                : 'Admin heeft organisatiebrede beheerrechten.']);
    }
}

async function applyKnownAccessScopes(db) {
    const result = { applied: [], unresolved: [], roleMismatches: [] };
    if (!await tableExists(db, 'users')) {
        result.unresolved = ACCESS_SCOPE_SEEDS.map((seed) => ({ ...seed, reason: 'users-tabel bestaat nog niet' }));
        return result;
    }

    const users = await all(db, `SELECT id, username, display_name AS displayName, role, is_active AS isActive
        FROM users WHERE is_active = 1`);
    const byIdentity = new Map();
    for (const user of users) {
        for (const identity of [user.displayName, user.username]) {
            const key = normalizeIdentity(identity);
            if (key && !byIdentity.has(key)) byIdentity.set(key, user);
        }
    }

    for (const seed of ACCESS_SCOPE_SEEDS) {
        const user = byIdentity.get(normalizeIdentity(seed.principalName));
        if (!user) {
            result.unresolved.push({ ...seed, reason: 'geen exact bestaand account gevonden' });
            continue;
        }
        if (user.role !== seed.targetRole) {
            result.roleMismatches.push({
                principalName: seed.principalName,
                userId: user.id,
                currentRole: user.role,
                targetRole: seed.targetRole,
                locationCode: seed.locationCode
            });
            continue;
        }
        if (seed.targetRole === 'admin') {
            result.applied.push({ principalName: seed.principalName, userId: user.id, role: user.role, locationCode: null });
            continue;
        }
        const location = await get(db, 'SELECT id, code FROM locations WHERE code=? COLLATE NOCASE', [seed.locationCode]);
        if (!location) {
            result.unresolved.push({ ...seed, reason: 'locatiecode ontbreekt' });
            continue;
        }
        await run(db, `INSERT INTO user_location_scopes
            (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            VALUES (?, ?, 1, 0, ?)
            ON CONFLICT(user_id, location_id, effective_from) DO UPDATE SET can_edit_roster=1`,
        [user.id, location.id, PLANNING_BASELINE]);
        result.applied.push({ principalName: seed.principalName, userId: user.id, role: user.role, locationCode: seed.locationCode });
    }
    return result;
}

async function allocateEmployeeCode(db) {
    await run(db, 'BEGIN IMMEDIATE');
    try {
        const row = await get(db, 'SELECT next_value AS nextValue FROM employee_code_sequence WHERE id=1');
        if (!row) throw new Error('Employee-code sequence ontbreekt. Voer eerst de masterdatamigratie uit.');
        const value = Number(row.nextValue);
        await run(db, 'UPDATE employee_code_sequence SET next_value=? WHERE id=1', [value + 1]);
        await run(db, 'COMMIT');
        return `EMP-${String(value).padStart(4, '0')}`;
    } catch (error) {
        await run(db, 'ROLLBACK').catch(() => {});
        throw error;
    }
}

async function masterdataReport(db) {
    const meta = await get(db, `SELECT schema_version AS schemaVersion, planning_baseline AS planningBaseline,
        canonical_names_reliable_from AS canonicalNamesReliableFrom, updated_at AS updatedAt
        FROM masterdata_meta WHERE id=1`);
    const locations = await all(db, `SELECT id, code, name, timezone, is_active AS isActive, sort_order AS sortOrder
        FROM locations ORDER BY sort_order, name`);
    const aliases = await all(db, `SELECT alias_name AS aliasName, canonical_name AS canonicalName,
        canonical_from AS canonicalFrom FROM legacy_employee_aliases ORDER BY alias_name`);
    const accessSeeds = await all(db, `SELECT principal_name AS principalName, target_role AS targetRole,
        location_code AS locationCode FROM masterdata_access_seeds ORDER BY target_role, principal_name`);
    const employeeCount = Number((await get(db, 'SELECT COUNT(*) AS count FROM employees'))?.count || 0);
    return { meta, locations, aliases, accessSeeds, employeeCount };
}

async function migrateMasterdata(db) {
    await ensureMasterdataSchema(db);
    await seedStaticMasterdata(db);
    const access = await applyKnownAccessScopes(db);
    return { ...(await masterdataReport(db)), access };
}

module.exports = {
    ACCESS_SCOPE_SEEDS,
    CANONICAL_NAMES_RELIABLE_FROM,
    LEGACY_EMPLOYEE_ALIASES,
    LOCATIONS,
    PLANNING_BASELINE,
    SCHEMA_VERSION,
    allocateEmployeeCode,
    applyKnownAccessScopes,
    canonicalEmployeeName,
    ensureMasterdataSchema,
    masterdataReport,
    migrateMasterdata,
    normalizeIdentity,
    seedStaticMasterdata,
    tableExists
};
