const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'data', 'sport-society.db'));
const ignoreMissingTable = (error) => {
    if (error && !String(error.message).includes('no such table')) throw error;
};

db.serialize(() => {
    db.run(
        `UPDATE hour_employee_settings
         SET active_from = MIN(
            COALESCE((SELECT MIN(date(roster_date)) FROM roster_items
                      WHERE LOWER(TRIM(employee_name)) = LOWER(TRIM(hour_employee_settings.employee_name))),
                     opening_bank_month || '-01'),
            opening_bank_month || '-01')
         WHERE active_from IS NULL OR active_from = '1900-01-01'`,
        ignoreMissingTable
    );
    db.run('UPDATE hour_seed_state SET version = 0 WHERE version < 2', ignoreMissingTable);
});

db.close((error) => {
    if (error) throw error;
});
