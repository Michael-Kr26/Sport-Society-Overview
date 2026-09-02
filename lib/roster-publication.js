'use strict';

const {
    all,
    exec,
    get,
    run
} = require('./roster-data');
const {
    addDays,
    createRosterDomain,
    mondayOf,
    utcToLocal
} = require('./roster-domain');

const DEFAULT_TIMEZONE = 'Europe/Amsterdam';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function publicationError(message, code, status = 400, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details !== null) error.details = details;
    return error;
}

function assertWeekStart(value) {
    const text = String(value || '');
    if (!ISO_DATE_RE.test(text) || mondayOf(text) !== text) {
        throw publicationError('Een publicatiehorizon moet op een geldige maandag beginnen.', 'INVALID_WEEK_START');
    }
    return text;
}

function json(value) {
    return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
}

function amsterdamToday() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: DEFAULT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date()).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

async function tableExists(db, tableName) {
    return Boolean(await get(db, "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [tableName]));
}

async function ensureRosterPublicationSchema(db) {
    await exec(db, `
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS roster_publication_cml_links (
            publication_id INTEGER NOT NULL,
            period_id INTEGER NOT NULL,
            change_id INTEGER NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (publication_id, period_id),
            FOREIGN KEY (publication_id) REFERENCES roster_publications(id) ON DELETE CASCADE,
            FOREIGN KEY (period_id) REFERENCES roster_periods(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS roster_notification_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            publication_id INTEGER NOT NULL,
            period_id INTEGER NOT NULL,
            employee_id INTEGER NOT NULL,
            event_type TEXT NOT NULL CHECK (event_type IN ('roster_published', 'roster_changed')),
            payload_json TEXT NOT NULL,
            delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'sent', 'failed')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            sent_at TEXT,
            error_message TEXT,
            FOREIGN KEY (publication_id) REFERENCES roster_publications(id) ON DELETE CASCADE,
            FOREIGN KEY (period_id) REFERENCES roster_periods(id) ON DELETE CASCADE,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            UNIQUE (publication_id, period_id, employee_id, event_type)
        );

        CREATE INDEX IF NOT EXISTS idx_roster_notification_outbox_state
            ON roster_notification_outbox(delivery_state, created_at);
        CREATE INDEX IF NOT EXISTS idx_roster_publication_cml_links_publication
            ON roster_publication_cml_links(publication_id, period_id);
    `);

    if (await tableExists(db, 'changes')) {
        await exec(db, `
            CREATE TRIGGER IF NOT EXISTS changes_no_update_roster_publication
            BEFORE UPDATE ON changes
            WHEN OLD.change_type='Roosterpublicatie'
            BEGIN
                SELECT RAISE(ABORT, 'roster publication CML row is immutable');
            END;

            CREATE TRIGGER IF NOT EXISTS changes_no_delete_roster_publication
            BEFORE DELETE ON changes
            WHEN OLD.change_type='Roosterpublicatie'
            BEGIN
                SELECT RAISE(ABORT, 'roster publication CML row is immutable');
            END;
        `);
    }
}

async function migrateRosterPublication(db) {
    await ensureRosterPublicationSchema(db);
    return {
        cmlLinks: Number((await get(db, 'SELECT COUNT(*) AS count FROM roster_publication_cml_links'))?.count || 0),
        pendingNotifications: Number((await get(db, "SELECT COUNT(*) AS count FROM roster_notification_outbox WHERE delivery_state='pending'"))?.count || 0)
    };
}

function diffCounts(diff) {
    return diff.reduce((counts, change) => {
        if (change.changeType === 'added') counts.added += 1;
        if (change.changeType === 'modified') counts.modified += 1;
        if (change.changeType === 'removed') counts.removed += 1;
        return counts;
    }, { added: 0, modified: 0, removed: 0 });
}

async function createRosterPublicationWorkflow(db) {
    if (!db) throw new TypeError('db is verplicht');
    const domain = createRosterDomain(db);
    await domain.ready;
    await ensureRosterPublicationSchema(db);

    async function settings() {
        return get(db, `SELECT
            minimum_published_horizon_weeks AS minimumPublishedHorizonWeeks,
            target_published_horizon_weeks AS targetPublishedHorizonWeeks,
            generation_horizon_weeks AS generationHorizonWeeks
            FROM roster_settings WHERE id=1`);
    }

    async function versionDescriptor(versionId) {
        return get(db, `SELECT
            v.id,
            v.period_id AS periodId,
            v.version_no AS versionNo,
            v.state,
            v.based_on_version_id AS basedOnVersionId,
            v.revision,
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

    async function employeeName(employeeId, cache) {
        if (!employeeId) return null;
        if (cache.has(employeeId)) return cache.get(employeeId);
        const row = await get(db, 'SELECT display_name AS displayName FROM employees WHERE id=?', [employeeId]);
        const value = row?.displayName || null;
        cache.set(employeeId, value);
        return value;
    }

    async function describeComparableShift(shift, timezone, cache) {
        if (!shift) return null;
        const start = utcToLocal(shift.startsAtUtc, timezone || DEFAULT_TIMEZONE);
        const end = utcToLocal(shift.endsAtUtc, timezone || DEFAULT_TIMEZONE);
        return {
            shiftUid: shift.shiftUid,
            employeeId: shift.employeeId ?? null,
            employeeName: await employeeName(shift.employeeId, cache),
            date: start.date,
            startTime: start.time,
            endDate: end.date,
            endTime: end.time,
            shiftType: shift.shiftType,
            note: shift.note || null
        };
    }

    async function decoratePreparedItem(item) {
        const cache = new Map();
        const counts = diffCounts(item.diff);
        const changes = [];
        for (const change of item.diff) {
            changes.push({
                shiftUid: change.shiftUid,
                changeType: change.changeType,
                before: await describeComparableShift(change.before, item.version.timezone, cache),
                after: await describeComparableShift(change.after, item.version.timezone, cache)
            });
        }
        return {
            version: item.version,
            validation: item.validation,
            diffCounts: counts,
            changeCount: item.diff.length,
            changes
        };
    }

    async function publishedExists(locationId, weekStart) {
        return Boolean(await get(db, `SELECT 1 AS present
            FROM roster_periods p
            INNER JOIN roster_versions v ON v.period_id=p.id AND v.state='published'
            WHERE p.location_id=? AND p.week_start=?
            LIMIT 1`, [locationId, weekStart]));
    }

    async function horizon({ referenceWeekStart, candidateVersionIds = [] }) {
        const start = assertWeekStart(referenceWeekStart);
        const config = await settings();
        const candidateKeys = new Set();
        for (const rawId of candidateVersionIds) {
            const version = await versionDescriptor(Number(rawId));
            if (version?.state === 'draft') candidateKeys.add(`${version.locationId}|${version.weekStart}`);
        }
        const locations = await all(db, `SELECT id, code, name, sort_order AS sortOrder
            FROM locations WHERE is_active=1 ORDER BY sort_order, name`);
        const items = [];
        for (const location of locations) {
            let futurePublishedWeeks = 0;
            for (let offset = 1; offset <= Number(config.generationHorizonWeeks); offset += 1) {
                const weekStart = addDays(start, offset * 7);
                const projected = candidateKeys.has(`${location.id}|${weekStart}`)
                    || await publishedExists(location.id, weekStart);
                if (!projected) break;
                futurePublishedWeeks += 1;
            }
            const status = futurePublishedWeeks >= Number(config.targetPublishedHorizonWeeks)
                ? 'target'
                : futurePublishedWeeks >= Number(config.minimumPublishedHorizonWeeks)
                    ? 'minimum'
                    : 'critical';
            items.push({
                ...location,
                futurePublishedWeeks,
                publishedThrough: futurePublishedWeeks ? addDays(start, futurePublishedWeeks * 7) : null,
                status,
                missingToMinimum: Math.max(0, Number(config.minimumPublishedHorizonWeeks) - futurePublishedWeeks),
                missingToTarget: Math.max(0, Number(config.targetPublishedHorizonWeeks) - futurePublishedWeeks)
            });
        }
        return { referenceWeekStart: start, settings: config, locations: items };
    }

    async function listCandidates({ actorUserId, fromWeekStart, weeks = null }) {
        await domain.AuthorizationService.assertCanPublish(actorUserId);
        const start = assertWeekStart(fromWeekStart);
        const config = await settings();
        const requestedWeeks = weeks === null ? Number(config.generationHorizonWeeks) : Number(weeks);
        const count = Math.min(Math.max(1, requestedWeeks), Number(config.generationHorizonWeeks));
        const end = addDays(start, count * 7 - 1);
        const rows = await all(db, `SELECT
            v.id AS versionId,
            v.version_no AS versionNo,
            v.revision,
            v.based_on_version_id AS basedOnVersionId,
            p.id AS periodId,
            p.location_id AS locationId,
            p.week_start AS weekStart,
            p.week_end AS weekEnd,
            l.code AS locationCode,
            l.name AS locationName,
            l.sort_order AS locationSortOrder
            FROM roster_versions v
            INNER JOIN roster_periods p ON p.id=v.period_id
            INNER JOIN locations l ON l.id=p.location_id
            WHERE v.state='draft'
              AND date(p.week_start) >= date(?)
              AND date(p.week_start) <= date(?)
            ORDER BY p.week_start, l.sort_order, v.version_no`, [start, end]);
        const output = [];
        for (const row of rows) {
            const prepared = await domain.PublicationService.prepare([row.versionId]);
            const item = prepared.items[0];
            output.push({
                ...row,
                valid: item.validation.valid,
                errorCount: item.validation.errors.length,
                warningCount: item.validation.warnings.length,
                changeCount: item.diff.length,
                diffCounts: diffCounts(item.diff),
                reasonRequired: Boolean(row.basedOnVersionId)
            });
        }
        return {
            fromWeekStart: start,
            throughWeekStart: addDays(start, (count - 1) * 7),
            weeks: count,
            items: output,
            horizon: await horizon({ referenceWeekStart: start })
        };
    }

    async function prepare({ actorUserId, versionIds, referenceWeekStart }) {
        await domain.AuthorizationService.assertCanPublish(actorUserId);
        const ids = [...new Set((versionIds || []).map(Number))];
        const prepared = await domain.PublicationService.prepare(ids);
        const items = [];
        for (const item of prepared.items) items.push(await decoratePreparedItem(item));
        return {
            canPublish: prepared.canPublish,
            reasonRequired: items.some((item) => Boolean(item.version.basedOnVersionId)),
            totals: items.reduce((totals, item) => {
                totals.versions += 1;
                totals.changes += item.changeCount;
                totals.errors += item.validation.errors.length;
                totals.warnings += item.validation.warnings.length;
                totals.added += item.diffCounts.added;
                totals.modified += item.diffCounts.modified;
                totals.removed += item.diffCounts.removed;
                return totals;
            }, { versions: 0, changes: 0, errors: 0, warnings: 0, added: 0, modified: 0, removed: 0 }),
            items,
            horizonAfter: await horizon({
                referenceWeekStart: assertWeekStart(referenceWeekStart),
                candidateVersionIds: ids
            })
        };
    }

    async function publicationVersionRows(publicationId) {
        return all(db, `SELECT
            pv.version_id AS versionId,
            v.based_on_version_id AS basedOnVersionId,
            p.id AS periodId,
            p.week_start AS weekStart,
            p.location_id AS locationId,
            l.code AS locationCode,
            l.name AS locationName,
            l.timezone
            FROM roster_publication_versions pv
            INNER JOIN roster_versions v ON v.id=pv.version_id
            INNER JOIN roster_periods p ON p.id=v.period_id
            INNER JOIN locations l ON l.id=p.location_id
            WHERE pv.publication_id=?
            ORDER BY p.week_start, l.sort_order`, [publicationId]);
    }

    async function publicationChanges(publicationId, periodId = null) {
        const params = [publicationId];
        let where = 'WHERE publication_id=?';
        if (periodId) {
            where += ' AND period_id=?';
            params.push(periodId);
        }
        const rows = await all(db, `SELECT id, period_id AS periodId, shift_uid AS shiftUid,
            change_type AS changeType, before_json AS beforeJson, after_json AS afterJson,
            reason, cml_visible AS cmlVisible
            FROM roster_publication_changes ${where}
            ORDER BY id`, params);
        return rows.map((row) => ({
            ...row,
            cmlVisible: Boolean(row.cmlVisible),
            before: parseJson(row.beforeJson),
            after: parseJson(row.afterJson)
        }));
    }

    async function actorName(actorUserId) {
        const row = await get(db, 'SELECT display_name AS displayName, username FROM users WHERE id=?', [actorUserId]);
        return row?.displayName || row?.username || 'Admin';
    }

    async function cmlProjection(publicationId, actorUserId, reason) {
        if (!await tableExists(db, 'changes')) return { status: 'skipped', created: 0, reason: 'changes_table_missing' };
        await ensureRosterPublicationSchema(db);
        const actor = await actorName(actorUserId);
        const periods = await publicationVersionRows(publicationId);
        let created = 0;
        for (const period of periods) {
            if (!period.basedOnVersionId) continue;
            const existing = await get(db, `SELECT change_id AS changeId FROM roster_publication_cml_links
                WHERE publication_id=? AND period_id=?`, [publicationId, period.periodId]);
            if (existing) continue;
            const changes = await publicationChanges(publicationId, period.periodId);
            if (!changes.length) continue;
            const counts = diffCounts(changes);
            const employeeIds = new Set();
            for (const change of changes) {
                if (change.before?.employeeId) employeeIds.add(change.before.employeeId);
                if (change.after?.employeeId) employeeIds.add(change.after.employeeId);
            }
            const names = [];
            const cache = new Map();
            for (const employeeId of employeeIds) {
                const name = await employeeName(employeeId, cache);
                if (name) names.push(name);
            }
            const employee = names.length === 1 ? names[0] : (names.length > 1 ? 'Meerdere medewerkers' : 'Open dienst');
            const summary = `${counts.added} toegevoegd, ${counts.modified} gewijzigd, ${counts.removed} verwijderd.`;
            const detail = [String(reason || '').trim(), `Publicatieverschil: ${summary}`].filter(Boolean).join(' ');
            const result = await run(db, `INSERT INTO changes (
                change_date, reported_date, location, employee_1, employee_2,
                change_type, reason, status, created_by
                ) VALUES (?, ?, ?, ?, '', 'Roosterpublicatie', ?, 'Afgerond', ?)`, [
                period.weekStart,
                amsterdamToday(),
                period.locationName,
                employee,
                detail,
                actor
            ]);
            await run(db, `INSERT INTO roster_publication_cml_links (publication_id, period_id, change_id)
                VALUES (?, ?, ?)`, [publicationId, period.periodId, result.lastID]);
            created += 1;
        }
        return { status: 'complete', created };
    }

    async function notificationProjection(publicationId) {
        const periods = await publicationVersionRows(publicationId);
        let queued = 0;
        for (const period of periods) {
            const changes = await publicationChanges(publicationId, period.periodId);
            const employeeIds = new Set();
            for (const change of changes) {
                if (period.basedOnVersionId) {
                    if (change.before?.employeeId) employeeIds.add(change.before.employeeId);
                    if (change.after?.employeeId) employeeIds.add(change.after.employeeId);
                } else if (change.after?.employeeId) {
                    employeeIds.add(change.after.employeeId);
                }
            }
            const eventType = period.basedOnVersionId ? 'roster_changed' : 'roster_published';
            for (const employeeId of employeeIds) {
                const result = await run(db, `INSERT OR IGNORE INTO roster_notification_outbox
                    (publication_id, period_id, employee_id, event_type, payload_json)
                    VALUES (?, ?, ?, ?, ?)`, [
                    publicationId,
                    period.periodId,
                    employeeId,
                    eventType,
                    json({
                        publicationId,
                        versionId: period.versionId,
                        locationCode: period.locationCode,
                        locationName: period.locationName,
                        weekStart: period.weekStart,
                        eventType
                    })
                ]);
                queued += result.changes;
            }
        }
        return { status: queued ? 'pending' : 'complete', queued };
    }

    async function projectSideEffects(publicationId, actorUserId, reason, { projectCml = true } = {}) {
        try {
            await exec(db, 'BEGIN IMMEDIATE TRANSACTION;');
            const cml = projectCml
                ? await cmlProjection(publicationId, actorUserId, reason)
                : { status: 'skipped', created: 0, reason: 'already_recorded_by_change_workflow' };
            const notifications = await notificationProjection(publicationId);
            await run(db, `UPDATE roster_publications SET notification_state=? WHERE id=?`, [
                notifications.status === 'pending' ? 'pending' : 'complete',
                publicationId
            ]);
            await exec(db, 'COMMIT;');
            return { status: 'complete', cml, notifications };
        } catch (error) {
            await exec(db, 'ROLLBACK;').catch(() => {});
            await run(db, "UPDATE roster_publications SET notification_state='failed' WHERE id=?", [publicationId]).catch(() => {});
            return { status: 'failed', message: error.message };
        }
    }

    async function publish({ actorUserId, versionIds, reason = null, referenceWeekStart, projectCml = true }) {
        await domain.AuthorizationService.assertCanPublish(actorUserId);
        const preview = await prepare({ actorUserId, versionIds, referenceWeekStart });
        if (!preview.canPublish) {
            throw publicationError('Publicatie bevat blokkerende roosterconflicten.', 'ROSTER_VALIDATION_FAILED', 409, preview);
        }
        if (preview.reasonRequired && !String(reason || '').trim()) {
            throw publicationError('Een wijziging na eerdere publicatie vereist een reden.', 'PUBLICATION_REASON_REQUIRED');
        }
        const result = await domain.PublicationService.publish({
            versionIds,
            actorUserId,
            reason: String(reason || '').trim() || null
        });
        const sideEffects = await projectSideEffects(result.publicationId, actorUserId, reason, { projectCml });
        return {
            ...result,
            sideEffects,
            horizonAfter: await horizon({ referenceWeekStart: assertWeekStart(referenceWeekStart) })
        };
    }

    async function history({ limit = 20, locationId = null, weekStart = null } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const params = [];
        let periodFilter = '';
        if (locationId) {
            periodFilter += ' AND p.location_id=?';
            params.push(Number(locationId));
        }
        if (weekStart) {
            periodFilter += ' AND p.week_start=?';
            params.push(assertWeekStart(weekStart));
        }
        params.push(safeLimit);
        const rows = await all(db, `SELECT
            rp.id AS publicationId,
            rp.publication_uid AS publicationUid,
            rp.published_at AS publishedAt,
            rp.note,
            rp.notification_state AS notificationState,
            u.display_name AS publishedBy,
            COUNT(DISTINCT pv.version_id) AS versionCount,
            COUNT(rpc.id) AS changeCount
            FROM roster_publications rp
            INNER JOIN users u ON u.id=rp.published_by_user_id
            INNER JOIN roster_publication_versions pv ON pv.publication_id=rp.id
            INNER JOIN roster_versions v ON v.id=pv.version_id
            INNER JOIN roster_periods p ON p.id=v.period_id
            LEFT JOIN roster_publication_changes rpc ON rpc.publication_id=rp.id AND rpc.period_id=p.id
            WHERE 1=1 ${periodFilter}
            GROUP BY rp.id
            ORDER BY rp.published_at DESC, rp.id DESC
            LIMIT ?`, params);
        return rows.map((row) => ({
            ...row,
            versionCount: Number(row.versionCount),
            changeCount: Number(row.changeCount)
        }));
    }

    return {
        domain,
        ensureSchema: () => ensureRosterPublicationSchema(db),
        horizon,
        listCandidates,
        prepare,
        publish,
        history,
        publicationChanges
    };
}

module.exports = {
    createRosterPublicationWorkflow,
    ensureRosterPublicationSchema,
    migrateRosterPublication
};
