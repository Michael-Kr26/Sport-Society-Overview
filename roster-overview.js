'use strict';

const LOCATIONS = [
    { code: 'AVE', name: 'Achterveld' },
    { code: 'BVE', name: 'Barneveld' },
    { code: 'VHU', name: 'Voorthuizen' },
    { code: 'WEK', name: 'Wekerom' },
    { code: 'HAR', name: 'Harskamp' }
];

const elements = {
    previousWeek: document.getElementById('previous-week'),
    currentWeek: document.getElementById('current-week'),
    nextWeek: document.getElementById('next-week'),
    weekNumber: document.getElementById('week-number'),
    weekRange: document.getElementById('week-range'),
    employee: document.getElementById('employee-filter'),
    location: document.getElementById('location-filter'),
    type: document.getElementById('type-filter'),
    reset: document.getElementById('reset-roster-filters'),
    summary: document.getElementById('roster-summary'),
    count: document.getElementById('roster-result-count'),
    results: document.getElementById('roster-results'),
    error: document.getElementById('roster-error'),
    plannerLink: document.getElementById('open-planner'),
    exportCard: document.getElementById('roster-export-card'),
    exportMonth: document.getElementById('roster-export-month'),
    exportDownload: document.getElementById('download-roster-export'),
    exportSharePoint: document.getElementById('sharepoint-roster-export'),
    exportMessage: document.getElementById('roster-export-message')
};

const query = new URLSearchParams(window.location.search);
const initialFocusDate = query.get('focusDate');
const initialLocation = query.get('location');
const initialName = query.get('name');

const state = {
    weekStart: mondayOf(initialFocusDate || todayString()),
    shifts: [],
    contexts: [],
    loading: false,
    role: 'guest'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function todayString() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function dateObject(dateString) {
    return new Date(`${dateString}T12:00:00`);
}

function isoDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function addDays(dateString, days) {
    const date = dateObject(dateString);
    date.setDate(date.getDate() + days);
    return isoDate(date);
}

function mondayOf(dateString) {
    const date = dateObject(dateString);
    if (Number.isNaN(date.getTime())) return mondayOf(todayString());
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    return isoDate(date);
}

function isoWeekNumber(dateString) {
    const date = new Date(`${dateString}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function formatDate(dateString, options = { day: 'numeric', month: 'short' }) {
    return new Intl.DateTimeFormat('nl-NL', options).format(dateObject(dateString));
}

function formatHours(minutes) {
    const value = Number(minutes || 0) / 60;
    return Number.isInteger(value) ? `${value} u` : `${value.toFixed(1).replace('.', ',')} u`;
}

function locationClass(code) {
    return `location-${String(code || '').toLowerCase()}`;
}

function setError(message) {
    elements.error.hidden = !message;
    elements.error.textContent = message || '';
}

function setExportMessage(message, type = 'info') {
    if (!elements.exportMessage) return;
    elements.exportMessage.hidden = !message;
    elements.exportMessage.textContent = message || '';
    elements.exportMessage.className = `roster-export-message is-${type}`;
}

async function api(url) {
    const response = await fetch(url);
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(payload.message || 'Rooster kon niet worden geladen.');
    return payload;
}

async function jsonRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
        const error = new Error(payload.message || 'Export kon niet worden verwerkt.');
        error.code = payload.code || null;
        error.details = payload.details || null;
        throw error;
    }
    return payload;
}

function updateUrl() {
    const params = new URLSearchParams({ focusDate: state.weekStart });
    if (elements.location.value) params.set('location', elements.location.value);
    if (elements.employee.value.trim()) params.set('name', elements.employee.value.trim());
    window.history.replaceState(null, '', `roster.html?${params.toString()}`);
}

function applyInitialFilters() {
    if (initialName) elements.employee.value = initialName;
    if (initialLocation) {
        const byName = LOCATIONS.find((item) => item.name.toLowerCase() === initialLocation.toLowerCase());
        const byCode = LOCATIONS.find((item) => item.code.toLowerCase() === initialLocation.toLowerCase());
        const location = byName || byCode;
        if (location) elements.location.value = location.code;
    }
}

function filteredShifts() {
    const employee = elements.employee.value.trim().toLowerCase();
    const location = elements.location.value;
    const type = elements.type.value;
    return state.shifts.filter((shift) => {
        const employeeMatches = !employee
            || String(shift.employeeName || 'Open dienst').toLowerCase().includes(employee);
        const locationMatches = !location || shift.locationCode === location;
        const typeMatches = !type || shift.shiftType === type;
        return employeeMatches && locationMatches && typeMatches;
    });
}

function nextUpcomingShift(shifts) {
    const now = Date.now();
    return shifts
        .map((shift) => ({ shift, time: new Date(shift.startsAtUtc).getTime() }))
        .filter((item) => Number.isFinite(item.time) && item.time >= now)
        .sort((a, b) => a.time - b.time)[0]?.shift || null;
}

function renderToolbar() {
    const weekEnd = addDays(state.weekStart, 6);
    elements.weekNumber.textContent = `Week ${isoWeekNumber(state.weekStart)}`;
    elements.weekRange.textContent = `${formatDate(state.weekStart)} – ${formatDate(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    if (elements.plannerLink) {
        const location = elements.location.value || 'AVE';
        elements.plannerLink.href = `planner.html?focusDate=${encodeURIComponent(state.weekStart)}&location=${encodeURIComponent(location)}`;
        elements.plannerLink.hidden = state.role !== 'admin';
    }
}

function renderSummary(shifts) {
    const employeeIds = new Set(shifts.filter((shift) => shift.employeeId).map((shift) => shift.employeeId));
    const locationCodes = new Set(shifts.map((shift) => shift.locationCode));
    const plannedMinutes = shifts.reduce((sum, shift) => sum + Number(shift.plannedMinutes || 0), 0);
    const cards = [
        [shifts.length, 'Diensten'],
        [employeeIds.size, 'Medewerkers'],
        [formatHours(plannedMinutes), 'Geplande uren'],
        [locationCodes.size, 'Vestigingen']
    ];
    elements.summary.innerHTML = cards.map(([value, label]) => `
        <article class="roster-summary-card">
            <span class="summary-value">${escapeHtml(value)}</span>
            <span class="summary-label">${escapeHtml(label)}</span>
        </article>
    `).join('');
}

function renderShift(shift, nextShift) {
    const isNext = nextShift && nextShift.shiftUid === shift.shiftUid && nextShift.locationCode === shift.locationCode;
    return `
        <div class="roster-item ${shift.open ? 'is-open' : ''} ${isNext ? 'is-next-shift' : ''}">
            <div class="roster-time">${escapeHtml(shift.startTime)}–${escapeHtml(shift.endTime)}${shift.crossesMidnight ? ' +1' : ''}</div>
            <div class="roster-person">
                <strong>${shift.open ? 'Open dienst' : escapeHtml(shift.employeeName)}</strong>
                ${isNext ? '<span class="next-shift-label">Eerstvolgende dienst</span>' : ''}
                ${shift.note ? `<span class="roster-note">${escapeHtml(shift.note)}</span>` : ''}
            </div>
            <div><span class="roster-pill ${locationClass(shift.locationCode)}">${escapeHtml(shift.locationName)}</span></div>
            <div class="roster-meta"><strong>${escapeHtml(shift.shiftTypeLabel)}</strong><span>${shift.open ? 'Nog niet ingevuld' : escapeHtml(shift.employeeCode || '')}</span></div>
        </div>
    `;
}

function renderResults() {
    const shifts = filteredShifts().sort((a, b) =>
        a.date.localeCompare(b.date)
        || a.startTime.localeCompare(b.startTime)
        || String(a.locationName).localeCompare(String(b.locationName), 'nl')
        || String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'nl')
    );
    const nextShift = nextUpcomingShift(shifts);
    renderToolbar();
    renderSummary(shifts);
    elements.count.textContent = `${shifts.length} dienst${shifts.length === 1 ? '' : 'en'}`;

    if (!shifts.length) {
        elements.results.innerHTML = '<p class="empty-state">Geen gepubliceerde diensten gevonden voor deze week en filters.</p>';
        updateUrl();
        return;
    }

    const groups = new Map();
    shifts.forEach((shift) => {
        if (!groups.has(shift.date)) groups.set(shift.date, []);
        groups.get(shift.date).push(shift);
    });

    elements.results.innerHTML = [...groups.entries()].map(([date, dayShifts]) => `
        <article class="roster-day">
            <div class="roster-day-header">
                <div><span>${new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(dateObject(date))}</span><h3>${formatDate(date, { day: 'numeric', month: 'long' })}</h3></div>
                <strong>${dayShifts.length} dienst${dayShifts.length === 1 ? '' : 'en'}</strong>
            </div>
            <div class="roster-items">${dayShifts.map((shift) => renderShift(shift, nextShift)).join('')}</div>
        </article>
    `).join('');
    updateUrl();
}

async function loadWeek() {
    if (state.loading) return;
    state.loading = true;
    setError('');
    elements.results.innerHTML = '<p class="empty-state">Gepubliceerd rooster laden...</p>';
    try {
        const contexts = await Promise.all(LOCATIONS.map((location) => {
            const params = new URLSearchParams({ location: location.code, weekStart: state.weekStart, view: 'published' });
            return api(`/api/roster-planner/context?${params.toString()}`);
        }));
        state.contexts = contexts;
        state.shifts = contexts.flatMap((context) => context.selectedVersion?.shifts || []);
        renderResults();
    } catch (error) {
        console.error(error);
        setError(error.message);
        elements.results.innerHTML = '<p class="empty-state">Rooster kon niet worden geladen.</p>';
        renderSummary([]);
        elements.count.textContent = 'Fout bij laden';
    } finally {
        state.loading = false;
    }
}

function selectedExportMonth() {
    const month = String(elements.exportMonth?.value || '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Selecteer eerst een geldige maand.');
    return month;
}

async function downloadMonthlyExport() {
    const month = selectedExportMonth();
    setExportMessage('Excel wordt opgebouwd...', 'info');
    elements.exportDownload.disabled = true;
    try {
        const response = await fetch(`/api/roster-export/month?month=${encodeURIComponent(month)}`);
        if (!response.ok) {
            let payload = {};
            try { payload = await response.json(); } catch {}
            throw new Error(payload.message || 'Excel-export kon niet worden gemaakt.');
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `SSO-Rooster-${month}.xlsx`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setExportMessage(`${fileName} is aangemaakt uit het gepubliceerde rooster.`, 'success');
    } catch (error) {
        console.error(error);
        setExportMessage(error.message, 'error');
    } finally {
        elements.exportDownload.disabled = false;
    }
}

async function updateSharePointExport() {
    const month = selectedExportMonth();
    setExportMessage('Excel wordt opgebouwd en naar SharePoint gestuurd...', 'info');
    elements.exportSharePoint.disabled = true;
    elements.exportDownload.disabled = true;
    try {
        const result = await jsonRequest('/api/roster-export/sharepoint', {
            method: 'POST',
            body: JSON.stringify({ month })
        });
        const currentText = result.upload?.current?.status === 'success'
            ? 'Het actuele roosterbestand is ook bijgewerkt.'
            : 'De archiefkopie is opgeslagen; het actuele bestand blijft op de huidige kalendermaand.';
        setExportMessage(`${result.fileName} staat in het roosterarchief. ${currentText}`, 'success');
    } catch (error) {
        console.error(error);
        setExportMessage(error.message, 'error');
    } finally {
        elements.exportSharePoint.disabled = false;
        elements.exportDownload.disabled = false;
    }
}

function shiftWeek(delta) {
    state.weekStart = addDays(state.weekStart, delta * 7);
    loadWeek();
}

elements.previousWeek.addEventListener('click', () => shiftWeek(-1));
elements.nextWeek.addEventListener('click', () => shiftWeek(1));
elements.currentWeek.addEventListener('click', () => {
    state.weekStart = mondayOf(todayString());
    loadWeek();
});
[elements.employee, elements.location, elements.type].forEach((element) => {
    element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', renderResults);
});
elements.reset.addEventListener('click', () => {
    elements.employee.value = '';
    elements.location.value = '';
    elements.type.value = '';
    renderResults();
});
if (elements.exportDownload) elements.exportDownload.addEventListener('click', downloadMonthlyExport);
if (elements.exportSharePoint) elements.exportSharePoint.addEventListener('click', updateSharePointExport);
if (elements.exportMonth) elements.exportMonth.addEventListener('change', () => setExportMessage(''));

document.addEventListener('authready', (event) => {
    const authState = event.detail || window.currentAuthState || {};
    state.role = authState.role || 'guest';
    applyInitialFilters();
    if (elements.exportMonth && !elements.exportMonth.value) {
        elements.exportMonth.value = String(initialFocusDate || todayString()).slice(0, 7);
    }
    if (elements.exportCard) elements.exportCard.hidden = !['manager', 'admin'].includes(state.role);
    if (elements.exportSharePoint) elements.exportSharePoint.hidden = state.role !== 'admin';
    renderToolbar();
    loadWeek();
});
