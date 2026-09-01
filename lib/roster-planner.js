'use strict';

const {
    all,
    get
} = require('./roster-data');
const {
    addDays,
    createRosterDomain,
    durationMinutes,
    localDateTimeToUtc,
    mondayOf,
    utcToLocal
} = require('./roster-domain');

const PLANNING_BASELINE = '2026-09-01';
const SHIFT_TYPE_LABELS = {
    floor: 'Vloer',
    administration: 'Administratie',
    internship: 'Stage'
};
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function plannerError(message, code, status = 400, details = null) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details !== null) error.details = details;
    return error;
}

function assertIsoDate(value, field = 'datum') {
    const text = String(value || '');
    if (!ISO_DATE_RE.test(text)) throw plannerError(`Ongeldige ${field}.`, 'INVALID_DATE');
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw plannerError(`Ongeldige ${field}.`, 'INVALID_DATE');
    }
    return text;
}

function assertWeekStart(weekStart) {
    assertIsoDate(weekStart, 'weekstart');
    if (mondayOf(weekStart) !== weekStart) {
        throw plannerError('Een roosterweek moet op maandag beginnen.', 'INVALID_WEEK_START');
    }
    return weekStart;
}

function assertTime(value, field) {
    const text = String(value || '');
    if (!TIME_RE.test(text)) throw plannerError(`Ongeldige ${field}.`, 'INVALID_TIME');
    return text;
}

function timeMinutes(value) {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
}

function isoWeekNumber(dateString) {
    const date = new Date(`${dateString}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function normalizeLocationCode(value) {
    return String(value || '').trim().toUpperCase();
}

function localShift(row) {
    const timezone = row.timezone || 'Europe/Amsterdam';
    const start = utcToLocal(row.startsAtUtc, timezone);
    const end = utcToLocal(row.endsAtUtc, timezone);
    return {
        id: row.id,
        shiftUid: row.shiftUid,
        versionId: row.versionId,
        employeeId: row.employeeId ?? null,
        employeeCode: row.employeeCode || null,
        employeeName: row.employeeName || null,
        open: row.employeeId === null || row.employeeId === undefined,
        locationId: row.locationId,
        locationCode: row.locationCode,
        locationName: row.locationName,
        timezone,
        date: start.date,
        startTime: start.time,
        endDate: end.date,
        endTime: end.time,
        crossesMidnight: start.date !== end.date,
        startsAtUtc: row.startsAtUtc,
        endsAtUtc: row.endsAtUtc,
        plannedMinutes: durationMinutes(row.startsAtUtc, row.endsAtUtc),
        shiftType: row.shiftType,
        shiftTypeLabel: SHIFT_TYPE_LABELS[row.shiftType] || row.shiftType,
        sourcePatternId: row.sourcePatternId ?? null,
        sourcePatternRevision: row.sourcePatternRevision ?? null,
        note: row.note || null,
        legacySourceHash: row.legacySourceHash || null
    };
}

function summarizeShifts(shifts) {
    return {
        shiftCount: shifts.length,
        openShiftCount: shifts.filter((shift) => shift.open).length,
        plannedMinutes: shifts.reduce((sum, shift) => sum + shift.plannedMinutes, 0),
        floorMinutes: shifts.filter((shift) => shift.shiftType === 'floor')
            .reduce((sum, shift) => sum + shift.plannedMinutes, 0),
        administrationMinutes: shifts.filter((shift) => shift.shiftType === 'administration')
            .reduce((sum, shift) => sum + shift.plannedMinutes, 0),
        internshipMinutes: shifts.filter((shift) => shift.shiftType === 'internship')
            .reduce((sum, shift) => sum + shift.plannedMinutes, 0)
    };
}

function normalizeRequestedView(requestedView, canEdit, hasDraft) {
    if (requestedView === 'published') return 'published';
    if (requestedView === 'draft' && canEdit) return 'draft';
    if (canEdit && hasDraft) return 'draft';
    return 'published';
}

function normalizeEmployeeId(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw plannerError('Ongeldige medewerker.', 'INVALID_EMPLOYEE');
    }
    return parsed;
}

async function activeEmployeesForWeek(db, locationId, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const employees = await all(db, `SELECT
        e.id AS employeeId,
        e.employee_code AS employeeCode,
        e.display_name AS employeeName,
        (
            SELECT ep.employment_type
            FROM employment_periods ep
            WHERE ep.employee_id=e.id
              AND date(ep.known_from) <= date(?)
              AND (ep.starts_on IS NULL OR date(ep.starts_on) <= date(?))
              AND (ep.ends_on IS NULL OR date(ep.ends_on) >= date(?))
            ORDER BY ep.known_from DESC, ep.id DESC LIMIT 1
        ) AS employmentType,
        (
            SELECT ct.weekly_minutes
            FROM employment_periods ep
            INNER JOIN contract_terms ct ON ct.employment_period_id=ep.id
            WHERE ep.employee_id=e.id
              AND date(ep.known_from) <= date(?)
              AND date(ct.effective_from) <= date(?)
              AND (ct.effective_to IS NULL OR date(ct.effective_to) >= date(?))
            ORDER BY ct.effective_from DESC, ct.id DESC LIMIT 1
        ) AS contractMinutes,
        EXISTS (
            SELECT 1 FROM employee_location_eligibility el
            WHERE el.employee_id=e.id AND el.location_id=? AND el.can_be_scheduled=1
              AND date(el.effective_from) <= date(?)
              AND (el.effective_to IS NULL OR date(el.effective_to) >= date(?))
        ) AS eligibleAtLocation,
        (
            SELECT l.code
            FROM employee_location_eligibility el
            INNER JOIN locations l ON l.id=el.location_id
            WHERE el.employee_id=e.id AND el.is_primary=1
              AND date(el.effective_from) <= date(?)
              AND (el.effective_to IS NULL OR date(el.effective_to) >= date(?))
            ORDER BY el.effective_from DESC LIMIT 1
        ) AS primaryLocationCode
        FROM employees e
        WHERE e.archived_at IS NULL
          AND EXISTS (
              SELECT 1 FROM employment_periods ep
              WHERE ep.employee_id=e.id
                AND date(ep.known_from) <= date(?)
                AND (ep.starts_on IS NULL OR date(ep.starts_on) <= date(?))
                AND (ep.ends_on IS NULL OR date(ep.ends_on) >= date(?))
          )
        ORDER BY eligibleAtLocation DESC, LOWER(e.display_name)`, [
        weekEnd, weekEnd, weekStart,
        weekEnd, weekEnd, weekStart,
        locationId, weekEnd, weekStart,
        weekEnd, weekStart,
        weekEnd, weekEnd, weekStart
    ]);
    return employees.map((employee) => ({
        ...employee,
        contractMinutes: employee.contractMinutes === null || employee.contractMinutes === undefined
            ? null : Number(employee.contractMinutes),
        eligibleAtLocation: Boolean(employee.eligibleAtLocation)
    }));
}

async function createRosterPlanner(db) {
    if (!db) throw new TypeError('db is verplicht');
    const domain = createRosterDomain(db);
    await domain.ready;

    async function resolveLocation(locationCode) {
        const code = normalizeLocationCode(locationCode);
        const location = await get(db, `SELECT id, code, name, timezone, sort_order AS sortOrder
            FROM locations WHERE code=? COLLATE NOCASE AND is_active=1`, [code]);
        if (!location) throw plannerError('Vestiging niet gevonden.', 'LOCATION_NOT_FOUND', 404);
        return location;
    }

    async function listLocations(userId, weekStart) {
        const locations = await all(db, `SELECT id, code, name, timezone, sort_order AS sortOrder
            FROM locations WHERE is_active=1 ORDER BY sort_order, name`);
        const output = [];
        for (const location of locations) {
            output.push({
                ...location,
                canEdit: await domain.AuthorizationService.canEditLocation(userId, location.id, weekStart)
            });
        }
        return output;
    }

    async function buildContext({ userId, locationCode, weekStart, view = 'auto' }) {
        assertWeekStart(weekStart);
        const user = await domain.AuthorizationService.getUser(userId);
        if (!user || !user.isActive) throw plannerError('Log eerst in.', 'AUTH_REQUIRED', 401);
        if (!await domain.AuthorizationService.canViewPublishedRoster(userId)) {
            throw plannerError('Je hebt geen toegang tot het rooster.', 'ROSTER_VIEW_FORBIDDEN', 403);
        }

        const location = await resolveLocation(locationCode);
        const canEdit = await domain.AuthorizationService.canEditLocation(userId, location.id, weekStart);
        const canPublish = await domain.AuthorizationService.canPublish(userId);
        const state = await domain.QueryService.getWeekState(location.id, weekStart);
        const selectedView = normalizeRequestedView(view, canEdit, Boolean(state.draft));
        const selectedReference = selectedView === 'draft' ? state.draft : state.published;
        const selectedVersion = selectedReference
            ? await domain.QueryService.getVersion(selectedReference.id)
            : null;
        const shifts = selectedVersion ? selectedVersion.shifts.map(localShift) : [];
        const validation = selectedVersion && selectedVersion.state === 'draft' && canEdit
            ? await domain.ValidationService.validateVersion(selectedVersion.id)
            : null;
        const hourBankProjection = selectedVersion && selectedVersion.state === 'draft' && canEdit
            ? await domain.HoursService.projectedWeekMinutes({
                weekStart,
                candidateVersionIds: [selectedVersion.id]
            })
            : null;
        const settings = await get(db, `SELECT
            minimum_published_horizon_weeks AS minimumPublishedHorizonWeeks,
            target_published_horizon_weeks AS targetPublishedHorizonWeeks,
            generation_horizon_weeks AS generationHorizonWeeks
            FROM roster_settings WHERE id=1`);
        const locations = await listLocations(userId, weekStart);
        const employees = canEdit ? await activeEmployeesForWeek(db, location.id, weekStart) : [];

        return {
            profile: {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                role: user.role
            },
            permissions: {
                canEdit,
                canPublish,
                canViewDraft: canEdit
            },
            settings,
            planningBaseline: PLANNING_BASELINE,
            location,
            locations,
            week: {
                weekStart,
                weekEnd: addDays(weekStart, 6),
                isoWeek: isoWeekNumber(weekStart)
            },
            views: {
                selected: selectedView,
                hasDraft: Boolean(state.draft),
                hasPublished: Boolean(state.published),
                draftVersionId: state.draft?.id || null,
                draftRevision: state.draft?.revision ?? null,
                publishedVersionId: state.published?.id || null,
                publishedVersionNo: state.published?.versionNo ?? null
            },
            selectedVersion: selectedVersion ? {
                id: selectedVersion.id,
                periodId: selectedVersion.periodId,
                versionNo: selectedVersion.versionNo,
                state: selectedVersion.state,
                revision: selectedVersion.revision,
                basedOnVersionId: selectedVersion.basedOnVersionId || null,
                changeNote: selectedVersion.changeNote || null,
                shifts
            } : null,
            summary: summarizeShifts(shifts),
            validation,
            hourBankProjection,
            employees,
            shiftTypes: Object.entries(SHIFT_TYPE_LABELS).map(([value, label]) => ({ value, label }))
        };
    }

    async function ensureDraft({ userId, locationCode, weekStart, changeNote = 'Weekplanner' }) {
        assertWeekStart(weekStart);
        const location = await resolveLocation(locationCode);
        const result = await domain.DraftService.ensureDraft({
            locationId: location.id,
            weekStart,
            actorUserId: userId,
            changeNote
        });
        return buildContext({ userId, locationCode: location.code, weekStart, view: 'draft' });
    }

    async function versionForMutation(userId, versionId) {
        const parsedVersionId = Number(versionId);
        if (!Number.isInteger(parsedVersionId) || parsedVersionId <= 0) {
            throw plannerError('Ongeldige conceptversie.', 'INVALID_VERSION');
        }
        const version = await domain.QueryService.getVersion(parsedVersionId);
        if (!version) throw plannerError('Conceptversie niet gevonden.', 'VERSION_NOT_FOUND', 404);
        if (version.state !== 'draft') throw plannerError('Alleen een concept kan worden gewijzigd.', 'VERSION_NOT_DRAFT', 409);
        if (!await domain.AuthorizationService.canEditLocation(userId, version.locationId, version.weekStart)) {
            throw plannerError('Je mag deze vestiging niet wijzigen.', 'ROSTER_EDIT_FORBIDDEN', 403);
        }
        return version;
    }

    function localRange(version, date, startTime, endTime) {
        assertIsoDate(date, 'dienstdatum');
        assertTime(startTime, 'begintijd');
        assertTime(endTime, 'eindtijd');
        if (date < version.weekStart || date > version.weekEnd) {
            throw plannerError('De dienst moet binnen de gekozen roosterweek starten.', 'SHIFT_OUTSIDE_WEEK');
        }
        const endDate = timeMinutes(endTime) <= timeMinutes(startTime) ? addDays(date, 1) : date;
        return {
            startsAtUtc: localDateTimeToUtc(date, startTime, version.timezone || 'Europe/Amsterdam'),
            endsAtUtc: localDateTimeToUtc(endDate, endTime, version.timezone || 'Europe/Amsterdam')
        };
    }

    async function validateEmployee(employeeId) {
        if (employeeId === null) return;
        const employee = await get(db, 'SELECT id FROM employees WHERE id=? AND archived_at IS NULL', [employeeId]);
        if (!employee) throw plannerError('Medewerker niet gevonden.', 'EMPLOYEE_NOT_FOUND', 404);
    }

    async function addShift({
        userId,
        versionId,
        expectedRevision,
        employeeId,
        date,
        startTime,
        endTime,
        shiftType = 'floor',
        note = null
    }) {
        const version = await versionForMutation(userId, versionId);
        const normalizedEmployeeId = normalizeEmployeeId(employeeId);
        await validateEmployee(normalizedEmployeeId);
        const range = localRange(version, date, startTime, endTime);
        await domain.DraftService.addShift({
            versionId: version.id,
            expectedRevision: Number(expectedRevision),
            actorUserId: userId,
            employeeId: normalizedEmployeeId,
            startsAtUtc: range.startsAtUtc,
            endsAtUtc: range.endsAtUtc,
            shiftType,
            note
        });
        return buildContext({
            userId,
            locationCode: version.locationCode,
            weekStart: version.weekStart,
            view: 'draft'
        });
    }

    async function updateShift({
        userId,
        versionId,
        shiftUid,
        expectedRevision,
        employeeId,
        date,
        startTime,
        endTime,
        shiftType,
        note
    }) {
        const version = await versionForMutation(userId, versionId);
        const current = version.shifts.find((shift) => shift.shiftUid === shiftUid);
        if (!current) throw plannerError('Dienst niet gevonden.', 'SHIFT_NOT_FOUND', 404);
        const normalizedEmployeeId = normalizeEmployeeId(employeeId);
        await validateEmployee(normalizedEmployeeId);
        const localCurrent = localShift(current);
        const range = localRange(
            version,
            date || localCurrent.date,
            startTime || localCurrent.startTime,
            endTime || localCurrent.endTime
        );
        await domain.DraftService.updateShift({
            versionId: version.id,
            shiftUid,
            expectedRevision: Number(expectedRevision),
            actorUserId: userId,
            employeeId: normalizedEmployeeId,
            startsAtUtc: range.startsAtUtc,
            endsAtUtc: range.endsAtUtc,
            shiftType: shiftType || current.shiftType,
            note: note === undefined ? current.note : note
        });
        return buildContext({
            userId,
            locationCode: version.locationCode,
            weekStart: version.weekStart,
            view: 'draft'
        });
    }

    async function removeShift({ userId, versionId, shiftUid, expectedRevision, reason = null }) {
        const version = await versionForMutation(userId, versionId);
        await domain.DraftService.removeShift({
            versionId: version.id,
            shiftUid,
            expectedRevision: Number(expectedRevision),
            actorUserId: userId,
            reason
        });
        return buildContext({
            userId,
            locationCode: version.locationCode,
            weekStart: version.weekStart,
            view: 'draft'
        });
    }

    return {
        domain,
        buildContext,
        ensureDraft,
        addShift,
        updateShift,
        removeShift,
        helpers: {
            assertWeekStart,
            isoWeekNumber,
            localShift,
            summarizeShifts
        }
    };
}

module.exports = {
    PLANNING_BASELINE,
    SHIFT_TYPE_LABELS,
    createRosterPlanner,
    isoWeekNumber,
    localShift,
    summarizeShifts
};
