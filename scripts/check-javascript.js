'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const skippedDirectories = new Set(['.git', 'node_modules', 'data']);

function collectJavaScript(directory, result = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectJavaScript(fullPath, result);
        else if (entry.isFile() && entry.name.endsWith('.js')) result.push(fullPath);
    }
    return result;
}

const files = collectJavaScript(projectRoot).sort();
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`JavaScript syntax gecontroleerd: ${files.length} bestand(en).`);
