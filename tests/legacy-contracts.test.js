'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    classifyCoverage,
    managerCanAccessLocation,
    resolveEffectiveRoster,
    roleAllows,
    shiftHours,
    visibleInMonth
} = require('./support/legacy-reference');

function fixture(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

test('R0 roosterfixture legt base + overrides contract vast', () => {
    const data = fixture('roster-effective.json');
    const actual = resolveEffectiveRoster(data.baseRows, data.overrides).map((item) => ({
        rosterDate: item.rosterDate,
        employeeName: item.employeeName,
        location: item.location,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        isOverride: Boolean(item.isOverride)
    }));
    assert.deepEqual(actual, data.expected);
});

test('R0 urenfixture legt dienstduur en overnight gedrag vast', () => {
    const data = fixture('hours.json');
    const totals = {};
    for (const shift of data.shifts) {
        const hours = shiftHours(shift);
        assert.equal(hours, shift.expectedHours, `${shift.employeeName} ${shift.startTime}-${shift.endTime}`);
        totals[shift.employeeName] = Math.round(((totals[shift.employeeName] || 0) + hours) * 100) / 100;
    }
    assert.deepEqual(totals, data.totals);
});

test('R0 urenfixture legt toekomstige en uitdienst-zichtbaarheid vast', () => {
    const data = fixture('hours.json');
    for (const item of data.employmentVisibility) {
        assert.equal(visibleInMonth(item.status, item.month), item.expected, `${item.month} ${JSON.stringify(item.status)}`);
    }
});

test('R0 staffingfixture legt under/vulnerable/sufficient contract vast', () => {
    const data = fixture('staffing.json');
    for (const item of data.cases) {
        assert.equal(classifyCoverage(item), item.expected, item.name);
    }
});

test('R0 accessfixture legt rolhiërarchie vast', () => {
    const data = fixture('access.json');
    for (const item of data.pageCases) {
        assert.equal(roleAllows(item.role, item.minimumRole), item.expected, `${item.role} >= ${item.minimumRole}`);
    }
});

test('R0 accessfixture legt manager vestigingsscope vast', () => {
    const data = fixture('access.json');
    for (const item of data.managerLocationCases) {
        assert.equal(
            managerCanAccessLocation(item.profileLocation, item.requestedLocation),
            item.expected,
            `${item.profileLocation || 'geen'} -> ${item.requestedLocation}`
        );
    }
});
