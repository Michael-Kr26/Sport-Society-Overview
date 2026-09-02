'use strict';

const { all, exec, get, run } = require('./roster-data');

const PLANNING_BASELINE = '2026-09-01';
const ROLE_LEVEL = Object.freeze({ guest: 0, employee: 1, manager: 2, admin: 3 });
const PAGE_ACCESS = Object.freeze({
    'roster.html': 'employee',
    'planner.html': 'manager',
    'cml.html': 'manager',
    'cf.html': 'admin'
});
const API_ACCESS = Object.freeze([
    { prefix: '/api/roster-publication', minimumRole: 'admin' },
    { prefix: '/api/change-workflow', minimumRole: 'admin' },
    { prefix: '/api/change-form', minimumRole: 'admin' },
    { prefix: '/api/roster-preview', minimumRole: 'admin' },
    { prefix: '/api/roster-planner', minimumRole: 'employee' },
    { prefix: '/api/roster-effective', minimumRole: 'employee' },
    { prefix: '/api/roster', minimumRole: 'employee' }
]);

function roleAllows(role, minimumRole) {
    return (ROLE_LEVEL[String(role || 'guest')] || 0) >= (ROLE_LEVEL[String(minimumRole || 'guest')] || 0);
}

function minimumRoleForPage(pathname) {
    const page = String(pathname || '').split('/').pop();
    return PAGE_ACCESS[page] || null;
}

function minimumRoleForApi(pathname) {
    const path = String(pathname || '');
    return API_ACCESS.find((rule) => path === rule.prefix || path.startsWith(`${rule.prefix}/`))?.minimumRole || null;
}

async function tableExists(db, tableName) {
    return Boolean(await get(db, "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [tableName]));
}

async function ensureColumn(db, tableName, columnName, definition) {
    const columns = await all(db, `PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
        await run(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function ensureRosterAccessSchema(db) {
    if (!await tableExists(db, 'users')) {
        throw new Error('users-tabel ontbreekt; voer eerst de basismigraties uit.');
    }
    if (!await tableExists(db, 'locations') || !await tableExists(db, 'user_location_scopes')) {
        throw new Error('R1-masterdata ontbreekt; voer eerst migrate:masterdata uit.');
    }

    await ensureColumn(db, 'users', 'location', 'TEXT');

    await exec(db, `
        DROP TRIGGER IF EXISTS r7_manager_scope_after_insert;
        CREATE TRIGGER r7_manager_scope_after_insert
        AFTER INSERT ON users
        WHEN NEW.role='manager' AND NEW.location IS NOT NULL AND TRIM(NEW.location) <> ''
        BEGIN
            INSERT INTO user_location_scopes
                (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            SELECT NEW.id, l.id, 1, 0, date('now', 'localtime')
            FROM locations l
            WHERE l.name=NEW.location COLLATE NOCASE
              AND NOT EXISTS (
                  SELECT 1 FROM user_location_scopes s
                  WHERE s.user_id=NEW.id AND s.location_id=l.id AND s.can_edit_roster=1
                    AND date(s.effective_from) <= date('now', 'localtime')
                    AND (s.effective_to IS NULL OR date(s.effective_to) >= date('now', 'localtime'))
              );
        END;

        DROP TRIGGER IF EXISTS r7_manager_scope_after_update;
        CREATE TRIGGER r7_manager_scope_after_update
        AFTER UPDATE OF role, location ON users
        WHEN NEW.role='manager' AND NEW.location IS NOT NULL AND TRIM(NEW.location) <> ''
        BEGIN
            INSERT INTO user_location_scopes
                (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            SELECT NEW.id, l.id, 1, 0, date('now', 'localtime')
            FROM locations l
            WHERE l.name=NEW.location COLLATE NOCASE
              AND NOT EXISTS (
                  SELECT 1 FROM user_location_scopes s
                  WHERE s.user_id=NEW.id AND s.location_id=l.id AND s.can_edit_roster=1
                    AND date(s.effective_from) <= date('now', 'localtime')
                    AND (s.effective_to IS NULL OR date(s.effective_to) >= date('now', 'localtime'))
              );
        END;

        DROP TRIGGER IF EXISTS r7_close_scopes_on_manager_demotion;
        CREATE TRIGGER r7_close_scopes_on_manager_demotion
        AFTER UPDATE OF role ON users
        WHEN OLD.role='manager' AND NEW.role <> 'manager'
        BEGIN
            DELETE FROM user_location_scopes
            WHERE user_id=NEW.id AND effective_to IS NULL
              AND date(effective_from) >= date('now', 'localtime');

            UPDATE user_location_scopes
            SET effective_to=date('now', 'localtime', '-1 day')
            WHERE user_id=NEW.id AND effective_to IS NULL
              AND date(effective_from) < date('now', 'localtime');
        END;
    `);

    const managers = await all(db, `SELECT id, location, created_at AS createdAt
        FROM users
        WHERE role='manager' AND is_active=1 AND location IS NOT NULL AND TRIM(location) <> ''`);
    for (const manager of managers) {
        const location = await get(db, 'SELECT id FROM locations WHERE name=? COLLATE NOCASE', [manager.location]);
        if (!location) continue;
        const existing = await get(db, `SELECT id FROM user_location_scopes
            WHERE user_id=? AND location_id=? AND can_edit_roster=1
            LIMIT 1`, [manager.id, location.id]);
        if (existing) continue;
        const createdDate = String(manager.createdAt || '').slice(0, 10);
        const effectiveFrom = /^\d{4}-\d{2}-\d{2}$/.test(createdDate) && createdDate > PLANNING_BASELINE
            ? createdDate
            : PLANNING_BASELINE;
        await run(db, `INSERT INTO user_location_scopes
            (user_id, location_id, can_edit_roster, can_publish_roster, effective_from)
            VALUES (?, ?, 1, 0, ?)`, [manager.id, location.id, effectiveFrom]);
    }
}

async function migrateRosterAccess(db) {
    await ensureRosterAccessSchema(db);
    return {
        managerScopes: Number((await get(db, 'SELECT COUNT(*) AS count FROM user_location_scopes WHERE can_edit_roster=1'))?.count || 0)
    };
}

async function activeLocationScopes(db, userId, effectiveDate) {
    return all(db, `SELECT l.id AS locationId, l.code AS locationCode, l.name AS locationName,
        s.can_edit_roster AS canEditRoster, s.can_publish_roster AS canPublishRoster,
        s.effective_from AS effectiveFrom, s.effective_to AS effectiveTo
        FROM user_location_scopes s
        INNER JOIN locations l ON l.id=s.location_id
        WHERE s.user_id=?
          AND date(s.effective_from) <= date(?)
          AND (s.effective_to IS NULL OR date(s.effective_to) >= date(?))
        ORDER BY l.sort_order, l.name`, [userId, effectiveDate, effectiveDate]);
}

module.exports = {
    API_ACCESS,
    PAGE_ACCESS,
    PLANNING_BASELINE,
    ROLE_LEVEL,
    activeLocationScopes,
    ensureRosterAccessSchema,
    migrateRosterAccess,
    minimumRoleForApi,
    minimumRoleForPage,
    roleAllows
};