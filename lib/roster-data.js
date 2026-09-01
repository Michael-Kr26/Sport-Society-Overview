'use strict';

const ROSTER_SCHEMA_VERSION = 1;

const SHIFT_TYPES = Object.freeze(['floor', 'administration', 'internship']);

const AVAILABILITY_SLOTS = Object.freeze([
    { code: 'MORNING_EARLY', label: 'Ochtend 07:00-12:00', startTime: '07:00', endTime: '12:00', sortOrder: 10 },
    { code: 'MORNING_STANDARD', label: 'Ochtend 08:30-12:00', startTime: '08:30', endTime: '12:00', sortOrder: 20 },
    { code: 'AFTERNOON', label: 'Middag 16:00-21:30', startTime: '16:00', endTime: '21:30', sortOrder: 30 },
    { code: 'EVENING', label: 'Avond 18:30-21:30', startTime: '18:30', endTime: '21:30', sortOrder: 40 },
    { code: 'WEEKEND_MORNING', label: 'Weekend 08:30-12:00', startTime: '08:30', endTime: '12:00', sortOrder: 50 }
]);

const DEFAULT_SETTINGS = Object.freeze({
    minimumPublishedHorizonWeeks: 6,
    targetPublishedHorizonWeeks: 12,
    generationHorizonWeeks: 24,
    publicationRole: 'admin',
    availabilityMode: 'category',
    availabilityConflictPolicy: 'warning',
    locationEligibilityPolicy: 'warning',
    patternPropagationPolicy: 'auto_future',
    publishedPatternPolicy: 'admin_compound_republish',
    contractVariancePolicy: 'hour_bank',
    staffingPolicy: 'warning',
    weekStartsOn: 1
});

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

async function ensureRosterDataSchema(db) {
    await exec(db, `
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS roster_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            minimum_published_horizon_weeks INTEGER NOT NULL CHECK (minimum_published_horizon_weeks >= 1),
            target_published_horizon_weeks INTEGER NOT NULL CHECK (target_published_horizon_weeks >= minimum_published_horizon_weeks),
            generation_horizon_weeks INTEGER NOT NULL CHECK (generation_horizon_weeks >= target_published_horizon_weeks),
            publication_role TEXT NOT NULL CHECK (publication_role = 'admin'),
            availability_mode TEXT NOT NULL CHECK (availability_mode = 'category'),
            availability_conflict_policy TEXT NOT NULL CHECK (availability_conflict_policy IN ('warning', 'block')),
            location_eligibility_policy TEXT NOT NULL CHECK (location_eligibility_policy IN ('warning', 'block')),
            pattern_propagation_policy TEXT NOT NULL CHECK (pattern_propagation_policy IN ('auto_future', 'manual')),
            published_pattern_policy TEXT NOT NULL CHECK (published_pattern_policy IN ('admin_compound_republish', 'draft_only')),
            contract_variance_policy TEXT NOT NULL CHECK (contract_variance_policy IN ('hour_bank', 'warning', 'block')),
            staffing_policy TEXT NOT NULL CHECK (staffing_policy IN ('warning', 'block')),
            week_starts_on INTEGER NOT NULL CHECK (week_starts_on = 1),
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS availability_slots (
            code TEXT PRIMARY KEY COLLATE NOCASE,
            label TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
        );

        CREATE TABLE IF NOT EXISTS employee_availability_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
            slot_code TEXT NOT NULL,
            availability_state TEXT NOT NULL CHECK (availability_state IN ('available', 'unavailable')),
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            note TEXT,
            updated_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (slot_code) REFERENCES availability_slots(code) ON UPDATE CASCADE ON DELETE RESTRICT,
            FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (employee_id, weekday, slot_code, effective_from),
            CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from))
        );

        CREATE TABLE IF NOT EXISTS employee_availability_exceptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            availability_date TEXT NOT NULL,
            slot_code TEXT NOT NULL,
            availability_state TEXT NOT NULL CHECK (availability_state IN ('available', 'unavailable')),
            reason TEXT,
            note TEXT,
            agreed_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            FOREIGN KEY (slot_code) REFERENCES availability_slots(code) ON UPDATE CASCADE ON DELETE RESTRICT,
            FOREIGN KEY (agreed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (employee_id, availability_date, slot_code)
        );

        CREATE TABLE IF NOT EXISTS roster_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_uid TEXT NOT NULL UNIQUE,
            employee_id INTEGER,
            location_id INTEGER NOT NULL,
            shift_type TEXT NOT NULL CHECK (shift_type IN ('floor', 'administration', 'internship')),
            weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            repeat_interval_weeks INTEGER NOT NULL DEFAULT 1 CHECK (repeat_interval_weeks >= 1),
            anchor_week_start TEXT NOT NULL,
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            note TEXT,
            updated_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
            FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from)),
            CHECK (strftime('%w', anchor_week_start) = '1')
        );

        CREATE TABLE IF NOT EXISTS roster_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_id INTEGER NOT NULL,
            week_start TEXT NOT NULL,
            week_end TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
            UNIQUE (location_id, week_start),
            CHECK (strftime('%w', week_start) = '1'),
            CHECK (date(week_end) = date(week_start, '+6 day'))
        );

        CREATE TABLE IF NOT EXISTS roster_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period_id INTEGER NOT NULL,
            version_no INTEGER NOT NULL CHECK (version_no >= 1),
            state TEXT NOT NULL CHECK (state IN ('draft', 'published', 'abandoned')),
            based_on_version_id INTEGER,
            revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
            change_note TEXT,
            created_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            published_by_user_id INTEGER,
            published_at TEXT,
            FOREIGN KEY (period_id) REFERENCES roster_periods(id) ON DELETE CASCADE,
            FOREIGN KEY (based_on_version_id) REFERENCES roster_versions(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (period_id, version_no)
        );

        CREATE TABLE IF NOT EXISTS roster_shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shift_uid TEXT NOT NULL,
            version_id INTEGER NOT NULL,
            employee_id INTEGER,
            location_id INTEGER NOT NULL,
            starts_at_utc TEXT NOT NULL,
            ends_at_utc TEXT NOT NULL,
            shift_type TEXT NOT NULL CHECK (shift_type IN ('floor', 'administration', 'internship')),
            source_pattern_id INTEGER,
            source_pattern_revision INTEGER,
            note TEXT,
            legacy_source_hash TEXT,
            created_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (version_id) REFERENCES roster_versions(id) ON DELETE CASCADE,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
            FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
            FOREIGN KEY (source_pattern_id) REFERENCES roster_patterns(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (version_id, shift_uid),
            CHECK (julianday(ends_at_utc) > julianday(starts_at_utc)),
            CHECK (source_pattern_revision IS NULL OR source_pattern_revision >= 1)
        );

        CREATE TABLE IF NOT EXISTS roster_publications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publication_uid TEXT NOT NULL UNIQUE,
            published_by_user_id INTEGER NOT NULL,
            published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            note TEXT,
            notification_state TEXT NOT NULL DEFAULT 'pending' CHECK (notification_state IN ('pending', 'complete', 'failed')),
            FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS roster_publication_versions (
            publication_id INTEGER NOT NULL,
            version_id INTEGER NOT NULL UNIQUE,
            PRIMARY KEY (publication_id, version_id),
            FOREIGN KEY (publication_id) REFERENCES roster_publications(id) ON DELETE CASCADE,
            FOREIGN KEY (version_id) REFERENCES roster_versions(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS roster_publication_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publication_id INTEGER NOT NULL,
            period_id INTEGER NOT NULL,
            shift_uid TEXT,
            change_type TEXT NOT NULL CHECK (change_type IN ('added', 'modified', 'removed')),
            before_json TEXT,
            after_json TEXT,
            reason TEXT,
            cml_visible INTEGER NOT NULL DEFAULT 1 CHECK (cml_visible IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (publication_id) REFERENCES roster_publications(id) ON DELETE CASCADE,
            FOREIGN KEY (period_id) REFERENCES roster_periods(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            action TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            note TEXT,
            correlation_id TEXT,
            cml_visible INTEGER NOT NULL DEFAULT 0 CHECK (cml_visible IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS roster_pattern_sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_id INTEGER NOT NULL,
            pattern_revision INTEGER NOT NULL CHECK (pattern_revision >= 1),
            effective_from TEXT NOT NULL,
            affected_through TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
            requested_by_user_id INTEGER,
            requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            processed_at TEXT,
            error_message TEXT,
            FOREIGN KEY (pattern_id) REFERENCES roster_patterns(id) ON DELETE CASCADE,
            FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (pattern_id, pattern_revision)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_roster_versions_one_draft
            ON roster_versions(period_id) WHERE state = 'draft';
        CREATE INDEX IF NOT EXISTS idx_roster_periods_week ON roster_periods(week_start, location_id);
        CREATE INDEX IF NOT EXISTS idx_roster_versions_period_state ON roster_versions(period_id, state, version_no);
        CREATE INDEX IF NOT EXISTS idx_roster_shifts_version ON roster_shifts(version_id, starts_at_utc);
        CREATE INDEX IF NOT EXISTS idx_roster_shifts_employee ON roster_shifts(employee_id, starts_at_utc);
        CREATE INDEX IF NOT EXISTS idx_roster_patterns_employee ON roster_patterns(employee_id, effective_from);
        CREATE INDEX IF NOT EXISTS idx_roster_patterns_location ON roster_patterns(location_id, weekday, effective_from);
        CREATE INDEX IF NOT EXISTS idx_availability_pattern_employee ON employee_availability_patterns(employee_id, weekday, effective_from);
        CREATE INDEX IF NOT EXISTS idx_availability_exception_employee ON employee_availability_exceptions(employee_id, availability_date);
        CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_events_cml ON audit_events(cml_visible, created_at);

        CREATE TRIGGER IF NOT EXISTS roster_shifts_no_insert_into_published
        BEFORE INSERT ON roster_shifts
        WHEN EXISTS (SELECT 1 FROM roster_versions WHERE id = NEW.version_id AND state = 'published')
        BEGIN
            SELECT RAISE(ABORT, 'published roster version is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS roster_shifts_no_update_published
        BEFORE UPDATE ON roster_shifts
        WHEN EXISTS (SELECT 1 FROM roster_versions WHERE id = OLD.version_id AND state = 'published')
        BEGIN
            SELECT RAISE(ABORT, 'published roster version is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS roster_shifts_no_delete_published
        BEFORE DELETE ON roster_shifts
        WHEN EXISTS (SELECT 1 FROM roster_versions WHERE id = OLD.version_id AND state = 'published')
        BEGIN
            SELECT RAISE(ABORT, 'published roster version is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS roster_versions_no_update_published
        BEFORE UPDATE ON roster_versions
        WHEN OLD.state = 'published'
        BEGIN
            SELECT RAISE(ABORT, 'published roster version is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS roster_versions_no_delete_published
        BEFORE DELETE ON roster_versions
        WHEN OLD.state = 'published'
        BEGIN
            SELECT RAISE(ABORT, 'published roster version is immutable');
        END;
    `);
}

async function seedRosterData(db) {
    await run(db, `INSERT INTO roster_settings (
        id, schema_version, minimum_published_horizon_weeks, target_published_horizon_weeks,
        generation_horizon_weeks, publication_role, availability_mode, availability_conflict_policy,
        location_eligibility_policy, pattern_propagation_policy, published_pattern_policy,
        contract_variance_policy, staffing_policy, week_starts_on
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`, [
        ROSTER_SCHEMA_VERSION,
        DEFAULT_SETTINGS.minimumPublishedHorizonWeeks,
        DEFAULT_SETTINGS.targetPublishedHorizonWeeks,
        DEFAULT_SETTINGS.generationHorizonWeeks,
        DEFAULT_SETTINGS.publicationRole,
        DEFAULT_SETTINGS.availabilityMode,
        DEFAULT_SETTINGS.availabilityConflictPolicy,
        DEFAULT_SETTINGS.locationEligibilityPolicy,
        DEFAULT_SETTINGS.patternPropagationPolicy,
        DEFAULT_SETTINGS.publishedPatternPolicy,
        DEFAULT_SETTINGS.contractVariancePolicy,
        DEFAULT_SETTINGS.staffingPolicy,
        DEFAULT_SETTINGS.weekStartsOn
    ]);

    for (const slot of AVAILABILITY_SLOTS) {
        await run(db, `INSERT INTO availability_slots (code, label, start_time, end_time, sort_order, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(code) DO UPDATE SET label=excluded.label, start_time=excluded.start_time,
                end_time=excluded.end_time, sort_order=excluded.sort_order, is_active=1`,
        [slot.code, slot.label, slot.startTime, slot.endTime, slot.sortOrder]);
    }
}

async function bumpDraftRevision(db, versionId, expectedRevision) {
    const result = await run(db, `UPDATE roster_versions
        SET revision = revision + 1
        WHERE id = ? AND state = 'draft' AND revision = ?`, [versionId, expectedRevision]);
    if (result.changes !== 1) {
        const current = await get(db, 'SELECT id, state, revision FROM roster_versions WHERE id=?', [versionId]);
        const error = new Error('Roosterversie is intussen gewijzigd of is niet meer concept.');
        error.code = 'ROSTER_VERSION_CONFLICT';
        error.current = current;
        throw error;
    }
    return get(db, 'SELECT id, state, revision FROM roster_versions WHERE id=?', [versionId]);
}

async function rosterDataReport(db) {
    const settings = await get(db, `SELECT
        schema_version AS schemaVersion,
        minimum_published_horizon_weeks AS minimumPublishedHorizonWeeks,
        target_published_horizon_weeks AS targetPublishedHorizonWeeks,
        generation_horizon_weeks AS generationHorizonWeeks,
        publication_role AS publicationRole,
        availability_mode AS availabilityMode,
        availability_conflict_policy AS availabilityConflictPolicy,
        location_eligibility_policy AS locationEligibilityPolicy,
        pattern_propagation_policy AS patternPropagationPolicy,
        published_pattern_policy AS publishedPatternPolicy,
        contract_variance_policy AS contractVariancePolicy,
        staffing_policy AS staffingPolicy,
        week_starts_on AS weekStartsOn
        FROM roster_settings WHERE id=1`);
    const availabilitySlots = await all(db, `SELECT code, label, start_time AS startTime, end_time AS endTime
        FROM availability_slots WHERE is_active=1 ORDER BY sort_order, code`);
    const tableCounts = {};
    for (const table of [
        'employee_availability_patterns', 'employee_availability_exceptions', 'roster_patterns',
        'roster_periods', 'roster_versions', 'roster_shifts', 'roster_publications',
        'roster_publication_changes', 'audit_events', 'roster_pattern_sync_queue'
    ]) {
        tableCounts[table] = Number((await get(db, `SELECT COUNT(*) AS count FROM ${table}`))?.count || 0);
    }
    return { settings, availabilitySlots, shiftTypes: SHIFT_TYPES, tableCounts };
}

async function migrateRosterData(db) {
    await ensureRosterDataSchema(db);
    await seedRosterData(db);
    return rosterDataReport(db);
}

module.exports = {
    AVAILABILITY_SLOTS,
    DEFAULT_SETTINGS,
    ROSTER_SCHEMA_VERSION,
    SHIFT_TYPES,
    all,
    bumpDraftRevision,
    ensureRosterDataSchema,
    exec,
    get,
    migrateRosterData,
    rosterDataReport,
    run,
    seedRosterData
};
