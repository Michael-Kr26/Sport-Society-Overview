'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Rooster is read-only gepubliceerd overzicht en Planner bevat de weekplanner', () => {
    const rosterHtml = read('roster.html');
    const plannerHtml = read('planner.html');
    const authUi = read('auth-ui.js');
    const changeWorkflow = read('change-workflow-bootstrap.js');

    assert.match(rosterHtml, /Gepubliceerd rooster/);
    assert.match(rosterHtml, /roster-overview\.js/);
    assert.doesNotMatch(rosterHtml, /shift-drawer/);

    assert.match(plannerHtml, /Weekplanner/);
    assert.match(plannerHtml, /shift-drawer/);
    assert.match(plannerHtml, /roster\.js/);

    assert.match(authUi, /navigationItem\('roster\.html', '▦', 'Rooster', 'employee'\)/);
    assert.match(authUi, /navigationItem\('planner\.html', '▦', 'Planner', 'manager'\)/);
    assert.match(authUi, /'planner\.html': 'manager'/);

    assert.match(changeWorkflow, /rosterUrl: `planner\.html\?/);
});
