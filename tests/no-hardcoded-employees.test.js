'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'tests', 'docs', 'data']);
const ignoredFiles = new Set(['CHANGELOG.md']);
const employeeNames = [
    'Lucas V', 'Lucas Veenendaal', 'Lucas Leeuwis', 'Lucas L',
    'Olav', 'Daniel', 'Vigo', 'Denise', 'Sep', 'Ali', 'Leroy', 'Michael',
    'Nicole', 'Melle', 'Jamie', 'Rick', 'Dysianne', 'Anne-Marthe', 'Gijs',
    'Leon', 'Koen', 'Tristan', 'Jeffrey', 'Noel', 'Mario'
];

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

test('productruntime bevat geen persoonsgebonden medewerkerseeds of naamsmigraties', () => {
    const violations = [];
    for (const file of filesUnder(root)) {
        const relative = path.relative(root, file).replaceAll('\\', '/');
        const content = fs.readFileSync(file, 'utf8');
        for (const name of employeeNames) {
            if (content.includes(name)) violations.push(`${relative}: ${name}`);
        }
        if (/DEFAULT_CONTRACTS|EMPLOYEE_BASELINE\s*=\s*Object\.freeze\(\[|ensureRosterEmployees\s*\(/.test(content)) {
            violations.push(`${relative}: retired employee seed pattern`);
        }
    }
    assert.deepEqual(violations, []);
});

test('productstart voert geen persoonsgebonden employeemigratie uit', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.doesNotMatch(packageJson.scripts.start, /migrate-employee-names/);
});
