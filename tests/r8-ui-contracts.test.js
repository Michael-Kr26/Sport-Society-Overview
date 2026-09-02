'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('R8 bezettingspagina gebruikt backend operations en niet meer de legacy browserengine', () => {
    const html = read('staffing.html');
    const script = read('staffing-canonical-ui.js');
    assert.match(html, /staffing-canonical-ui\.js/);
    assert.doesNotMatch(html, /src="staffing\.js"/);
    assert.doesNotMatch(html, /staffing-coverage\.js/);
    assert.match(script, /\/api\/roster-operations\/staffing/);
    assert.match(html, /nieuwste gepubliceerde Rooster V2-diensten/);
});

test('R8 urenpagina gebruikt canonical published als primaire bron en Excel alleen als shadow parity', () => {
    const html = read('hours.html');
    const script = read('hours-canonical-ui.js');
    assert.match(html, /hours-canonical-ui\.js/);
    assert.doesNotMatch(html, /hours-linked-ui\.js/);
    assert.doesNotMatch(html, /src="hours\.js"/);
    assert.match(script, /\/api\/roster-operations\/hours/);
    assert.match(script, /\/api\/roster-operations\/parity/);
    assert.match(html, /Primaire bron: gepubliceerd Rooster V2/);
    assert.match(html, /Shadow parity/);
});

test('R8 startup migreert stil en behoudt compacte terminaloutput', () => {
    const pkg = JSON.parse(read('package.json'));
    const start = read('start-server.js');
    assert.match(pkg.scripts.start, /migrate-roster-operations\.js --quiet/);
    assert.doesNotMatch(pkg.scripts.start, /migrate-roster-publication\.js/);
    assert.match(start, /r8-operations-bootstrap/);
});
