const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'data', 'sport-society.db');
const requestedMonth = String(process.argv[2] || '').trim();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FIELDS = [
    ['scheduledHours', 'Ingepland'],
    ['minimumHours', 'Minstens'],
    ['overtimeThisMonth', 'Overuren deze maand'],
    ['overtimePreviousMonth', 'Overuren vorige maand'],
    ['overtimeAfterMonth', 'Overuren na deze maand']
];

const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});
const close = () => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');
const isNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));

function monthBounds(month) {
    const [year, number] = month.split('-').map(Number);
    return {
        first: `${month}-01`,
        last: new Date(year, number, 0).toISOString().slice(0, 10)
    };
}

function summaryRow(row) {
    return {
        periodKey: row.periodKey,
        employeeName: row.employeeName,
        scheduledHours: row.scheduledHours,
        minimumHours: row.minimumHours,
        overtimeThisMonth: row.overtimeThisMonth,
        overtimePreviousMonth: row.overtimePreviousMonth,
        overtimeAfterMonth: row.overtimeAfterMonth
    };
}

function overrideRow(row) {
    return {
        periodKey: row.periodKey,
        employeeName: row.employeeName,
        scheduledHours: row.scheduledHours,
        minimumHours: row.minimumHours,
        overtimeThisMonth: row.overtimeThisMonth,
        overtimePreviousMonth: row.overtimePreviousMonth,
        overtimeAfterMonth: row.overtimeAfterMonth
    };
}

function mergeValues(summary, override) {
    const merged = { ...(summary || {}) };
    for (const [field] of FIELDS) {
        if (override && isNumber(override[field])) merged[field] = Number(override[field]);
        else if (!(field in merged)) merged[field] = null;
    }
    return merged;
}

function missingFields(values) {
    return FIELDS.filter(([field]) => !isNumber(values[field])).map(([, label]) => label);
}

async function activeContractEmployees(month) {
    const { first, last } = monthBounds(month);
    return all(`SELECT settings.employee_name AS employeeName,
        settings.active_from AS activeFrom, settings.active_until AS activeUntil,
        settings.is_active AS isActive, settings.contract_type AS contractType,
        MAX(CASE WHEN periods.id IS NOT NULL THEN 1 ELSE 0 END) AS hasContract
        FROM hour_employee_settings settings
        LEFT JOIN hour_contract_periods periods
          ON periods.employee_name=settings.employee_name COLLATE NOCASE
         AND date(periods.effective_from)<=date(?)
         AND (periods.effective_to IS NULL OR date(periods.effective_to)>=date(?))
         AND periods.weekly_hours>0
        WHERE settings.is_active=1
          AND (settings.active_from IS NULL OR date(settings.active_from)<=date(?))
          AND (settings.active_until IS NULL OR date(settings.active_until)>=date(?))
        GROUP BY settings.employee_name, settings.active_from, settings.active_until,
            settings.is_active, settings.contract_type
        HAVING hasContract=1 OR contractType='contract'
        ORDER BY LOWER(settings.employee_name)`, [last, first, last, first]);
}

async function main() {
    const latest = await get('SELECT MAX(period_key) AS periodKey FROM excel_hour_periods');
    const month = MONTH_RE.test(requestedMonth) ? requestedMonth : latest?.periodKey;
    if (!month) throw new Error('Er zijn nog geen Excel-maandpagina’s geïmporteerd.');

    const periods = await all('SELECT period_key AS periodKey, sheet_name AS sheetName FROM excel_hour_periods WHERE period_key<=? ORDER BY period_key DESC', [month]);
    const summaries = (await all(`SELECT period_key AS periodKey, employee_name AS employeeName,
        scheduled_hours AS scheduledHours, minimum_hours AS minimumHours,
        overtime_this_month AS overtimeThisMonth, overtime_previous_month AS overtimePreviousMonth,
        overtime_after_month AS overtimeAfterMonth
        FROM excel_hour_summaries WHERE period_key<=? ORDER BY period_key DESC`, [month])).map(summaryRow);
    const overrides = (await all(`SELECT period_key AS periodKey, employee_name AS employeeName,
        scheduled_hours AS scheduledHours, minimum_hours AS minimumHours,
        overtime_this_month AS overtimeThisMonth, overtime_previous_month AS overtimePreviousMonth,
        overtime_after_month AS overtimeAfterMonth
        FROM excel_hour_overrides WHERE period_key<=? ORDER BY period_key DESC`, [month])).map(overrideRow);
    const employees = await activeContractEmployees(month);

    const summaryMap = new Map(summaries.map((row) => [`${row.periodKey}|${employeeKey(row.employeeName)}`, row]));
    const overrideMap = new Map(overrides.map((row) => [`${row.periodKey}|${employeeKey(row.employeeName)}`, row]));
    const periodName = new Map(periods.map((period) => [period.periodKey, period.sheetName]));
    const output = [];

    for (const employee of employees) {
        const key = employeeKey(employee.employeeName);
        const exact = mergeValues(
            summaryMap.get(`${month}|${key}`),
            overrideMap.get(`${month}|${key}`)
        );
        const exactMissing = missingFields(exact);
        if (!exactMissing.length) {
            output.push({
                medewerker: employee.employeeName,
                status: 'EXACT',
                bron: periodName.get(month) || month,
                ontbreekt: ''
            });
            continue;
        }

        let fallback = null;
        for (const period of periods) {
            if (period.periodKey === month) continue;
            const candidate = mergeValues(
                summaryMap.get(`${period.periodKey}|${key}`),
                overrideMap.get(`${period.periodKey}|${key}`)
            );
            if (!missingFields(candidate).length) {
                fallback = period;
                break;
            }
        }

        output.push({
            medewerker: employee.employeeName,
            status: fallback ? 'TERUGVAL' : 'ONTBREEKT',
            bron: fallback ? fallback.sheetName : 'geen complete maand',
            ontbreekt: exactMissing.join(', ')
        });
    }

    const exactCount = output.filter((row) => row.status === 'EXACT').length;
    const fallbackCount = output.filter((row) => row.status === 'TERUGVAL').length;
    const missingCount = output.filter((row) => row.status === 'ONTBREEKT').length;

    console.log(`\n=== Urenbronnen voor ${periodName.get(month) || month} ===`);
    console.table(output);
    console.log(`Exact: ${exactCount} · Terugval (geel): ${fallbackCount} · Zonder complete bron: ${missingCount}`);

    if (fallbackCount || missingCount) {
        console.warn('\nGele regels blijven alleen staan waar de gekozen Excel-maand nog niet alle vijf waarden bevat.');
        console.warn('De kolom "ontbreekt" vermeldt welke cellen op die maandpagina gecontroleerd moeten worden.');
    } else {
        console.log('\nAlle actieve contractmedewerkers gebruiken de gekozen maandpagina als exacte bron.');
    }
}

main()
    .catch((error) => {
        console.error('Controleren van urenbronnen mislukt:', error);
        process.exitCode = 1;
    })
    .finally(close);
