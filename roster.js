'use strict';

const LOCATION_CODE_BY_NAME = {
    Achterveld: 'AVE',
    Barneveld: 'BVE',
    Voorthuizen: 'VHU',
    Wekerom: 'WEK',
    Harskamp: 'HAR'
};
const DAY_NAMES = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const DAY_NAMES_LONG = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const GROUPS = [
    { key: 'morning', label: 'Ochtend' },
    { key: 'evening', label: 'Middag / avond' },
    { key: 'other', label: 'Overig' }
];

const elements = {
    previousWeek: document.getElementById('previous-week'),
    currentWeek: document.getElementById('current-week'),
    nextWeek: document.getElementById('next-week'),
    weekNumber: document.getElementById('week-number'),
    weekRange: document.getElementById('week-range'),
    location: document.getElementById('planner-location'),
    versionSwitch: document.getElementById('version-switch'),
    contextCopy: document.getElementById('planner-context-copy'),
    createDraft: document.getElementById('create-draft'),
    addShift: document.getElementById('add-shift'),
    stateBadge: document.getElementById('roster-state-badge'),
    summary: document.getElementById('roster-summary'),
    heading: document.getElementById('planner-heading'),
    versionMeta: document.getElementById('planner-version-meta'),
    mobileDayTabs: document.getElementById('mobile-day-tabs'),
    weekGrid: document.getElementById('week-grid'),
    validationState: document.getElementById('validation-state'),
    validationResults: document.getElementById('validation-results'),
    hoursResults: document.getElementById('hours-results'),
    error: document.getElementById('planner-error'),
    success: document.getElementById('planner-success'),
    backdrop: document.getElementById('shift-drawer-backdrop'),
    drawer: document.getElementById('shift-drawer'),
    drawerTitle: document.getElementById('shift-drawer-title'),
    closeDrawer: document.getElementById('close-shift-drawer'),
    shiftForm: document.getElementById('shift-form'),
    shiftUid: document.getElementById('shift-uid'),
    shiftEmployee: document.getElementById('shift-employee'),
    eligibilityNote: document.getElementById('employee-eligibility-note'),
    shiftDate: document.getElementById('shift-date'),
    shiftType: document.getElementById('shift-type'),
    shiftStart: document.getElementById('shift-start'),
    shiftEnd: document.getElementById('shift-end'),
    shiftNote: document.getElementById('shift-note'),
    shiftFormMessage: document.getElementById('shift-form-message'),
    deleteShift: document.getElementById('delete-shift'),
    cancelShift: document.getElementById('cancel-shift')
};

const query = new URLSearchParams(window.location.search);
const initialFocusDate = query.get('focusDate');
const initialLocation = query.get('location');
const initialFocusName = query.get('name');

const state = {
    weekStart: mondayOf(initialFocusDate || todayString()),
    locationCode: LOCATION_CODE_BY_NAME[initialLocation] || (initialLocation || 'AVE').toUpperCase(),
    requestedView: 'auto',
    context: null,
    selectedMobileDay: initialFocusDate || null,
    focusName: initialFocusName || null,
    loading: false
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

function formatDate(dateString, options = { day: 'numeric', month: 'short' }) {
    return new Intl.DateTimeFormat('nl-NL', options).format(dateObject(dateString));
}

function formatHours(minutes) {
    const value = Number(minutes || 0) / 60;
    return Number.isInteger(value) ? `${value} u` : `${value.toFixed(1).replace('.', ',')} u`;
}

function groupForShift(shift) {
    const hour = Number(String(shift.startTime || '00:00').slice(0, 2));
    if (hour < 13) return 'morning';
    if (hour >= 15) return 'evening';
    return 'other';
}

function setMessage(element, message) {
    if (!message) {
        element.hidden = true;
        element.textContent = '';
        return;
    }
    element.textContent = message;
    element.hidden = false;
}

function clearMessages() {
    setMessage(elements.error, '');
    setMessage(elements.success, '');
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
        const error = new Error(payload?.message || 'De aanvraag is mislukt.');
        error.status = response.status;
        error.code = payload?.code || null;
        error.details = payload?.details || null;
        throw error;
    }
    return payload;
}

function updateUrl() {
    const params = new URLSearchParams();
    params.set('focusDate', state.selectedMobileDay || state.weekStart);
    params.set('location', state.context?.location?.name || state.locationCode);
    if (state.focusName) params.set('name', state.focusName);
    window.history.replaceState(null, '', `roster.html?${params.toString()}`);
}

async function loadContext() {
    if (state.loading) return;
    state.loading = true;
    clearMessages();
    elements.stateBadge.className = 'roster-state-badge is-loading';
    elements.stateBadge.textContent = 'Laden';
    try {
        const params = new URLSearchParams({
            location: state.locationCode,
            weekStart: state.weekStart,
            view: state.requestedView
        });
        state.context = await api(`/api/roster-planner/context?${params.toString()}`);
        state.locationCode = state.context.location.code;
        state.requestedView = state.context.views.selected;
        if (!state.selectedMobileDay || state.selectedMobileDay < state.context.week.weekStart || state.selectedMobileDay > state.context.week.weekEnd) {
            const today = todayString();
            state.selectedMobileDay = today >= state.context.week.weekStart && today <= state.context.week.weekEnd
                ? today : state.context.week.weekStart;
        }
        render();
        updateUrl();
    } catch (error) {
        console.error(error);
        setMessage(elements.error, error.message);
        elements.weekGrid.innerHTML = '<p class="empty-state">Rooster kon niet worden geladen.</p>';
        elements.stateBadge.className = 'roster-state-badge is-error';
        elements.stateBadge.textContent = 'Fout';
    } finally {
        state.loading = false;
    }
}

function renderLocationSelect() {
    const context = state.context;
    elements.location.innerHTML = context.locations.map((location) => `
        <option value="${escapeHtml(location.code)}" ${location.code === context.location.code ? 'selected' : ''}>
            ${escapeHtml(location.name)}${location.canEdit ? '' : ''}
        </option>
    `).join('');
}

function renderToolbar() {
    const context = state.context;
    elements.weekNumber.textContent = `Week ${context.week.isoWeek}`;
    elements.weekRange.textContent = `${formatDate(context.week.weekStart)} – ${formatDate(context.week.weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    elements.heading.textContent = `${context.location.name} · week ${context.week.isoWeek}`;

    const isDraft = context.views.selected === 'draft';
    const hasVersion = Boolean(context.selectedVersion);
    const isPublished = hasVersion && context.selectedVersion.state === 'published';
    elements.stateBadge.className = `roster-state-badge ${isDraft ? 'is-draft' : (isPublished ? 'is-published' : 'is-empty')}`;
    elements.stateBadge.textContent = isDraft ? 'Concept' : (isPublished ? 'Gepubliceerd' : 'Geen rooster');

    const draftButton = elements.versionSwitch.querySelector('[data-view="draft"]');
    const publishedButton = elements.versionSwitch.querySelector('[data-view="published"]');
    draftButton.hidden = !context.permissions.canViewDraft;
    draftButton.disabled = !context.permissions.canViewDraft;
    publishedButton.disabled = !context.views.hasPublished;
    [draftButton, publishedButton].forEach((button) => button.classList.toggle('is-active', button.dataset.view === context.views.selected));
    elements.versionSwitch.hidden = !context.permissions.canViewDraft && !context.views.hasPublished;

    elements.createDraft.hidden = !context.permissions.canEdit || context.views.hasDraft;
    elements.addShift.hidden = !(context.permissions.canEdit && context.views.selected === 'draft' && context.selectedVersion);

    if (context.views.selected === 'draft') {
        elements.contextCopy.textContent = context.selectedVersion
            ? `Je werkt in concept v${context.selectedVersion.versionNo}. Wijzigingen zijn nog niet gepubliceerd.`
            : 'Voor deze week bestaat nog geen concept.';
    } else if (context.selectedVersion) {
        elements.contextCopy.textContent = `Gepubliceerde versie v${context.selectedVersion.versionNo}. Deze versie is alleen-lezen.`;
    } else {
        elements.contextCopy.textContent = context.permissions.canEdit
            ? 'Er is voor deze week nog geen rooster. Maak een concept om te beginnen.'
            : 'Er is voor deze week nog geen gepubliceerd rooster.';
    }

    elements.versionMeta.textContent = context.selectedVersion
        ? `v${context.selectedVersion.versionNo} · revisie ${context.selectedVersion.revision}`
        : 'Nog geen versie';
}

function renderSummary() {
    const context = state.context;
    const validationCount = (context.validation?.errors?.length || 0) + (context.validation?.warnings?.length || 0);
    const cards = [
        [context.summary.shiftCount, 'Diensten'],
        [formatHours(context.summary.plannedMinutes), 'Geplande uren'],
        [context.summary.openShiftCount, 'Open diensten'],
        [context.validation ? validationCount : '-', 'Aandachtspunten']
    ];
    elements.summary.innerHTML = cards.map(([value, label]) => `
        <article class="roster-summary-card">
            <span class="summary-value">${escapeHtml(value)}</span>
            <span class="summary-label">${escapeHtml(label)}</span>
        </article>
    `).join('');
}

function validationByShift() {
    const map = new Map();
    const validation = state.context.validation;
    if (!validation) return map;
    for (const item of [...validation.errors.map((entry) => ({ ...entry, severity: 'error' })), ...validation.warnings.map((entry) => ({ ...entry, severity: 'warning' }))]) {
        if (!item.shiftUid) continue;
        if (!map.has(item.shiftUid)) map.set(item.shiftUid, []);
        map.get(item.shiftUid).push(item);
    }
    return map;
}

function shiftCard(shift, issues) {
    const canEdit = state.context.permissions.canEdit && state.context.views.selected === 'draft';
    const focused = state.focusName && String(shift.employeeName || '').toLowerCase().includes(state.focusName.toLowerCase());
    return `
        <button type="button" class="planner-shift-card ${shift.open ? 'is-open' : ''} ${issues?.length ? 'has-issue' : ''} ${focused ? 'is-focused' : ''}"
            data-shift-uid="${escapeHtml(shift.shiftUid)}" ${canEdit ? '' : 'disabled'}>
            <span class="planner-shift-time">${escapeHtml(shift.startTime)}–${escapeHtml(shift.endTime)}${shift.crossesMidnight ? ' +1' : ''}</span>
            <strong>${shift.open ? 'Open dienst' : escapeHtml(shift.employeeName)}</strong>
            <span class="planner-shift-type">${escapeHtml(shift.shiftTypeLabel)}</span>
            ${shift.note ? `<span class="planner-shift-note">${escapeHtml(shift.note)}</span>` : ''}
            ${issues?.length ? `<span class="planner-issue-row">${issues.slice(0, 2).map((issue) => `<span class="planner-issue-dot ${issue.severity}">${issue.severity === 'error' ? '!' : '•'}</span>`).join('')}</span>` : ''}
        </button>
    `;
}

function renderDay(date, dayIndex, issueMap) {
    const shifts = (state.context.selectedVersion?.shifts || []).filter((shift) => shift.date === date);
    const canEdit = state.context.permissions.canEdit && state.context.views.selected === 'draft' && state.context.selectedVersion;
    const grouped = Object.fromEntries(GROUPS.map((group) => [group.key, []]));
    shifts.forEach((shift) => grouped[groupForShift(shift)].push(shift));
    Object.values(grouped).forEach((group) => group.sort((a, b) => a.startTime.localeCompare(b.startTime) || String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'nl')));

    const sections = GROUPS.filter((group) => grouped[group.key].length).map((group) => `
        <section class="planner-day-group">
            <div class="planner-day-group-title">${group.label}</div>
            <div class="planner-shift-list">
                ${grouped[group.key].map((shift) => shiftCard(shift, issueMap.get(shift.shiftUid))).join('')}
            </div>
        </section>
    `).join('');

    return `
        <article class="planner-day ${date === state.selectedMobileDay ? 'is-mobile-selected' : ''}" data-date="${date}">
            <div class="planner-day-header">
                <div>
                    <span>${DAY_NAMES_LONG[dayIndex]}</span>
                    <strong>${formatDate(date, { day: 'numeric', month: 'short' })}</strong>
                </div>
                ${canEdit ? `<button type="button" class="planner-day-add" data-add-date="${date}" aria-label="Dienst toevoegen op ${DAY_NAMES_LONG[dayIndex]}">+</button>` : ''}
            </div>
            <div class="planner-day-body">
                ${sections || '<p class="planner-day-empty">Geen diensten</p>'}
            </div>
        </article>
    `;
}

function renderPlanner() {
    const issueMap = validationByShift();
    const dates = Array.from({ length: 7 }, (_, index) => addDays(state.context.week.weekStart, index));
    elements.mobileDayTabs.innerHTML = dates.map((date, index) => {
        const count = (state.context.selectedVersion?.shifts || []).filter((shift) => shift.date === date).length;
        return `<button type="button" class="mobile-day-tab ${date === state.selectedMobileDay ? 'is-active' : ''}" data-mobile-date="${date}">
            <span>${DAY_NAMES[index]}</span><strong>${formatDate(date, { day: 'numeric' })}</strong><small>${count}</small>
        </button>`;
    }).join('');

    if (!state.context.selectedVersion) {
        elements.weekGrid.innerHTML = `
            <div class="planner-empty-week">
                <strong>${state.context.views.selected === 'draft' ? 'Nog geen concept' : 'Nog geen gepubliceerd rooster'}</strong>
                <p>${state.context.permissions.canEdit && state.context.views.selected === 'draft' ? 'Maak een concept om deze week te plannen.' : 'Er zijn voor deze selectie nog geen diensten beschikbaar.'}</p>
            </div>`;
        return;
    }

    elements.weekGrid.innerHTML = dates.map((date, index) => renderDay(date, index, issueMap)).join('');
    elements.weekGrid.querySelectorAll('[data-shift-uid]').forEach((button) => {
        button.addEventListener('click', () => openExistingShift(button.dataset.shiftUid));
    });
    elements.weekGrid.querySelectorAll('[data-add-date]').forEach((button) => {
        button.addEventListener('click', () => openNewShift(button.dataset.addDate));
    });
    elements.mobileDayTabs.querySelectorAll('[data-mobile-date]').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedMobileDay = button.dataset.mobileDate;
            renderPlanner();
            updateUrl();
        });
    });
}

function aggregateValidation(items) {
    const map = new Map();
    for (const item of items) {
        const key = item.code || item.message;
        if (!map.has(key)) map.set(key, { code: key, message: item.message, count: 0 });
        map.get(key).count += 1;
    }
    return [...map.values()];
}

function renderValidation() {
    const validation = state.context.validation;
    if (!validation) {
        elements.validationState.textContent = state.context.views.selected === 'published' ? 'Alleen-lezen' : '-';
        elements.validationState.className = 'validation-state';
        elements.validationResults.innerHTML = '<p class="empty-state">Validatie wordt op de actieve conceptversie uitgevoerd.</p>';
        return;
    }
    elements.validationState.textContent = validation.valid ? 'Geen blokkades' : `${validation.errors.length} blokkade(s)`;
    elements.validationState.className = `validation-state ${validation.valid ? 'is-valid' : 'is-invalid'}`;
    const errors = aggregateValidation(validation.errors);
    const warnings = aggregateValidation(validation.warnings);
    const rows = [
        ...errors.map((item) => ({ ...item, severity: 'error' })),
        ...warnings.map((item) => ({ ...item, severity: 'warning' }))
    ];
    if (!rows.length) {
        elements.validationResults.innerHTML = '<div class="validation-empty">✓ Geen roosterconflicten of waarschuwingen.</div>';
        return;
    }
    elements.validationResults.innerHTML = rows.map((item) => `
        <div class="validation-item ${item.severity}">
            <span class="validation-icon">${item.severity === 'error' ? '!' : 'i'}</span>
            <div><strong>${escapeHtml(item.message)}</strong><span>${item.count}× in deze controle</span></div>
        </div>
    `).join('');
}

function renderHours() {
    const projection = state.context.hourBankProjection;
    if (!projection) {
        elements.hoursResults.innerHTML = '<p class="empty-state">De urenbankprojectie wordt bij een concept getoond.</p>';
        return;
    }
    const relevant = projection.filter((employee) => employee.plannedMinutes || employee.contractMinutes || employee.hourBankDeltaMinutes);
    if (!relevant.length) {
        elements.hoursResults.innerHTML = '<p class="empty-state">Nog geen geplande contracturen in deze week.</p>';
        return;
    }
    elements.hoursResults.innerHTML = `
        <div class="hours-table-head"><span>Medewerker</span><span>Gepland</span><span>Contract</span><span>Δ</span></div>
        ${relevant.map((employee) => {
            const delta = employee.hourBankDeltaMinutes;
            const deltaClass = delta === null ? '' : (delta > 0 ? 'is-plus' : (delta < 0 ? 'is-minus' : ''));
            return `<div class="hours-row">
                <strong>${escapeHtml(employee.employeeName || employee.employeeCode || '-')}</strong>
                <span>${formatHours(employee.plannedMinutes)}</span>
                <span>${employee.contractMinutes === null ? '-' : formatHours(employee.contractMinutes)}</span>
                <span class="${deltaClass}">${delta === null ? '-' : `${delta > 0 ? '+' : ''}${formatHours(delta)}`}</span>
            </div>`;
        }).join('')}
    `;
}

function render() {
    renderLocationSelect();
    renderToolbar();
    renderSummary();
    renderPlanner();
    renderValidation();
    renderHours();
}

function fillEmployeeOptions(selectedEmployeeId = '') {
    const employees = state.context?.employees || [];
    elements.shiftEmployee.innerHTML = '<option value="">Open dienst</option>' + employees.map((employee) => `
        <option value="${employee.employeeId}" ${String(employee.employeeId) === String(selectedEmployeeId) ? 'selected' : ''}>
            ${escapeHtml(employee.employeeName)}${employee.eligibleAtLocation ? '' : ' · buiten vaste locatie'}
        </option>
    `).join('');
    updateEligibilityNote();
}

function updateEligibilityNote() {
    const value = Number(elements.shiftEmployee.value);
    if (!value) {
        elements.eligibilityNote.textContent = 'Zonder medewerker wordt dit een open dienst.';
        return;
    }
    const employee = (state.context?.employees || []).find((item) => item.employeeId === value);
    elements.eligibilityNote.textContent = employee && !employee.eligibleAtLocation
        ? 'Deze medewerker staat niet structureel voor deze vestiging ingesteld. Opslaan blijft mogelijk en geeft een waarschuwing.'
        : '';
}

function openDrawer() {
    elements.backdrop.hidden = false;
    elements.drawer.classList.add('is-open');
    elements.drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
}

function closeDrawer() {
    elements.drawer.classList.remove('is-open');
    elements.drawer.setAttribute('aria-hidden', 'true');
    elements.backdrop.hidden = true;
    document.body.classList.remove('drawer-open');
    setMessage(elements.shiftFormMessage, '');
}

function openNewShift(date = state.selectedMobileDay || state.context.week.weekStart) {
    if (!(state.context.permissions.canEdit && state.context.views.selected === 'draft' && state.context.selectedVersion)) return;
    elements.drawerTitle.textContent = 'Dienst toevoegen';
    elements.shiftUid.value = '';
    fillEmployeeOptions('');
    elements.shiftDate.value = date;
    elements.shiftType.value = 'floor';
    elements.shiftStart.value = '08:30';
    elements.shiftEnd.value = '12:00';
    elements.shiftNote.value = '';
    elements.deleteShift.hidden = true;
    openDrawer();
}

function openExistingShift(shiftUid) {
    const shift = state.context.selectedVersion?.shifts.find((item) => item.shiftUid === shiftUid);
    if (!shift || !state.context.permissions.canEdit || state.context.views.selected !== 'draft') return;
    elements.drawerTitle.textContent = shift.open ? 'Open dienst wijzigen' : 'Dienst wijzigen';
    elements.shiftUid.value = shift.shiftUid;
    fillEmployeeOptions(shift.employeeId || '');
    elements.shiftDate.value = shift.date;
    elements.shiftType.value = shift.shiftType;
    elements.shiftStart.value = shift.startTime;
    elements.shiftEnd.value = shift.endTime;
    elements.shiftNote.value = shift.note || '';
    elements.deleteShift.hidden = false;
    openDrawer();
}

async function createDraft() {
    clearMessages();
    elements.createDraft.disabled = true;
    try {
        state.context = await api('/api/roster-planner/draft', {
            method: 'POST',
            body: JSON.stringify({ location: state.locationCode, weekStart: state.weekStart, changeNote: 'Weekplanner' })
        });
        state.requestedView = 'draft';
        render();
        setMessage(elements.success, 'Concept is klaar om te bewerken.');
    } catch (error) {
        setMessage(elements.error, error.message);
    } finally {
        elements.createDraft.disabled = false;
    }
}

async function saveShift(event) {
    event.preventDefault();
    setMessage(elements.shiftFormMessage, '');
    const version = state.context.selectedVersion;
    if (!version || version.state !== 'draft') return;
    const payload = {
        versionId: version.id,
        expectedRevision: version.revision,
        employeeId: elements.shiftEmployee.value || null,
        date: elements.shiftDate.value,
        startTime: elements.shiftStart.value,
        endTime: elements.shiftEnd.value,
        shiftType: elements.shiftType.value,
        note: elements.shiftNote.value.trim() || null
    };
    const shiftUid = elements.shiftUid.value;
    try {
        state.context = shiftUid
            ? await api(`/api/roster-planner/shifts/${encodeURIComponent(shiftUid)}`, { method: 'PATCH', body: JSON.stringify(payload) })
            : await api('/api/roster-planner/shifts', { method: 'POST', body: JSON.stringify(payload) });
        state.requestedView = 'draft';
        closeDrawer();
        render();
        setMessage(elements.success, shiftUid ? 'Dienst is bijgewerkt in het concept.' : 'Dienst is toegevoegd aan het concept.');
    } catch (error) {
        setMessage(elements.shiftFormMessage, error.message);
        if (error.code === 'ROSTER_VERSION_CONFLICT') await loadContext();
    }
}

async function deleteCurrentShift() {
    const version = state.context.selectedVersion;
    const shiftUid = elements.shiftUid.value;
    if (!version || !shiftUid) return;
    const shift = version.shifts.find((item) => item.shiftUid === shiftUid);
    if (!window.confirm(`Dienst ${shift?.employeeName || 'open dienst'} ${shift?.startTime || ''}–${shift?.endTime || ''} verwijderen uit dit concept?`)) return;
    try {
        state.context = await api(`/api/roster-planner/shifts/${encodeURIComponent(shiftUid)}`, {
            method: 'DELETE',
            body: JSON.stringify({
                versionId: version.id,
                expectedRevision: version.revision,
                reason: 'Verwijderd via weekplanner'
            })
        });
        closeDrawer();
        render();
        setMessage(elements.success, 'Dienst is uit het concept verwijderd.');
    } catch (error) {
        setMessage(elements.shiftFormMessage, error.message);
        if (error.code === 'ROSTER_VERSION_CONFLICT') await loadContext();
    }
}

function shiftWeek(delta) {
    state.weekStart = addDays(state.weekStart, delta * 7);
    state.selectedMobileDay = state.weekStart;
    loadContext();
}

elements.previousWeek.addEventListener('click', () => shiftWeek(-1));
elements.nextWeek.addEventListener('click', () => shiftWeek(1));
elements.currentWeek.addEventListener('click', () => {
    state.weekStart = mondayOf(todayString());
    state.selectedMobileDay = todayString();
    loadContext();
});
elements.location.addEventListener('change', () => {
    state.locationCode = elements.location.value;
    state.requestedView = 'auto';
    loadContext();
});
elements.versionSwitch.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
        if (button.disabled) return;
        state.requestedView = button.dataset.view;
        loadContext();
    });
});
elements.createDraft.addEventListener('click', createDraft);
elements.addShift.addEventListener('click', () => openNewShift());
elements.closeDrawer.addEventListener('click', closeDrawer);
elements.cancelShift.addEventListener('click', closeDrawer);
elements.backdrop.addEventListener('click', closeDrawer);
elements.shiftEmployee.addEventListener('change', updateEligibilityNote);
elements.shiftForm.addEventListener('submit', saveShift);
elements.deleteShift.addEventListener('click', deleteCurrentShift);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.drawer.classList.contains('is-open')) closeDrawer();
});

document.addEventListener('authready', () => loadContext());
