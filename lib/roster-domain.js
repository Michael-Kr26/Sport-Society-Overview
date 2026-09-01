'use strict';

const crypto = require('crypto');
const {
    all,
    exec,
    get,
    run
} = require('./roster-data');

const DEFAULT_TIMEZONE = 'Europe/Amsterdam';
const SHIFT_TYPES = new Set(['floor', 'administration', 'internship']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function domainError(message, code, status = 400, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details !== null) error.details = details;
    return error;
}

function assertIsoDate(value, field = 'datum') {
    if (!DATE_RE.test(String(value || ''))) {
        throw domainError(`Ongeldige ${field}.`, 'INVALID_DATE');
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw domainError(`Ongeldige ${field}.`, 'INVALID_DATE');
    }
    return value;
}

function assertTime(value, field = 'tijd') {
    if (!TIME_RE.test(String(value || ''))) {
        throw domainError(`Ongeldige ${field}.`, 'INVALID_TIME');
    }
    return value;
}

function addDays(dateString, days) {
    assertIsoDate(dateString);
    const date = new Date(`${dateString}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function mondayOf(dateString) {
    assertIsoDate(dateString);
    const date = new Date(`${dateString}T00:00:00Z`);
    const day = date.getUTCDay();
    const isoDay = day === 0 ? 7 : day;
    date.setUTCDate(date.getUTCDate() - (isoDay - 1));
    return date.toISOString().slice(0, 10);
}

function isMonday(dateString) {
    return mondayOf(dateString) === dateString;
}

function weekDistance(anchorWeekStart, weekStart) {
    const anchor = new Date(`${anchorWeekStart}T00:00:00Z`).getTime();
    const target = new Date(`${weekStart}T00:00:00Z`).getTime();
    return Math.floor((target - anchor) / (7 * 24 * 60 * 60 * 1000));
}

function minutesFromTime(time) {
    assertTime(time);
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function formatParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    return formatter.formatToParts(date).reduce((parts, part) => {
        if (part.type !== 'literal') parts[part.type] = part.value;
        return parts;
    }, {});
}

function localDateTimeToUtc(dateString, timeString, timeZone = DEFAULT_TIMEZONE) {
    assertIsoDate(dateString);
    assertTime(timeString);
    const [year, month, day] = dateString.split('-').map(Number);
    const [hour, minute] = timeString.split(':').map(Number);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    let guess = desiredUtc;

    for (let iteration = 0; iteration < 4; iteration += 1) {
        const parts = formatParts(new Date(guess), timeZone);
        const represented = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour),
            Number(parts.minute),
            Number(parts.second)
        );
        const delta = desiredUtc - represented;
        if (delta === 0) break;
        guess += delta;
    }

    return new Date(guess).toISOString();
}

function utcToLocal(isoString, timeZone = DEFAULT_TIMEZONE) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        throw domainError('Ongeldige UTC-datum/tijd.', 'INVALID_DATETIME');
    }
    const parts = formatParts(date, timeZone);
    const dateString = `${parts.year}-${parts.month}-${parts.day}`;
    const timeString = `${parts.hour}:${parts.minute}`;
    const jsDate = new Date(`${dateString}T00:00:00Z`);
    const day = jsDate.getUTCDay();
    return {
        date: dateString,
        time: timeString,
        weekday: day === 0 ? 7 : day
    };
}

function durationMinutes(startsAtUtc, endsAtUtc) {
    const start = new Date(startsAtUtc).getTime();
    const end = new Date(endsAtUtc).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw domainError('Ongeldige dienstduur.', 'INVALID_SHIFT_RANGE');
    }
    return Math.round((end - start) / 60000);
}

function stablePatternShiftUid(patternUid, shiftDate) {
    return `PAT:${patternUid}:${shiftDate}`;
}

function manualShiftUid() {
    return `SHIFT:${crypto.randomUUID()}`;
}

function publicationUid() {
    return `PUB:${crypto.randomUUID()}`;
}

function json(value) {
    return value === undefined ? null : JSON.stringify(value);
}

function comparableShift(row) {
    if (!row) return null;
    return {
        shiftUid: row.shiftUid,
        employeeId: row.employeeId ?? null,
        locationId: row.locationId,
        startsAtUtc: row.startsAtUtc,
        endsAtUtc: row.endsAtUtc,
        shiftType: row.shiftType,
        sourcePatternId: row.sourcePatternId ?? null,
        sourcePatternRevision: row.sourcePatternRevision ?? null,
        note: row.note || null,
        legacySourceHash: row.legacySourceHash || null
    };
}

function shiftsEqual(a, b) {
    return JSON.stringify(comparableShift(a)) === JSON.stringify(comparableShift(b));
}

async function withImmediateTransaction(db, callback) {
    await exec(db, 'BEGIN IMMEDIATE TRANSACTION;');
    try {
        const value = await callback();
        await exec(db, 'COMMIT;');
        return value;
    } catch (error) {
        await exec(db, 'ROLLBACK;').catch(() => {});
        throw error;
    }
}

async function ensureRosterDomainSchema(db) {
    await exec(db, `
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS roster_pattern_exceptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id INTEGER NOT NULL,
            shift_uid TEXT NOT NULL,
            pattern_id INTEGER,
            exception_type TEXT NOT NULL CHECK (exception_type IN ('override', 'suppress')),
            note TEXT,
            created_by_user_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (version_id) REFERENCES roster_versions(id) ON DELETE CASCADE,
            FOREIGN KEY (pattern_id) REFERENCES roster_patterns(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE (version_id, shift_uid)
        );

        CREATE INDEX IF NOT EXISTS idx_roster_pattern_exceptions_version
            ON roster_pattern_exceptions(version_id, shift_uid);
    `);
}

async function migrateRosterDomain(db) {
    await ensureRosterDomainSchema(db);
    return {
        patternExceptions: Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_pattern_exceptions'))?.count || 0)
    };
}

async function audit(db, {
    actorUserId = null,
    entityType,
    entityId,
    action,
    before = null,
    after = null,
    note = null,
    correlationId = null,
    cmlVisible = false
}) {
    await run(db, `INSERT INTO audit_events
        (actor_user_id, entity_type, entity_id, action, before_json, after_json, note, correlation_id, cml_visible)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        actorUserId,
        entityType,
        String(entityId),
        action,
        json(before),
        json(after),
        note || null,
        correlationId || null,
        cmlVisible ? 1 : 0
    ]);
}

async function versionInfo(db, versionId) {
    return get(db, `SELECT
        v.id,
        v.period_id AS periodId,
        v.version_no AS versionNo,
        v.state,
        v.based_on_version_id AS basedOnVersionId,
        v.revision,
        v.change_note AS changeNote,
        p.location_id AS locationId,
        p.week_start AS weekStart,
        p.week_end AS weekEnd,
        l.code AS locationCode,
        l.name AS locationName,
        l.timezone
        FROM roster_versions v
        INNER JOIN roster_periods p ON p.id=v.period_id
        INNER JOIN locations l ON l.id=p.location_id
        WHERE v.id=?`, [versionId]);
}

async function versionShifts(db, versionId) {
    return all(db, `SELECT
        s.id,
        s.shift_uid AS shiftUid,
        s.version_id AS versionId,
        s.employee_id AS employeeId,
        e.employee_code AS employeeCode,
        e.display_name AS employeeName,
        s.location_id AS locationId,
        l.code AS locationCode,
        l.name AS locationName,
        l.timezone,
        s.starts_at_utc AS startsAtUtc,
        s.ends_at_utc AS endsAtUtc,
        s.shift_type AS shiftType,
        s.source_pattern_id AS sourcePatternId,
        s.source_pattern_revision AS sourcePatternRevision,
        s.note,
        s.legacy_source_hash AS legacySourceHash
        FROM roster_shifts s
        LEFT JOIN employees e ON e.id=s.employee_id
        INNER JOIN locations l ON l.id=s.location_id
        WHERE s.version_id=?
        ORDER BY s.starts_at_utc, s.ends_at_utc, COALESCE(e.display_name, '')`, [versionId]);
}

async function latestPublishedVersion(db, periodId) {
    return get(db, `SELECT id, period_id AS periodId, version_no AS versionNo, state, revision,
        based_on_version_id AS basedOnVersionId, published_at AS publishedAt
        FROM roster_versions
        WHERE period_id=? AND state='published'
        ORDER BY version_no DESC
        LIMIT 1`, [periodId]);
}

async function activeDraftVersion(db, periodId) {
    return get(db, `SELECT id, period_id AS periodId, version_no AS versionNo, state, revision,
        based_on_version_id AS basedOnVersionId
        FROM roster_versions
        WHERE period_id=? AND state='draft'
        LIMIT 1`, [periodId]);
}

async function nextVersionNo(db, periodId) {
    const row = await get(db, 'SELECT COALESCE(MAX(version_no), 0) + 1 AS nextNo FROM roster_versions WHERE period_id=?', [periodId]);
    return Number(row.nextNo);
}

async function ensurePeriod(db, locationId, weekStart) {
    assertIsoDate(weekStart, 'weekstart');
    if (!isMonday(weekStart)) {
        throw domainError('Een roosterweek moet op maandag beginnen.', 'INVALID_WEEK_START');
    }
    const location = await get(db, 'SELECT id, code, name, timezone FROM locations WHERE id=? AND is_active=1', [locationId]);
    if (!location) throw domainError('Vestiging niet gevonden.', 'LOCATION_NOT_FOUND', 404);
    const weekEnd = addDays(weekStart, 6);
    await run(db, `INSERT INTO roster_periods (location_id, week_start, week_end)
        VALUES (?, ?, ?)
        ON CONFLICT(location_id, week_start) DO NOTHING`, [locationId, weekStart, weekEnd]);
    return get(db, `SELECT id, location_id AS locationId, week_start AS weekStart, week_end AS weekEnd
        FROM roster_periods WHERE location_id=? AND week_start=?`, [locationId, weekStart]);
}

function patternAppliesToWeek(pattern, weekStart) {
    if (!pattern.isActive) return false;
    const distance = weekDistance(pattern.anchorWeekStart, weekStart);
    if (distance < 0 || distance % pattern.repeatIntervalWeeks !== 0) return false;
    const shiftDate = addDays(weekStart, pattern.weekday - 1);
    if (shiftDate < pattern.effectiveFrom) return false;
    if (pattern.effectiveTo && shiftDate > pattern.effectiveTo) return false;
    return true;
}

async function patternsForLocationWeek(db, locationId, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const rows = await all(db, `SELECT
        id,
        pattern_uid AS patternUid,
        employee_id AS employeeId,
        location_id AS locationId,
        shift_type AS shiftType,
        weekday,
        start_time AS startTime,
        end_time AS endTime,
        repeat_interval_weeks AS repeatIntervalWeeks,
        anchor_week_start AS anchorWeekStart,
        effective_from AS effectiveFrom,
        effective_to AS effectiveTo,
        revision,
        is_active AS isActive,
        note
        FROM roster_patterns
        WHERE location_id=?
          AND date(effective_from) <= date(?)
          AND (effective_to IS NULL OR date(effective_to) >= date(?))`, [locationId, weekEnd, weekStart]);
    return rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) }))
        .filter((row) => patternAppliesToWeek(row, weekStart));
}

async function desiredPatternShifts(db, locationId, weekStart) {
    const location = await get(db, 'SELECT id, timezone FROM locations WHERE id=?', [locationId]);
    if (!location) throw domainError('Vestiging niet gevonden.', 'LOCATION_NOT_FOUND', 404);
    const patterns = await patternsForLocationWeek(db, locationId, weekStart);
    return patterns.map((pattern) => {
        const shiftDate = addDays(weekStart, pattern.weekday - 1);
        let endDate = shiftDate;
        if (minutesFromTime(pattern.endTime) <= minutesFromTime(pattern.startTime)) {
            endDate = addDays(shiftDate, 1);
        }
        return {
            shiftUid: stablePatternShiftUid(pattern.patternUid, shiftDate),
            employeeId: pattern.employeeId ?? null,
            locationId,
            startsAtUtc: localDateTimeToUtc(shiftDate, pattern.startTime, location.timezone || DEFAULT_TIMEZONE),
            endsAtUtc: localDateTimeToUtc(endDate, pattern.endTime, location.timezone || DEFAULT_TIMEZONE),
            shiftType: pattern.shiftType,
            sourcePatternId: pattern.id,
            sourcePatternRevision: pattern.revision,
            note: pattern.note || null,
            legacySourceHash: null
        };
    });
}

async function syncPatternsIntoDraft(db, versionId, actorUserId = null, correlationId = null) {
    const info = await versionInfo(db, versionId);
    if (!info) throw domainError('Roosterversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
    if (info.state !== 'draft') throw domainError('Alleen een concept kan met patterns worden gesynchroniseerd.', 'VERSION_NOT_DRAFT', 409);

    const desired = await desiredPatternShifts(db, info.locationId, info.weekStart);
    const desiredByUid = new Map(desired.map((shift) => [shift.shiftUid, shift]));
    const existing = await versionShifts(db, versionId);
    const generated = existing.filter((shift) => shift.sourcePatternId !== null);
    const existingByUid = new Map(generated.map((shift) => [shift.shiftUid, shift]));
    const exceptions = await all(db, `SELECT shift_uid AS shiftUid, exception_type AS exceptionType
        FROM roster_pattern_exceptions WHERE version_id=?`, [versionId]);
    const exceptionByUid = new Map(exceptions.map((item) => [item.shiftUid, item.exceptionType]));
    let changed = 0;

    await withImmediateTransaction(db, async () => {
        for (const current of generated) {
            if (exceptionByUid.has(current.shiftUid)) continue;
            if (!desiredByUid.has(current.shiftUid)) {
                await run(db, 'DELETE FROM roster_shifts WHERE id=?', [current.id]);
                changed += 1;
            }
        }

        for (const wanted of desired) {
            if (exceptionByUid.has(wanted.shiftUid)) continue;
            const current = existingByUid.get(wanted.shiftUid);
            if (!current) {
                await run(db, `INSERT INTO roster_shifts
                    (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc,
                     shift_type, source_pattern_id, source_pattern_revision, note, legacy_source_hash, created_by_user_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    wanted.shiftUid, versionId, wanted.employeeId, wanted.locationId,
                    wanted.startsAtUtc, wanted.endsAtUtc, wanted.shiftType,
                    wanted.sourcePatternId, wanted.sourcePatternRevision, wanted.note,
                    wanted.legacySourceHash, actorUserId
                ]);
                changed += 1;
                continue;
            }

            if (!shiftsEqual(current, wanted)) {
                await run(db, `UPDATE roster_shifts SET
                    employee_id=?, location_id=?, starts_at_utc=?, ends_at_utc=?, shift_type=?,
                    source_pattern_id=?, source_pattern_revision=?, note=?, legacy_source_hash=?, updated_at=CURRENT_TIMESTAMP
                    WHERE id=?`, [
                    wanted.employeeId, wanted.locationId, wanted.startsAtUtc, wanted.endsAtUtc,
                    wanted.shiftType, wanted.sourcePatternId, wanted.sourcePatternRevision,
                    wanted.note, wanted.legacySourceHash, current.id
                ]);
                changed += 1;
            }
        }

        if (changed > 0) {
            await run(db, 'UPDATE roster_versions SET revision=revision+1 WHERE id=? AND state=\'draft\'', [versionId]);
            await audit(db, {
                actorUserId,
                entityType: 'roster_version',
                entityId: versionId,
                action: 'patterns_synced',
                note: `${changed} gegenereerde dienst(en) bijgewerkt.`,
                correlationId
            });
        }
    });

    return {
        version: await versionInfo(db, versionId),
        changed,
        shifts: await versionShifts(db, versionId)
    };
}

async function ensureDraftInternal(db, {
    locationId,
    weekStart,
    actorUserId = null,
    changeNote = null,
    syncPatterns = true
}) {
    const period = await ensurePeriod(db, locationId, weekStart);
    const existing = await activeDraftVersion(db, period.id);
    if (existing) {
        return {
            created: false,
            clonedFromPublished: Boolean(existing.basedOnVersionId),
            version: await versionInfo(db, existing.id),
            shifts: await versionShifts(db, existing.id)
        };
    }

    const published = await latestPublishedVersion(db, period.id);
    const versionNo = await nextVersionNo(db, period.id);
    const created = await run(db, `INSERT INTO roster_versions
        (period_id, version_no, state, based_on_version_id, revision, change_note, created_by_user_id)
        VALUES (?, ?, 'draft', ?, 1, ?, ?)`, [
        period.id,
        versionNo,
        published ? published.id : null,
        changeNote || null,
        actorUserId
    ]);

    if (published) {
        await run(db, `INSERT INTO roster_shifts
            (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type,
             source_pattern_id, source_pattern_revision, note, legacy_source_hash, created_by_user_id)
            SELECT shift_uid, ?, employee_id, location_id, starts_at_utc, ends_at_utc, shift_type,
                   source_pattern_id, source_pattern_revision, note, legacy_source_hash, ?
            FROM roster_shifts WHERE version_id=?`, [created.lastID, actorUserId, published.id]);
        await run(db, `INSERT INTO roster_pattern_exceptions
            (version_id, shift_uid, pattern_id, exception_type, note, created_by_user_id)
            SELECT ?, shift_uid, pattern_id, exception_type, note, ?
            FROM roster_pattern_exceptions WHERE version_id=?`, [created.lastID, actorUserId, published.id]);
    }

    await audit(db, {
        actorUserId,
        entityType: 'roster_version',
        entityId: created.lastID,
        action: published ? 'draft_cloned' : 'draft_created',
        before: published ? { versionId: published.id, versionNo: published.versionNo } : null,
        after: { versionId: created.lastID, versionNo },
        note: changeNote
    });

    if (syncPatterns) {
        await syncPatternsIntoDraft(db, created.lastID, actorUserId);
    }

    return {
        created: true,
        clonedFromPublished: Boolean(published),
        version: await versionInfo(db, created.lastID),
        shifts: await versionShifts(db, created.lastID)
    };
}

async function assertDraftRevision(db, versionId, expectedRevision) {
    const result = await run(db, `UPDATE roster_versions
        SET revision=revision+1
        WHERE id=? AND state='draft' AND revision=?`, [versionId, expectedRevision]);
    if (result.changes !== 1) {
        const current = await get(db, 'SELECT id, state, revision FROM roster_versions WHERE id=?', [versionId]);
        throw domainError(
            'Roosterversie is intussen gewijzigd of is niet meer concept.',
            'ROSTER_VERSION_CONFLICT',
            409,
            current
        );
    }
}

function normalizeShiftInput(input) {
    if (!SHIFT_TYPES.has(input.shiftType)) {
        throw domainError('Ongeldig diensttype.', 'INVALID_SHIFT_TYPE');
    }
    const start = new Date(input.startsAtUtc);
    const end = new Date(input.endsAtUtc);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        throw domainError('De dienst heeft geen geldige begin- en eindtijd.', 'INVALID_SHIFT_RANGE');
    }
    return {
        employeeId: input.employeeId ?? null,
        startsAtUtc: start.toISOString(),
        endsAtUtc: end.toISOString(),
        shiftType: input.shiftType,
        note: input.note ? String(input.note).trim().slice(0, 1000) : null
    };
}

async function mutationContext(db, versionId) {
    const info = await versionInfo(db, versionId);
    if (!info) throw domainError('Roosterversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
    if (info.state !== 'draft') throw domainError('Alleen een conceptrooster kan worden gewijzigd.', 'VERSION_NOT_DRAFT', 409);
    return info;
}

async function userRow(db, userId) {
    if (!userId) return null;
    return get(db, `SELECT id, username, display_name AS displayName, role, is_active AS isActive
        FROM users WHERE id=?`, [userId]);
}

function createRosterDomain(db) {
    if (!db) throw new TypeError('db is verplicht');
    const ready = ensureRosterDomainSchema(db);

    const AuthorizationService = {
        async getUser(userId) {
            await ready;
            const user = await userRow(db, userId);
            return user ? { ...user, isActive: Boolean(user.isActive) } : null;
        },

        async canViewPublishedRoster(userId) {
            await ready;
            const user = await userRow(db, userId);
            return Boolean(user && user.isActive && ['employee', 'manager', 'admin'].includes(user.role));
        },

        async canEditLocation(userId, locationId, effectiveDate = new Date().toISOString().slice(0, 10)) {
            await ready;
            const user = await userRow(db, userId);
            if (!user || !user.isActive) return false;
            if (user.role === 'admin') return true;
            if (user.role !== 'manager') return false;
            const scope = await get(db, `SELECT id FROM user_location_scopes
                WHERE user_id=? AND location_id=? AND can_edit_roster=1
                  AND date(effective_from) <= date(?)
                  AND (effective_to IS NULL OR date(effective_to) >= date(?))
                ORDER BY effective_from DESC LIMIT 1`, [userId, locationId, effectiveDate, effectiveDate]);
            return Boolean(scope);
        },

        async canPublish(userId) {
            await ready;
            const user = await userRow(db, userId);
            return Boolean(user && user.isActive && user.role === 'admin');
        },

        async employeeIdForUser(userId) {
            await ready;
            const row = await get(db, 'SELECT employee_id AS employeeId FROM user_employee_links WHERE user_id=?', [userId]);
            return row ? row.employeeId : null;
        },

        async assertCanEditLocation(userId, locationId, effectiveDate) {
            if (!await this.canEditLocation(userId, locationId, effectiveDate)) {
                throw domainError('Je mag het rooster van deze vestiging niet wijzigen.', 'ROSTER_EDIT_FORBIDDEN', 403);
            }
        },

        async assertCanPublish(userId) {
            if (!await this.canPublish(userId)) {
                throw domainError('Alleen Admin mag een rooster publiceren.', 'ROSTER_PUBLISH_FORBIDDEN', 403);
            }
        }
    };

    const QueryService = {
        async getVersion(versionId) {
            await ready;
            const info = await versionInfo(db, versionId);
            if (!info) return null;
            return { ...info, shifts: await versionShifts(db, versionId) };
        },

        async getWeekState(locationId, weekStart) {
            await ready;
            const period = await get(db, `SELECT id, location_id AS locationId, week_start AS weekStart, week_end AS weekEnd
                FROM roster_periods WHERE location_id=? AND week_start=?`, [locationId, weekStart]);
            if (!period) return { period: null, draft: null, published: null };
            const draft = await activeDraftVersion(db, period.id);
            const published = await latestPublishedVersion(db, period.id);
            return { period, draft, published };
        },

        async getPublishedWeek(locationId, weekStart) {
            const state = await this.getWeekState(locationId, weekStart);
            if (!state.published) return null;
            return this.getVersion(state.published.id);
        },

        async getDraftWeek(locationId, weekStart) {
            const state = await this.getWeekState(locationId, weekStart);
            if (!state.draft) return null;
            return this.getVersion(state.draft.id);
        },

        async getPublishedRoster({
            from,
            to,
            locationId = null,
            employeeId = null,
            openOnly = false
        }) {
            await ready;
            assertIsoDate(from, 'vanaf-datum');
            assertIsoDate(to, 'tot-datum');
            const toExclusive = addDays(to, 1);
            let where = `WHERE s.starts_at_utc < ? AND s.ends_at_utc > ?`;
            const params = [
                localDateTimeToUtc(toExclusive, '00:00', DEFAULT_TIMEZONE),
                localDateTimeToUtc(from, '00:00', DEFAULT_TIMEZONE)
            ];
            if (locationId) {
                where += ' AND s.location_id=?';
                params.push(locationId);
            }
            if (employeeId) {
                where += ' AND s.employee_id=?';
                params.push(employeeId);
            }
            if (openOnly) where += ' AND s.employee_id IS NULL';

            return all(db, `SELECT
                s.shift_uid AS shiftUid,
                s.employee_id AS employeeId,
                e.employee_code AS employeeCode,
                e.display_name AS employeeName,
                s.location_id AS locationId,
                l.code AS locationCode,
                l.name AS locationName,
                l.timezone,
                p.week_start AS weekStart,
                v.id AS versionId,
                v.version_no AS versionNo,
                s.starts_at_utc AS startsAtUtc,
                s.ends_at_utc AS endsAtUtc,
                s.shift_type AS shiftType,
                s.note
                FROM roster_periods p
                INNER JOIN roster_versions v ON v.period_id=p.id
                    AND v.state='published'
                    AND v.version_no=(
                        SELECT MAX(v2.version_no) FROM roster_versions v2
                        WHERE v2.period_id=p.id AND v2.state='published'
                    )
                INNER JOIN roster_shifts s ON s.version_id=v.id
                INNER JOIN locations l ON l.id=s.location_id
                LEFT JOIN employees e ON e.id=s.employee_id
                ${where}
                ORDER BY s.starts_at_utc, l.sort_order, COALESCE(e.display_name, '')`, params);
        },

        async getEmployeePublishedRoster(employeeId, from, to) {
            return this.getPublishedRoster({ from, to, employeeId });
        },

        async getOpenShifts(from, to, locationId = null) {
            return this.getPublishedRoster({ from, to, locationId, openOnly: true });
        }
    };

    const DraftService = {
        async ensureDraft({ locationId, weekStart, actorUserId, changeNote = null }) {
            await AuthorizationService.assertCanEditLocation(actorUserId, locationId, weekStart);
            return ensureDraftInternal(db, { locationId, weekStart, actorUserId, changeNote, syncPatterns: true });
        },

        async addShift({
            versionId,
            expectedRevision,
            actorUserId,
            employeeId = null,
            startsAtUtc,
            endsAtUtc,
            shiftType = 'floor',
            note = null
        }) {
            const info = await mutationContext(db, versionId);
            await AuthorizationService.assertCanEditLocation(actorUserId, info.locationId, info.weekStart);
            const shift = normalizeShiftInput({ employeeId, startsAtUtc, endsAtUtc, shiftType, note });
            const shiftUid = manualShiftUid();
            await withImmediateTransaction(db, async () => {
                await assertDraftRevision(db, versionId, expectedRevision);
                await run(db, `INSERT INTO roster_shifts
                    (shift_uid, version_id, employee_id, location_id, starts_at_utc, ends_at_utc,
                     shift_type, note, created_by_user_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    shiftUid, versionId, shift.employeeId, info.locationId,
                    shift.startsAtUtc, shift.endsAtUtc, shift.shiftType, shift.note, actorUserId
                ]);
                await audit(db, {
                    actorUserId,
                    entityType: 'roster_shift',
                    entityId: shiftUid,
                    action: 'added',
                    after: { ...shift, shiftUid, versionId, locationId: info.locationId }
                });
            });
            return QueryService.getVersion(versionId);
        },

        async updateShift({
            versionId,
            shiftUid,
            expectedRevision,
            actorUserId,
            employeeId,
            startsAtUtc,
            endsAtUtc,
            shiftType,
            note
        }) {
            const info = await mutationContext(db, versionId);
            await AuthorizationService.assertCanEditLocation(actorUserId, info.locationId, info.weekStart);
            const current = await get(db, `SELECT
                shift_uid AS shiftUid, employee_id AS employeeId, location_id AS locationId,
                starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc, shift_type AS shiftType,
                source_pattern_id AS sourcePatternId, source_pattern_revision AS sourcePatternRevision,
                note, legacy_source_hash AS legacySourceHash
                FROM roster_shifts WHERE version_id=? AND shift_uid=?`, [versionId, shiftUid]);
            if (!current) throw domainError('Dienst niet gevonden.', 'SHIFT_NOT_FOUND', 404);
            const shift = normalizeShiftInput({
                employeeId: employeeId === undefined ? current.employeeId : employeeId,
                startsAtUtc: startsAtUtc || current.startsAtUtc,
                endsAtUtc: endsAtUtc || current.endsAtUtc,
                shiftType: shiftType || current.shiftType,
                note: note === undefined ? current.note : note
            });

            await withImmediateTransaction(db, async () => {
                await assertDraftRevision(db, versionId, expectedRevision);
                if (current.sourcePatternId !== null) {
                    await run(db, `INSERT INTO roster_pattern_exceptions
                        (version_id, shift_uid, pattern_id, exception_type, note, created_by_user_id)
                        VALUES (?, ?, ?, 'override', ?, ?)
                        ON CONFLICT(version_id, shift_uid) DO UPDATE SET
                            pattern_id=excluded.pattern_id, exception_type='override', note=excluded.note,
                            created_by_user_id=excluded.created_by_user_id, updated_at=CURRENT_TIMESTAMP`, [
                        versionId, shiftUid, current.sourcePatternId, shift.note, actorUserId
                    ]);
                }
                await run(db, `UPDATE roster_shifts SET
                    employee_id=?, starts_at_utc=?, ends_at_utc=?, shift_type=?, note=?,
                    updated_at=CURRENT_TIMESTAMP
                    WHERE version_id=? AND shift_uid=?`, [
                    shift.employeeId, shift.startsAtUtc, shift.endsAtUtc, shift.shiftType,
                    shift.note, versionId, shiftUid
                ]);
                await audit(db, {
                    actorUserId,
                    entityType: 'roster_shift',
                    entityId: shiftUid,
                    action: 'modified',
                    before: comparableShift(current),
                    after: { ...shift, shiftUid, versionId, locationId: info.locationId }
                });
            });
            return QueryService.getVersion(versionId);
        },

        async removeShift({ versionId, shiftUid, expectedRevision, actorUserId, reason = null }) {
            const info = await mutationContext(db, versionId);
            await AuthorizationService.assertCanEditLocation(actorUserId, info.locationId, info.weekStart);
            const current = await get(db, `SELECT
                shift_uid AS shiftUid, employee_id AS employeeId, location_id AS locationId,
                starts_at_utc AS startsAtUtc, ends_at_utc AS endsAtUtc, shift_type AS shiftType,
                source_pattern_id AS sourcePatternId, source_pattern_revision AS sourcePatternRevision,
                note, legacy_source_hash AS legacySourceHash
                FROM roster_shifts WHERE version_id=? AND shift_uid=?`, [versionId, shiftUid]);
            if (!current) throw domainError('Dienst niet gevonden.', 'SHIFT_NOT_FOUND', 404);

            await withImmediateTransaction(db, async () => {
                await assertDraftRevision(db, versionId, expectedRevision);
                if (current.sourcePatternId !== null) {
                    await run(db, `INSERT INTO roster_pattern_exceptions
                        (version_id, shift_uid, pattern_id, exception_type, note, created_by_user_id)
                        VALUES (?, ?, ?, 'suppress', ?, ?)
                        ON CONFLICT(version_id, shift_uid) DO UPDATE SET
                            pattern_id=excluded.pattern_id, exception_type='suppress', note=excluded.note,
                            created_by_user_id=excluded.created_by_user_id, updated_at=CURRENT_TIMESTAMP`, [
                        versionId, shiftUid, current.sourcePatternId, reason || null, actorUserId
                    ]);
                }
                await run(db, 'DELETE FROM roster_shifts WHERE version_id=? AND shift_uid=?', [versionId, shiftUid]);
                await audit(db, {
                    actorUserId,
                    entityType: 'roster_shift',
                    entityId: shiftUid,
                    action: 'removed',
                    before: comparableShift(current),
                    note: reason
                });
            });
            return QueryService.getVersion(versionId);
        }
    };

    async function queuePatternSync(pattern, effectiveFrom, actorUserId) {
        const settings = await get(db, 'SELECT generation_horizon_weeks AS weeks FROM roster_settings WHERE id=1');
        const horizonWeeks = Number(settings?.weeks || 24);
        const affectedThrough = addDays(effectiveFrom, horizonWeeks * 7 - 1);
        await run(db, `INSERT INTO roster_pattern_sync_queue
            (pattern_id, pattern_revision, effective_from, affected_through, status, requested_by_user_id)
            VALUES (?, ?, ?, ?, 'pending', ?)
            ON CONFLICT(pattern_id, pattern_revision) DO UPDATE SET
                effective_from=excluded.effective_from,
                affected_through=excluded.affected_through,
                status='pending',
                requested_by_user_id=excluded.requested_by_user_id,
                processed_at=NULL,
                error_message=NULL`, [
            pattern.id, pattern.revision, effectiveFrom, affectedThrough, actorUserId
        ]);
    }

    const PatternService = {
        async createPattern({
            actorUserId,
            employeeId = null,
            locationId,
            shiftType = 'floor',
            weekday,
            startTime,
            endTime,
            repeatIntervalWeeks = 1,
            anchorWeekStart,
            effectiveFrom,
            effectiveTo = null,
            note = null
        }) {
            await AuthorizationService.assertCanEditLocation(actorUserId, locationId, effectiveFrom);
            if (!SHIFT_TYPES.has(shiftType)) throw domainError('Ongeldig diensttype.', 'INVALID_SHIFT_TYPE');
            if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw domainError('Ongeldige weekdag.', 'INVALID_WEEKDAY');
            assertTime(startTime, 'begintijd');
            assertTime(endTime, 'eindtijd');
            assertIsoDate(anchorWeekStart, 'ankerweek');
            if (!isMonday(anchorWeekStart)) throw domainError('De ankerweek moet op maandag beginnen.', 'INVALID_ANCHOR_WEEK');
            assertIsoDate(effectiveFrom, 'ingangsdatum');
            if (effectiveTo) assertIsoDate(effectiveTo, 'einddatum');
            if (!Number.isInteger(repeatIntervalWeeks) || repeatIntervalWeeks < 1) {
                throw domainError('Herhalingsinterval moet minimaal één week zijn.', 'INVALID_REPEAT_INTERVAL');
            }

            const patternUid = `PAT:${crypto.randomUUID()}`;
            const result = await run(db, `INSERT INTO roster_patterns
                (pattern_uid, employee_id, location_id, shift_type, weekday, start_time, end_time,
                 repeat_interval_weeks, anchor_week_start, effective_from, effective_to, revision,
                 is_active, note, updated_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`, [
                patternUid, employeeId, locationId, shiftType, weekday, startTime, endTime,
                repeatIntervalWeeks, anchorWeekStart, effectiveFrom, effectiveTo, note, actorUserId
            ]);
            const pattern = await get(db, `SELECT id, pattern_uid AS patternUid, employee_id AS employeeId,
                location_id AS locationId, shift_type AS shiftType, weekday, start_time AS startTime,
                end_time AS endTime, repeat_interval_weeks AS repeatIntervalWeeks,
                anchor_week_start AS anchorWeekStart, effective_from AS effectiveFrom,
                effective_to AS effectiveTo, revision, is_active AS isActive, note
                FROM roster_patterns WHERE id=?`, [result.lastID]);
            await queuePatternSync(pattern, effectiveFrom, actorUserId);
            await audit(db, {
                actorUserId,
                entityType: 'roster_pattern',
                entityId: pattern.id,
                action: 'created',
                after: pattern
            });
            const propagation = await this.processPendingSync({ actorUserId });
            return { ...pattern, propagation };
        },

        async replacePattern({
            patternId,
            actorUserId,
            effectiveFrom,
            employeeId,
            locationId,
            shiftType,
            weekday,
            startTime,
            endTime,
            repeatIntervalWeeks,
            anchorWeekStart,
            effectiveTo = null,
            note
        }) {
            assertIsoDate(effectiveFrom, 'ingangsdatum');
            const current = await get(db, `SELECT id, pattern_uid AS patternUid, employee_id AS employeeId,
                location_id AS locationId, shift_type AS shiftType, weekday, start_time AS startTime,
                end_time AS endTime, repeat_interval_weeks AS repeatIntervalWeeks,
                anchor_week_start AS anchorWeekStart, effective_from AS effectiveFrom,
                effective_to AS effectiveTo, revision, is_active AS isActive, note
                FROM roster_patterns WHERE id=?`, [patternId]);
            if (!current) throw domainError('Roosterpattern niet gevonden.', 'PATTERN_NOT_FOUND', 404);
            await AuthorizationService.assertCanEditLocation(actorUserId, current.locationId, effectiveFrom);
            if (locationId !== undefined && locationId !== current.locationId) {
                await AuthorizationService.assertCanEditLocation(actorUserId, locationId, effectiveFrom);
            }
            if (effectiveFrom <= current.effectiveFrom) {
                throw domainError('Een patternwijziging moet na de bestaande ingangsdatum beginnen.', 'INVALID_PATTERN_REPLACEMENT_DATE');
            }
            const oldEndsOn = addDays(effectiveFrom, -1);
            const nextRevision = Number(current.revision) + 1;
            await run(db, `UPDATE roster_patterns
                SET effective_to=?, revision=?, updated_by_user_id=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?`, [oldEndsOn, nextRevision, actorUserId, patternId]);
            const closed = { ...current, effectiveTo: oldEndsOn, revision: nextRevision };

            const created = await this.createPattern({
                actorUserId,
                employeeId: employeeId === undefined ? current.employeeId : employeeId,
                locationId: locationId === undefined ? current.locationId : locationId,
                shiftType: shiftType || current.shiftType,
                weekday: weekday === undefined ? current.weekday : weekday,
                startTime: startTime || current.startTime,
                endTime: endTime || current.endTime,
                repeatIntervalWeeks: repeatIntervalWeeks || current.repeatIntervalWeeks,
                anchorWeekStart: anchorWeekStart || mondayOf(effectiveFrom),
                effectiveFrom,
                effectiveTo,
                note: note === undefined ? current.note : note
            });
            await queuePatternSync(closed, effectiveFrom, actorUserId);
            await audit(db, {
                actorUserId,
                entityType: 'roster_pattern',
                entityId: current.id,
                action: 'replaced',
                before: current,
                after: { closed, successorPatternId: created.id, successorPatternUid: created.patternUid }
            });
            const propagation = await this.processPendingSync({ actorUserId });
            return { closed, successor: created, propagation };
        },

        async syncDraft(versionId, actorUserId = null) {
            const info = await versionInfo(db, versionId);
            if (!info) throw domainError('Roosterversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
            if (actorUserId) {
                await AuthorizationService.assertCanEditLocation(actorUserId, info.locationId, info.weekStart);
            }
            return syncPatternsIntoDraft(db, versionId, actorUserId);
        },

        async processPendingSync({ actorUserId = null, limit = 100 } = {}) {
            await ready;
            const rows = await all(db, `SELECT
                q.id, q.pattern_id AS patternId, q.pattern_revision AS patternRevision,
                q.effective_from AS effectiveFrom, q.affected_through AS affectedThrough,
                p.location_id AS locationId
                FROM roster_pattern_sync_queue q
                INNER JOIN roster_patterns p ON p.id=q.pattern_id
                WHERE q.status='pending'
                ORDER BY q.requested_at, q.id
                LIMIT ?`, [limit]);
            const processed = [];

            for (const item of rows) {
                try {
                    const periods = await all(db, `SELECT id, location_id AS locationId, week_start AS weekStart
                        FROM roster_periods
                        WHERE location_id=?
                          AND date(week_start) >= date(?)
                          AND date(week_start) <= date(?)
                        ORDER BY week_start`, [
                        item.locationId,
                        mondayOf(item.effectiveFrom),
                        mondayOf(item.affectedThrough)
                    ]);
                    const affectedDrafts = [];
                    const requiresRepublish = [];

                    for (const period of periods) {
                        const published = await latestPublishedVersion(db, period.id);
                        let draft = await activeDraftVersion(db, period.id);
                        if (!draft && published) {
                            const created = await ensureDraftInternal(db, {
                                locationId: period.locationId,
                                weekStart: period.weekStart,
                                actorUserId,
                                changeNote: 'Automatische patternwijziging',
                                syncPatterns: false
                            });
                            draft = created.version;
                            requiresRepublish.push({
                                periodId: period.id,
                                locationId: period.locationId,
                                weekStart: period.weekStart,
                                previousPublishedVersionId: published.id,
                                draftVersionId: draft.id
                            });
                        }
                        if (draft) {
                            const sync = await syncPatternsIntoDraft(db, draft.id, actorUserId);
                            affectedDrafts.push({
                                versionId: draft.id,
                                weekStart: period.weekStart,
                                changed: sync.changed
                            });
                        }
                    }

                    await run(db, `UPDATE roster_pattern_sync_queue
                        SET status='applied', processed_at=CURRENT_TIMESTAMP, error_message=NULL
                        WHERE id=?`, [item.id]);
                    processed.push({ ...item, affectedDrafts, requiresRepublish, status: 'applied' });
                } catch (error) {
                    await run(db, `UPDATE roster_pattern_sync_queue
                        SET status='failed', processed_at=CURRENT_TIMESTAMP, error_message=?
                        WHERE id=?`, [String(error.message).slice(0, 1000), item.id]);
                    processed.push({ ...item, status: 'failed', error: error.message });
                }
            }
            return processed;
        }
    };

    async function projectedVersionsForWeek(weekStart, candidateVersionIds = []) {
        const candidates = new Map();
        for (const versionId of candidateVersionIds) {
            const info = await versionInfo(db, versionId);
            if (!info) throw domainError('Kandidaatversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
            if (info.weekStart !== weekStart) throw domainError('Kandidaatversie hoort bij een andere week.', 'VERSION_WEEK_MISMATCH');
            candidates.set(info.periodId, info);
        }

        const periods = await all(db, 'SELECT id FROM roster_periods WHERE week_start=? ORDER BY location_id', [weekStart]);
        const selected = [];
        for (const period of periods) {
            if (candidates.has(period.id)) {
                selected.push(candidates.get(period.id));
                continue;
            }
            const draft = await activeDraftVersion(db, period.id);
            if (draft) {
                selected.push(await versionInfo(db, draft.id));
                continue;
            }
            const published = await latestPublishedVersion(db, period.id);
            if (published) selected.push(await versionInfo(db, published.id));
        }
        return selected;
    }

    async function projectedWeekShifts(weekStart, candidateVersionIds = []) {
        const versions = await projectedVersionsForWeek(weekStart, candidateVersionIds);
        const shifts = [];
        for (const version of versions) {
            shifts.push(...await versionShifts(db, version.id));
        }
        return shifts;
    }

    async function contractMinutesAt(employeeId, dateString) {
        const row = await get(db, `SELECT ct.weekly_minutes AS weeklyMinutes
            FROM employment_periods ep
            INNER JOIN contract_terms ct ON ct.employment_period_id=ep.id
            WHERE ep.employee_id=?
              AND (ep.starts_on IS NULL OR date(ep.starts_on) <= date(?))
              AND (ep.ends_on IS NULL OR date(ep.ends_on) >= date(?))
              AND date(ep.known_from) <= date(?)
              AND date(ct.effective_from) <= date(?)
              AND (ct.effective_to IS NULL OR date(ct.effective_to) >= date(?))
            ORDER BY ct.effective_from DESC, ct.id DESC
            LIMIT 1`, [employeeId, dateString, dateString, dateString, dateString, dateString]);
        return row ? Number(row.weeklyMinutes) : null;
    }

    const HoursService = {
        async projectedWeekMinutes({ weekStart, candidateVersionIds = [] }) {
            assertIsoDate(weekStart, 'weekstart');
            const shifts = await projectedWeekShifts(weekStart, candidateVersionIds);
            const totals = new Map();
            for (const shift of shifts) {
                if (!shift.employeeId) continue;
                totals.set(
                    shift.employeeId,
                    (totals.get(shift.employeeId) || 0) + durationMinutes(shift.startsAtUtc, shift.endsAtUtc)
                );
            }
            const activeEmployees = await all(db, `SELECT DISTINCT e.id AS employeeId, e.employee_code AS employeeCode,
                e.display_name AS employeeName
                FROM employees e
                INNER JOIN employment_periods ep ON ep.employee_id=e.id
                WHERE e.archived_at IS NULL
                  AND date(ep.known_from) <= date(?)
                  AND (ep.starts_on IS NULL OR date(ep.starts_on) <= date(?))
                  AND (ep.ends_on IS NULL OR date(ep.ends_on) >= date(?))`, [weekStart, weekStart, weekStart]);
            const employeeIds = new Set([...totals.keys(), ...activeEmployees.map((row) => row.employeeId)]);
            const output = [];
            for (const employeeId of employeeIds) {
                const plannedMinutes = totals.get(employeeId) || 0;
                const employee = activeEmployees.find((row) => row.employeeId === employeeId)
                    || await get(db, 'SELECT employee_code AS employeeCode, display_name AS employeeName FROM employees WHERE id=?', [employeeId]);
                const contractMinutes = await contractMinutesAt(employeeId, weekStart);
                output.push({
                    employeeId,
                    employeeCode: employee?.employeeCode || null,
                    employeeName: employee?.employeeName || null,
                    plannedMinutes,
                    contractMinutes,
                    hourBankDeltaMinutes: contractMinutes === null ? null : plannedMinutes - contractMinutes
                });
            }
            return output.sort((a, b) => String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'nl'));
        },

        async employeePublishedMinutes(employeeId, from, to) {
            const shifts = await QueryService.getEmployeePublishedRoster(employeeId, from, to);
            return shifts.reduce((total, shift) => total + durationMinutes(shift.startsAtUtc, shift.endsAtUtc), 0);
        },

        durationMinutes
    };

    async function employmentState(employeeId, dateString) {
        return get(db, `SELECT id, employment_type AS employmentType, starts_on AS startsOn,
            ends_on AS endsOn, known_from AS knownFrom
            FROM employment_periods
            WHERE employee_id=?
              AND date(known_from) <= date(?)
              AND (starts_on IS NULL OR date(starts_on) <= date(?))
              AND (ends_on IS NULL OR date(ends_on) >= date(?))
            ORDER BY known_from DESC, id DESC LIMIT 1`, [employeeId, dateString, dateString, dateString]);
    }

    async function locationEligibility(employeeId, locationId, dateString) {
        return get(db, `SELECT id, is_primary AS isPrimary, can_be_scheduled AS canBeScheduled
            FROM employee_location_eligibility
            WHERE employee_id=? AND location_id=?
              AND date(effective_from) <= date(?)
              AND (effective_to IS NULL OR date(effective_to) >= date(?))
            ORDER BY effective_from DESC LIMIT 1`, [employeeId, locationId, dateString, dateString]);
    }

    async function availabilitySlots() {
        return all(db, `SELECT code, label, start_time AS startTime, end_time AS endTime, sort_order AS sortOrder
            FROM availability_slots WHERE is_active=1 ORDER BY sort_order, code`);
    }

    async function resolveAvailability(shift) {
        if (!shift.employeeId) return { state: 'not_applicable', slot: null, source: null };
        const localStart = utcToLocal(shift.startsAtUtc, shift.timezone || DEFAULT_TIMEZONE);
        const localEnd = utcToLocal(shift.endsAtUtc, shift.timezone || DEFAULT_TIMEZONE);
        if (localStart.date !== localEnd.date) {
            return { state: 'unknown', slot: null, source: 'overnight' };
        }
        const startMinutes = minutesFromTime(localStart.time);
        const endMinutes = minutesFromTime(localEnd.time);
        const slots = (await availabilitySlots()).filter((slot) => {
            const slotStart = minutesFromTime(slot.startTime);
            const slotEnd = minutesFromTime(slot.endTime);
            return startMinutes >= slotStart && endMinutes <= slotEnd;
        }).sort((a, b) => {
            if (localStart.weekday >= 6) {
                if (a.code === 'WEEKEND_MORNING' && b.code !== 'WEEKEND_MORNING') return -1;
                if (b.code === 'WEEKEND_MORNING' && a.code !== 'WEEKEND_MORNING') return 1;
            }
            const aDuration = minutesFromTime(a.endTime) - minutesFromTime(a.startTime);
            const bDuration = minutesFromTime(b.endTime) - minutesFromTime(b.startTime);
            return aDuration - bDuration || a.sortOrder - b.sortOrder;
        });
        const slot = slots[0] || null;
        if (!slot) return { state: 'unknown', slot: null, source: 'no_matching_slot' };

        const exception = await get(db, `SELECT availability_state AS state, reason, note
            FROM employee_availability_exceptions
            WHERE employee_id=? AND availability_date=? AND slot_code=?
            LIMIT 1`, [shift.employeeId, localStart.date, slot.code]);
        if (exception) return { state: exception.state, slot, source: 'exception', detail: exception };

        const pattern = await get(db, `SELECT availability_state AS state, note
            FROM employee_availability_patterns
            WHERE employee_id=? AND weekday=? AND slot_code=?
              AND date(effective_from) <= date(?)
              AND (effective_to IS NULL OR date(effective_to) >= date(?))
            ORDER BY effective_from DESC LIMIT 1`, [
            shift.employeeId, localStart.weekday, slot.code, localStart.date, localStart.date
        ]);
        if (pattern) return { state: pattern.state, slot, source: 'pattern', detail: pattern };
        return { state: 'unknown', slot, source: 'missing' };
    }

    const ValidationService = {
        async validateVersion(versionId) {
            const info = await versionInfo(db, versionId);
            if (!info) throw domainError('Roosterversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
            const errors = [];
            const warnings = [];
            const information = [];
            const candidateShifts = await versionShifts(db, versionId);
            const projected = await projectedWeekShifts(info.weekStart, [versionId]);

            const employeeShifts = new Map();
            for (const shift of projected) {
                if (!shift.employeeId) continue;
                if (!employeeShifts.has(shift.employeeId)) employeeShifts.set(shift.employeeId, []);
                employeeShifts.get(shift.employeeId).push(shift);
            }
            for (const [employeeId, shifts] of employeeShifts.entries()) {
                const sorted = shifts.sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc));
                for (let i = 0; i < sorted.length; i += 1) {
                    for (let j = i + 1; j < sorted.length; j += 1) {
                        if (sorted[j].startsAtUtc >= sorted[i].endsAtUtc) break;
                        errors.push({
                            code: 'SHIFT_OVERLAP',
                            employeeId,
                            employeeName: sorted[i].employeeName || sorted[j].employeeName || null,
                            shiftUid: sorted[i].shiftUid,
                            conflictingShiftUid: sorted[j].shiftUid,
                            message: 'Medewerker heeft overlappende diensten.'
                        });
                    }
                }
            }

            for (const shift of candidateShifts) {
                if (!shift.employeeId) {
                    warnings.push({
                        code: 'OPEN_SHIFT',
                        shiftUid: shift.shiftUid,
                        message: 'Deze dienst is nog open.'
                    });
                    continue;
                }
                const local = utcToLocal(shift.startsAtUtc, shift.timezone || DEFAULT_TIMEZONE);
                const employment = await employmentState(shift.employeeId, local.date);
                if (!employment) {
                    errors.push({
                        code: 'NOT_EMPLOYED',
                        shiftUid: shift.shiftUid,
                        employeeId: shift.employeeId,
                        employeeName: shift.employeeName,
                        message: 'Medewerker heeft op deze datum geen geldig dienstverband in de masterdata.'
                    });
                }

                const eligible = await locationEligibility(shift.employeeId, shift.locationId, local.date);
                if (!eligible || !eligible.canBeScheduled) {
                    warnings.push({
                        code: 'LOCATION_ELIGIBILITY',
                        shiftUid: shift.shiftUid,
                        employeeId: shift.employeeId,
                        employeeName: shift.employeeName,
                        locationId: shift.locationId,
                        message: 'Dienst ligt buiten de structureel vastgelegde vestigingsinzetbaarheid.'
                    });
                }

                const availability = await resolveAvailability(shift);
                if (availability.state === 'unavailable') {
                    warnings.push({
                        code: 'AVAILABILITY_EXCEPTION',
                        shiftUid: shift.shiftUid,
                        employeeId: shift.employeeId,
                        employeeName: shift.employeeName,
                        slotCode: availability.slot?.code || null,
                        source: availability.source,
                        message: 'Dienst wijkt af van de vastgelegde beschikbaarheid.'
                    });
                } else if (availability.state === 'unknown') {
                    warnings.push({
                        code: 'AVAILABILITY_UNKNOWN',
                        shiftUid: shift.shiftUid,
                        employeeId: shift.employeeId,
                        employeeName: shift.employeeName,
                        slotCode: availability.slot?.code || null,
                        source: availability.source,
                        message: 'Beschikbaarheid voor deze dienst is nog niet vastgelegd.'
                    });
                }
            }

            const hourBank = await HoursService.projectedWeekMinutes({
                weekStart: info.weekStart,
                candidateVersionIds: [versionId]
            });
            information.push({
                code: 'HOUR_BANK_PROJECTION',
                message: 'Contractafwijkingen blokkeren niet en worden als urenbankprojectie teruggegeven.',
                employees: hourBank
            });

            return {
                versionId,
                periodId: info.periodId,
                weekStart: info.weekStart,
                locationId: info.locationId,
                valid: errors.length === 0,
                errors,
                warnings,
                information,
                staffing: null
            };
        },

        async resolveAvailability(shift) {
            return resolveAvailability(shift);
        }
    };

    async function diffVersions(beforeVersionId, afterVersionId) {
        const beforeRows = beforeVersionId ? await versionShifts(db, beforeVersionId) : [];
        const afterRows = afterVersionId ? await versionShifts(db, afterVersionId) : [];
        const before = new Map(beforeRows.map((row) => [row.shiftUid, row]));
        const after = new Map(afterRows.map((row) => [row.shiftUid, row]));
        const changes = [];

        for (const [shiftUid, row] of after.entries()) {
            if (!before.has(shiftUid)) {
                changes.push({ shiftUid, changeType: 'added', before: null, after: comparableShift(row) });
            } else if (!shiftsEqual(before.get(shiftUid), row)) {
                changes.push({
                    shiftUid,
                    changeType: 'modified',
                    before: comparableShift(before.get(shiftUid)),
                    after: comparableShift(row)
                });
            }
        }
        for (const [shiftUid, row] of before.entries()) {
            if (!after.has(shiftUid)) {
                changes.push({ shiftUid, changeType: 'removed', before: comparableShift(row), after: null });
            }
        }
        return changes;
    }

    const PublicationService = {
        async prepare(versionIds) {
            const uniqueIds = [...new Set(versionIds.map(Number))];
            if (!uniqueIds.length || uniqueIds.some((id) => !Number.isInteger(id) || id <= 0)) {
                throw domainError('Geef minimaal één geldige conceptversie op.', 'INVALID_PUBLICATION_VERSIONS');
            }
            const items = [];
            for (const versionId of uniqueIds) {
                const info = await versionInfo(db, versionId);
                if (!info) throw domainError('Roosterversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
                if (info.state !== 'draft') throw domainError('Alleen conceptversies kunnen worden gepubliceerd.', 'VERSION_NOT_DRAFT', 409);
                const validation = await ValidationService.validateVersion(versionId);
                const diff = await diffVersions(info.basedOnVersionId, versionId);
                items.push({ version: info, validation, diff });
            }
            return {
                canPublish: items.every((item) => item.validation.valid),
                items
            };
        },

        async publish({ versionIds, actorUserId, reason = null }) {
            await AuthorizationService.assertCanPublish(actorUserId);
            const prepared = await this.prepare(versionIds);
            if (!prepared.canPublish) {
                throw domainError('Publicatie bevat blokkerende roosterconflicten.', 'ROSTER_VALIDATION_FAILED', 409, prepared);
            }
            const isRepublish = prepared.items.some((item) => Boolean(item.version.basedOnVersionId));
            if (isRepublish && !String(reason || '').trim()) {
                throw domainError('Een wijziging na eerdere publicatie vereist een reden.', 'PUBLICATION_REASON_REQUIRED');
            }
            const uid = publicationUid();
            const correlationId = crypto.randomUUID();

            return withImmediateTransaction(db, async () => {
                const publication = await run(db, `INSERT INTO roster_publications
                    (publication_uid, published_by_user_id, note, notification_state)
                    VALUES (?, ?, ?, 'pending')`, [uid, actorUserId, reason || null]);

                for (const item of prepared.items) {
                    const result = await run(db, `UPDATE roster_versions
                        SET state='published', published_by_user_id=?, published_at=CURRENT_TIMESTAMP,
                            change_note=COALESCE(?, change_note)
                        WHERE id=? AND state='draft'`, [actorUserId, reason || null, item.version.id]);
                    if (result.changes !== 1) {
                        throw domainError('Een concept is tijdens publicatie gewijzigd.', 'ROSTER_VERSION_CONFLICT', 409);
                    }
                    await run(db, `INSERT INTO roster_publication_versions (publication_id, version_id)
                        VALUES (?, ?)`, [publication.lastID, item.version.id]);
                    for (const change of item.diff) {
                        await run(db, `INSERT INTO roster_publication_changes
                            (publication_id, period_id, shift_uid, change_type, before_json, after_json, reason, cml_visible)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 1)`, [
                            publication.lastID,
                            item.version.periodId,
                            change.shiftUid,
                            change.changeType,
                            json(change.before),
                            json(change.after),
                            reason || null
                        ]);
                    }
                    await audit(db, {
                        actorUserId,
                        entityType: 'roster_version',
                        entityId: item.version.id,
                        action: 'published',
                        before: { state: 'draft', revision: item.version.revision },
                        after: { state: 'published', publicationId: publication.lastID },
                        note: reason,
                        correlationId,
                        cmlVisible: item.diff.length > 0
                    });
                }

                return {
                    publicationId: publication.lastID,
                    publicationUid: uid,
                    correlationId,
                    versions: prepared.items.map((item) => ({
                        versionId: item.version.id,
                        periodId: item.version.periodId,
                        locationId: item.version.locationId,
                        weekStart: item.version.weekStart,
                        warnings: item.validation.warnings,
                        changeCount: item.diff.length
                    }))
                };
            });
        },

        diffVersions
    };

    return {
        ready,
        AuthorizationService,
        DraftService,
        HoursService,
        PatternService,
        PublicationService,
        QueryService,
        ValidationService,
        helpers: {
            addDays,
            durationMinutes,
            localDateTimeToUtc,
            mondayOf,
            stablePatternShiftUid,
            utcToLocal
        }
    };
}

module.exports = {
    DEFAULT_TIMEZONE,
    addDays,
    createRosterDomain,
    durationMinutes,
    ensureRosterDomainSchema,
    localDateTimeToUtc,
    migrateRosterDomain,
    mondayOf,
    stablePatternShiftUid,
    utcToLocal
};
