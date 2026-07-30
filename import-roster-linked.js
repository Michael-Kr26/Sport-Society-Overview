const path = require('path');
const { spawnSync } = require('child_process');

const workbookPath = process.argv[2];
const calculatedSnapshotPath = process.argv[3];

function run(script, { includeWorkbook = true, includeSnapshot = false } = {}) {
    const args = [path.join(__dirname, script)];
    if (includeWorkbook && workbookPath) args.push(workbookPath);
    if (includeSnapshot && calculatedSnapshotPath) args.push(calculatedSnapshotPath);
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

run('import-roster.js');
run('normalize-roster-headers.js');
run('link-roster-hours.js');
run('import-hour-summaries.js', { includeSnapshot: true });
run('normalize-zero-hour-summaries.js');
run('migrate-employee-names.js', { includeWorkbook: false });
