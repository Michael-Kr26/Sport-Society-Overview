const path = require('path');
const { spawnSync } = require('child_process');

const workbookPath = process.argv[2];

function run(script) {
    const args = [path.join(__dirname, script)];
    if (workbookPath) args.push(workbookPath);
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

run('import-roster.js');
run('link-roster-hours.js');
