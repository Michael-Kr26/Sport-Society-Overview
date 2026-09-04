'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'tests', 'docs', 'data']);
const ignoredFiles = new Set(['CHANGELOG.md']);

function filesUnder(directory) {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...filesUnder(full));
        else if (!ignoredFiles.has(entry.name) && /\.(js|json)$/.test(entry.name)) result.push(full);
    }
    return result;
}

test('productruntime bevat geen oude medewerkerseed- of naamnormalisatiepatronen', () => {
    const violations = [];
    const retiredPatterns = [
        ['DEFAULT_CONTRACTS', /\bDEFAULT_CONTRACTS\b/],
        ['embedded EMPLOYEE_BASELINE', /EMPLOYEE_BASELINE\s*=\s*Object\.freeze\(\s*\[/],
        ['ensureRosterEmployees', /\bensureRosterEmployees\s*\(/]
    ];

    for (const file of filesUnder(root)) {
        const relative = path.relative(root, file).replaceAll('\\', '/');
        const content = fs.readFileSync(file, 'utf8');
        for (const [label, pattern] of retiredPatterns) {
            if (pattern.test(content)) violations.push(`${relative}: ${label}`);
        }
    }
    assert.deepEqual(violations, []);
});

test('uitdienstbeheer bevat geen automatische mutatie voor een hardcoded medewerker', () => {
    const source = fs.readFileSync(path.join(root, 'employment-end-bootstrap.js'), 'utf8');
    assert.doesNotMatch(source, /waitForEmployee\s*\(\s*['"`]/);
    assert.doesNotMatch(source, /setEmploymentEnd\s*\(\s*['"`]/);
});

test('productstart voert geen persoonsgebonden employeemigratie uit', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.doesNotMatch(packageJson.scripts.start, /migrate-employee-names/);
});
