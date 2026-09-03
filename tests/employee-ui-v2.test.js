'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const view = require('../employee-view-model');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('medewerkerdetail resolveert canonieke employee-ID en onbekende ID veilig', () => {
    const employees = [{ employeeName: 'Denise' }, { employeeName: 'Jamie' }];
    const directory = [
        { employeeId: 5, employeeName: 'Denise' },
        { employeeId: 12, employeeName: 'Jamie' }
    ];
    assert.equal(view.resolveEmployee({ employees, directory, id: '5' }).employeeName, 'Denise');
    assert.equal(view.resolveEmployee({ employees, directory, id: '999' }), null);
    assert.equal(view.employeeHref(employees[1], directory), 'employee.html?id=12');
});

test('legacy medewerker zonder canonieke ID krijgt gecontroleerde naam-fallback', () => {
    const employee = { employeeName: 'Historische Medewerker' };
    assert.equal(view.employeeHref(employee, []), 'employee.html?name=Historische%20Medewerker');
    assert.equal(view.resolveEmployee({ employees: [employee], name: 'Historische Medewerker' }), employee);
});

test('medewerkersoverzicht bevat geen permanente profiel- of contractedits en gebruikt dynamische detailrouting', () => {
    const html = read('employee-settings.html');
    const js = read('employee-settings.js');
    assert.match(js, /view\.employeeHref\(employee, directory\)/);
    assert.doesNotMatch(html, /data-profile-form/);
    assert.doesNotMatch(html, /data-period-form/);
    assert.match(html, /toggle-add-employee/);
});

test('medewerkerdetail gebruikt bestaande business-API voor profiel, laatste werkdag en contracten', () => {
    const js = read('employee-detail.js');
    assert.match(js, /\/api\/hours\/employees\/\$\{encodeURIComponent\(employee\.employeeName\)\}/);
    assert.match(js, /\/api\/hours\/employment-status\/\$\{encodeURIComponent\(employee\.employeeName\)\}/);
    assert.match(js, /contract-periods/);
    assert.match(js, /isActive/);
});

test('employee module heeft geen eigen dark theme of extreme font weights meer', () => {
    const css = read('employee-settings.css');
    assert.doesNotMatch(css, /#1b1b1b|#111417|rgba\(255,\s*255,\s*255/);
    assert.doesNotMatch(css, /font-weight:\s*(?:8\d\d|9\d\d)/);
    assert.doesNotMatch(css, /!important/);
});

test('navigatie bevat dynamische accountsectie en employee detail blijft Admin-only', () => {
    const auth = read('auth-ui.js');
    assert.match(auth, /'employee\.html': 'admin'/);
    assert.match(auth, /data-nav-account-name/);
    assert.doesNotMatch(auth, />Michael</);
});