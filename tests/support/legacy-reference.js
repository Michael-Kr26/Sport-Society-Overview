'use strict';

const ROLE_LEVEL = { guest: 0, employee: 1, manager: 2, admin: 3 };

function timeToMinutes(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function shiftHours({ startTime, endTime, breakMinutes = 0 }) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    if (start === null || end === null) return 0;
    const normalizedEnd = end <= start ? end + 1440 : end;
    const workedMinutes = Math.max(0, normalizedEnd - start - Number(breakMinutes || 0));
    return Math.round((workedMinutes / 60) * 100) / 100;
}

function sortRoster(items) {
    return [...items].sort((a, b) => (
        String(a.rosterDate || '').localeCompare(String(b.rosterDate || ''))
        || String(a.location || '').localeCompare(String(b.location || ''), 'nl')
        || String(a.startTime || '99:99').localeCompare(String(b.startTime || '99:99'))
        || String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'nl')
    ));
}

function resolveEffectiveRoster(baseRows, overrides) {
    const hiddenHashes = new Set((overrides || []).map((item) => item.sourceHash).filter(Boolean));
    const effective = (baseRows || []).filter((item) => !hiddenHashes.has(item.sourceHash));

    for (const override of overrides || []) {
        if (override.isDeleted) continue;
        effective.push({
            rosterDate: override.rosterDate,
            employeeName: override.employeeName,
            sourceSlotEmployee: override.sourceSlotEmployee || null,
            itemType: override.itemType,
            location: override.location || null,
            startTime: override.startTime || null,
            endTime: override.endTime || null,
            status: override.status,
            note: override.note || null,
            sourceHash: `override:${override.id}`,
            isOverride: true
        });
    }

    return sortRoster(effective);
}

function roleAllows(role, minimumRole) {
    return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minimumRole] || 0);
}

function managerCanAccessLocation(profileLocation, requestedLocation) {
    return Boolean(profileLocation) && profileLocation === requestedLocation;
}

function classifyCoverage({ employeeCount, hardMinimum, advisedMinimum, fullOrWaitlist = false, markDemandVulnerable = true, suppressLessonVulnerability = false }) {
    if (employeeCount < hardMinimum) return 'under';
    if (employeeCount < advisedMinimum) return 'vulnerable';
    if (markDemandVulnerable && fullOrWaitlist && !suppressLessonVulnerability) return 'vulnerable';
    return 'sufficient';
}

function monthBounds(month) {
    const [year, number] = String(month || '').split('-').map(Number);
    if (!year || !number) return { first: '', last: '' };
    return {
        first: `${year}-${String(number).padStart(2, '0')}-01`,
        last: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
    };
}

function visibleInMonth(status, month) {
    if (!status || !status.isActive) return false;
    const { first, last } = monthBounds(month);
    if (status.activeFrom && last && status.activeFrom > last) return false;
    if (status.activeUntil && first && status.activeUntil < first) return false;
    return true;
}

module.exports = {
    classifyCoverage,
    managerCanAccessLocation,
    resolveEffectiveRoster,
    roleAllows,
    shiftHours,
    visibleInMonth
};
