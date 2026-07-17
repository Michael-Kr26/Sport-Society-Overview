const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDirectory = path.join(__dirname, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });
const db = new sqlite3.Database(path.join(dataDirectory, 'sport-society.db'));
db.configure('busyTimeout', 5000);

const OLD_NAME = 'Lucas V';
const NEW_NAME = 'Lucas Veenendaal';
const DEFAULT_CONTRACTS = [
    ['Leroy', 36, '2026-01-01', null],
    ['Leon', 38, '2026-01-01', null],
    ['Mario', 32, '2026-01-01', null],
    ['Koen', 21, '2026-01-01', null],
    [NEW_NAME, 36, '2026-01-01', null],
    ['Dysianne', 34, '2026-01-01', null],
    ['Michael', 28, '2026-01-01', null],
    ['Tristan', 15, '2026-01-01', '2026-05-31'],
    ['Tristan', 8, '2026-06-01', null],
    ['Denise', 22, '2026-01-01', null]
];

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const exec = (sql) => new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
const close = () => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

async function tableExists(table) {
    return Boolean(await get("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [table]));
}

async function columnExists(table, column) {
    if (!await tableExists(table)) return false;
    const columns = await all(`PRAGMA table_info(${table})`);
    return columns.some((item) => item.name === column);
}

async function updateNameColumn(table, column) {
    if (!await columnExists(table, column)) return 0;
    const result = await run(
        `UPDATE ${table} SET ${column}=? WHERE LOWER(TRIM(${column}))=LOWER(TRIM(?))`,
        [NEW_NAME, OLD_NAME]
    );
    return result.changes;
}

async function prepareHourTables() {
    await exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS hour_employee_settings (
            employee_name TEXT PRIMARY KEY COLLATE NOCASE,
            contract_type TEXT NOT NULL DEFAULT 'flex',
            weekly_contract_hours REAL NOT NULL DEFAULT 0,
            opening_bank_hours REAL NOT NULL DEFAULT 0,
            opening_bank_month TEXT NOT NULL,
            active_from TEXT NOT NULL DEFAULT '1900-01-01',
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_by TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS hour_contract_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT NOT NULL COLLATE NOCASE,
            effective_from TEXT NOT NULL,
            effective_to TEXT,
            weekly_hours REAL NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_name, effective_from),
            FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name)
                ON UPDATE CASCADE ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS hour_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_name TEXT NOT NULL COLLATE NOCASE,
            adjustment_date TEXT NOT NULL,
            adjustment_type TEXT NOT NULL,
            hours REAL NOT NULL,
            note TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_name) REFERENCES hour_employee_settings(employee_name)
                ON UPDATE CASCADE ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS hour_seed_state (
            id INTEGER PRIMARY KEY CHECK (id=1),
            version INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    if (!await columnExists('hour_employee_settings', 'active_from')) {
        await run("ALTER TABLE hour_employee_settings ADD COLUMN active_from TEXT NOT NULL DEFAULT '1900-01-01'");
    }
}

async function mergeLucasSettings() {
    const source = await get(
        `SELECT employee_name AS employeeName, contract_type AS contractType,
                weekly_contract_hours AS weeklyContractHours,
                opening_bank_hours AS openingBankHours,
                opening_bank_month AS openingBankMonth,
                active_from AS activeFrom, is_active AS isActive,
                updated_by AS updatedBy
         FROM hour_employee_settings
         WHERE LOWER(TRIM(employee_name))=LOWER(TRIM(?))`,
        [OLD_NAME]
    );
    const target = await get(
        `SELECT employee_name AS employeeName, contract_type AS contractType,
                weekly_contract_hours AS weeklyContractHours,
                opening_bank_hours AS openingBankHours,
                opening_bank_month AS openingBankMonth,
                active_from AS activeFrom, is_active AS isActive,
                updated_by AS updatedBy
         FROM hour_employee_settings
         WHERE LOWER(TRIM(employee_name))=LOWER(TRIM(?))`,
        [NEW_NAME]
    );

    if (!source) return;

    if (!target) {
        await run(
            `INSERT INTO hour_employee_settings (
                employee_name, contract_type, weekly_contract_hours,
                opening_bank_hours, opening_bank_month, active_from,
                is_active, updated_by, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [NEW_NAME, source.contractType, source.weeklyContractHours,
                source.openingBankHours, source.openingBankMonth,
                source.activeFrom, source.isActive, source.updatedBy || 'Naamsmigratie']
        );
    } else {
        const sourceIsContract = source.contractType === 'contract' && Number(source.weeklyContractHours) > 0;
        const targetIsContract = target.contractType === 'contract' && Number(target.weeklyContractHours) > 0;
        const contractType = sourceIsContract || targetIsContract ? 'contract' : 'flex';
        const weeklyHours = sourceIsContract
            ? Number(source.weeklyContractHours)
            : Number(target.weeklyContractHours || 0);
        const openingMonth = [source.openingBankMonth, target.openingBankMonth].filter(Boolean).sort()[0] || '2026-01';
        const activeFrom = [source.activeFrom, target.activeFrom].filter(Boolean).sort()[0] || '2026-01-01';
        const openingBank = Math.abs(Number(source.openingBankHours || 0)) >= Math.abs(Number(target.openingBankHours || 0))
            ? Number(source.openingBankHours || 0)
            : Number(target.openingBankHours || 0);
        await run(
            `UPDATE hour_employee_settings
             SET contract_type=?, weekly_contract_hours=?, opening_bank_hours=?,
                 opening_bank_month=?, active_from=?, is_active=?,
                 updated_by='Naamsmigratie Lucas Veenendaal', updated_at=CURRENT_TIMESTAMP
             WHERE employee_name=? COLLATE NOCASE`,
            [contractType, weeklyHours, openingBank, openingMonth, activeFrom,
                source.isActive || target.isActive ? 1 : 0, NEW_NAME]
        );
    }

    await run(
        `INSERT OR IGNORE INTO hour_contract_periods (
            employee_name, effective_from, effective_to, weekly_hours, created_by, created_at
         )
         SELECT ?, effective_from, effective_to, weekly_hours, created_by, created_at
         FROM hour_contract_periods
         WHERE LOWER(TRIM(employee_name))=LOWER(TRIM(?))`,
        [NEW_NAME, OLD_NAME]
    );
    await run(
        `UPDATE hour_adjustments SET employee_name=?
         WHERE LOWER(TRIM(employee_name))=LOWER(TRIM(?))`,
        [NEW_NAME, OLD_NAME]
    );
    await run(
        `DELETE FROM hour_contract_periods
         WHERE LOWER(TRIM(employee_name))=LOWER(TRIM(?))`,
        [OLD_NAME]
    );
    await run(
        `DELETE FROM hour_employee_settings
         WHERE LOWER(TRIM(employee_name))=LOWER(TRIM(?))`,
        [OLD_NAME]
    );
}

async function seedContracts() {
    const seed = await get('SELECT version FROM hour_seed_state WHERE id=1');
    if (Number(seed?.version || 0) >= 1) return;

    for (const [employeeName, weeklyHours, effectiveFrom, effectiveTo] of DEFAULT_CONTRACTS) {
        await run(
            `INSERT OR IGNORE INTO hour_employee_settings (
                employee_name, contract_type, weekly_contract_hours,
                opening_bank_hours, opening_bank_month, active_from,
                is_active, updated_by, updated_at
             ) VALUES (?, 'contract', ?, 0, '2026-01', ?, 1,
                       'Aangeleverde contracturen', CURRENT_TIMESTAMP)`,
            [employeeName, weeklyHours, effectiveFrom]
        );
        await run(
            `INSERT OR IGNORE INTO hour_contract_periods (
                employee_name, effective_from, effective_to,
                weekly_hours, created_by
             ) VALUES (?, ?, ?, ?, 'Aangeleverde contracturen')`,
            [employeeName, effectiveFrom, effectiveTo, weeklyHours]
        );
    }
    await run(
        `INSERT INTO hour_seed_state (id, version, updated_at)
         VALUES (1, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
             version=MAX(version, 1), updated_at=CURRENT_TIMESTAMP`
    );
}

async function migrateOtherReferences() {
    let changed = 0;
    const references = [
        ['roster_items', 'employee_name'],
        ['roster_items', 'source_slot_employee'],
        ['roster_overrides', 'employee_name'],
        ['roster_overrides', 'source_slot_employee'],
        ['changes', 'employee_1'],
        ['changes', 'employee_2'],
        ['users', 'display_name']
    ];
    for (const [table, column] of references) {
        changed += await updateNameColumn(table, column);
    }
    return changed;
}

async function main() {
    await prepareHourTables();
    await run('BEGIN IMMEDIATE');
    try {
        await mergeLucasSettings();
        const changedReferences = await migrateOtherReferences();
        await seedContracts();
        await run('COMMIT');

        const lucas = await get(
            `SELECT employee_name AS employeeName, contract_type AS contractType,
                    weekly_contract_hours AS weeklyContractHours,
                    active_from AS activeFrom
             FROM hour_employee_settings
             WHERE employee_name=? COLLATE NOCASE`,
            [NEW_NAME]
        );
        console.log(`Naamsmigratie voltooid: ${OLD_NAME} → ${NEW_NAME}.`);
        console.log(`Bijgewerkte rooster-/profielverwijzingen: ${changedReferences}.`);
        if (lucas) console.table([lucas]);
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
}

main()
    .catch((error) => {
        console.error('Migratie van Lucas Veenendaal mislukt:', error);
        process.exitCode = 1;
    })
    .finally(() => close().catch(() => {}));
