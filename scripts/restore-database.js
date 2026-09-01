'use strict';

const path = require('path');
const { restoreDatabase } = require('./database-backup-lib');

async function main() {
    const args = process.argv.slice(2);
    const overwrite = args.includes('--overwrite');
    const paths = args.filter((value) => value !== '--overwrite');
    if (paths.length !== 2) {
        throw new Error('Gebruik: npm run restore:db -- <backup.db> <doel.db> [--overwrite]');
    }

    const backupPath = path.resolve(paths[0]);
    const targetPath = path.resolve(paths[1]);
    const result = await restoreDatabase(backupPath, targetPath, { overwrite });
    console.log(`Database hersteld: ${targetPath}`);
    console.log('SQLite-integriteit: OK');
    console.table(result.counts);
}

main().catch((error) => {
    console.error('Databaseherstel mislukt:', error.message);
    process.exit(1);
});
