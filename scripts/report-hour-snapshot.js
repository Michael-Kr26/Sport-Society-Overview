const fs = require('fs');
const path = require('path');

const snapshotPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'data', 'imports', '.roster-calculated-hour-summaries.json');
const requestedMonth = String(process.argv[3] || '').trim();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function readSnapshot() {
    if (!fs.existsSync(snapshotPath)) throw new Error(`Excel-snapshot niet gevonden: ${snapshotPath}`);
    const raw = fs.readFileSync(snapshotPath, 'utf8').replace(/^\uFEFF/, '');
    const snapshot = JSON.parse(raw);
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.periods)) {
        throw new Error('Excel-snapshot heeft een onbekend formaat.');
    }
    return snapshot;
}

function main() {
    const snapshot = readSnapshot();
    const periods = [...snapshot.periods].sort((a, b) => String(a.periodKey).localeCompare(String(b.periodKey)));
    const month = MONTH_RE.test(requestedMonth) ? requestedMonth : periods.at(-1)?.periodKey;
    const period = periods.find((item) => item.periodKey === month);
    if (!period) throw new Error(`Maand ${month || '(onbekend)'} staat niet in de Excel-snapshot.`);

    console.log(`\n=== Rechtstreeks door Excel berekende waarden · ${period.sheetName || period.periodKey} ===`);
    console.log(`Bron: ${snapshot.sourceFile || '-'} · snapshot: ${snapshot.createdAt || '-'} · SHA-256: ${snapshot.workbookSha256 || '-'}`);
    console.table((period.summaries || []).map((summary) => ({
        medewerker: summary.employeeName,
        kolom: summary.sourceColumn,
        ingepland: summary.scheduledHours,
        minstens: summary.minimumHours,
        overurenDezeMaand: summary.overtimeThisMonth,
        overurenVorigeMaand: summary.overtimePreviousMonth,
        overurenNaDezeMaand: summary.overtimeAfterMonth
    })));
}

try {
    main();
} catch (error) {
    console.error('Excel-snapshot controleren mislukt:', error.message || error);
    process.exitCode = 1;
}
