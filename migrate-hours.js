const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDirectory = path.join(__dirname, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new sqlite3.Database(path.join(dataDirectory, 'sport-society.db'));
const close = (error) => db.close((closeError) => {
    if (error || closeError) throw error || closeError;
});

const migrate = (hasRoster) => {
    const rosterStart = hasRoster
        ? `(SELECT MIN(date(roster_date)) FROM roster_items
            WHERE LOWER(TRIM(employee_name)) = LOWER(TRIM(hour_employee_settings.employee_name)))`
        : 'NULL';
    db.run(
        `UPDATE hour_employee_settings
         SET active_from = MIN(COALESCE(${rosterStart}, opening_bank_month || '-01'), opening_bank_month || '-01')
         WHERE active_from IS NULL OR active_from = '1900-01-01'`,
        close
    );
};

db.all('PRAGMA table_info(hour_employee_settings)', (error, columns) => {
    if (error || !columns.length) return close(error);
    db.get("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='roster_items'", (rosterError, roster) => {
        if (rosterError) return close(rosterError);
        if (columns.some((column) => column.name === 'active_from')) return migrate(Boolean(roster));
        db.run("ALTER TABLE hour_employee_settings ADD COLUMN active_from TEXT NOT NULL DEFAULT '1900-01-01'", (alterError) => {
            if (alterError) return close(alterError);
            migrate(Boolean(roster));
        });
    });
});