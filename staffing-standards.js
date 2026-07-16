const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const DAYS = [
    { value: 0, label: 'Zondag' },
    { value: 1, label: 'Maandag' },
    { value: 2, label: 'Dinsdag' },
    { value: 3, label: 'Woensdag' },
    { value: 4, label: 'Donderdag' },
    { value: 5, label: 'Vrijdag' },
    { value: 6, label: 'Zaterdag' }
];
const MONTHS = [
    'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
    'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'
];

const form = document.getElementById('standards-form');
const message = document.getElementById('standards-message');
const editStatus = document.getElementById('edit-status');
const meta = document.getElementById('standards-meta');
const eveningEnabled = document.getElementById('evening-enabled');
const eveningStart = document.getElementById('evening-start');
const eveningEnd = document.getElementById('evening-end');
const eveningMinimum = document.getElementById('evening-minimum');
const eveningDays = document.getElementById('evening-days');
const locationTabs = document.getElementById('location-tabs');
const activeLocationTitle = document.getElementById('active-location-title');
const activeLocationSummary = document.getElementById('active-location-summary');
const locationSeparateRoom = document.getElementById('location-separate-room');
const locationLessonMode = document.getElementById('location-lesson-mode');
const locationLessonMinimum = document.getElementById('location-lesson-minimum');
const locationExcludedMonths = document.getElementById('location-excluded-months');
const exceptionLocationTitle = document.getElementById('exception-location-title');
const exceptionList = document.getElementById('exception-list');
const addWindowButton = document.getElementById('add-window');
const fullLessonVulnerable = document.getElementById('full-lesson-vulnerable');
const participantThreshold = document.getElementById('participant-threshold');
const reloadButton = document.getElementById('reload-standards');
const saveButton = document.getElementById('save-standards');

let currentPayload = null;
let draftStandards = null;
let activeLocation = LOCATIONS[0];
let canEdit = false;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function showMessage(text, type = 'success') {
    message.hidden = false;
    message.className = `standards-message is-${type}`;
    message.textContent = text;
}

function hideMessage() {
    message.hidden = true;
    message.textContent = '';
    message.className = 'standards-message';
}

function formatUpdatedAt(value) {
    if (!value) return 'Nog niet bijgewerkt';
    const parsed = new Date(value.endsWith('Z') ? value : `${value}Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat('nl-NL', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(parsed);
}

function renderWeekdays(selectedDays) {
    eveningDays.innerHTML = DAYS.map((day) => `
        <label>
            <input type="checkbox" name="evening-day" value="${day.value}" ${selectedDays.includes(day.value) ? 'checked' : ''}>
            <span>${day.label}</span>
        </label>
    `).join('');
}

function getLessonModeLabel(mode) {
    if (mode === 'hard') return 'Harde norm';
    if (mode === 'advice') return 'Adviesregel';
    return 'Geen lesregel';
}

function renderLocationTabs() {
    locationTabs.innerHTML = LOCATIONS.map((location) => `
        <button
            type="button"
            class="location-tab ${location === activeLocation ? 'is-active' : ''}"
            data-location-tab="${escapeHtml(location)}"
            role="tab"
            aria-selected="${location === activeLocation}"
        >
            ${escapeHtml(location)}
        </button>
    `).join('');

    locationTabs.querySelectorAll('[data-location-tab]').forEach((button) => {
        button.addEventListener('click', () => switchLocation(button.dataset.locationTab));
    });
}

function renderExcludedMonths(selectedMonths) {
    locationExcludedMonths.innerHTML = MONTHS.map((month, index) => {
        const monthNumber = index + 1;
        return `
            <label>
                <input type="checkbox" name="excluded-month" value="${monthNumber}" ${selectedMonths.includes(monthNumber) ? 'checked' : ''}>
                <span>${month}</span>
            </label>
        `;
    }).join('');
}

function createExceptionRow(window = {}) {
    const row = document.createElement('article');
    row.className = 'exception-row';
    row.innerHTML = `
        <label>
            Dag
            <select data-window-field="day">
                ${DAYS.map((day) => `<option value="${day.value}" ${Number(window.day) === day.value ? 'selected' : ''}>${day.label}</option>`).join('')}
            </select>
        </label>
        <label>
            Vanaf
            <input type="time" data-window-field="start" value="${escapeHtml(window.start || '08:00')}">
        </label>
        <label>
            Tot
            <input type="time" data-window-field="end" value="${escapeHtml(window.end || '12:00')}">
        </label>
        <label class="exception-description">
            Omschrijving
            <input type="text" maxlength="140" data-window-field="label" value="${escapeHtml(window.label || 'Enkele bezetting toegestaan')}">
        </label>
        <button type="button" class="standards-secondary-button" data-remove-window ${canEdit ? '' : 'hidden'}>Verwijderen</button>
    `;

    row.querySelector('[data-remove-window]')?.addEventListener('click', () => {
        row.remove();
        renderExceptionEmptyState();
    });
    exceptionList.appendChild(row);
}

function renderExceptionEmptyState() {
    const existing = exceptionList.querySelector('.exception-empty-state');
    const hasRows = Boolean(exceptionList.querySelector('.exception-row'));

    if (hasRows) {
        existing?.remove();
        return;
    }

    if (!existing) {
        exceptionList.insertAdjacentHTML(
            'beforeend',
            `<p class="exception-empty-state">Voor ${escapeHtml(activeLocation)} zijn geen uitzonderingsvensters ingesteld.</p>`
        );
    }
}

function renderExceptions(windows) {
    exceptionList.innerHTML = '';
    windows.forEach((window) => createExceptionRow(window));
    renderExceptionEmptyState();
}

function readActiveLocationFromForm() {
    if (!draftStandards?.locations?.[activeLocation]) return;

    const standard = draftStandards.locations[activeLocation];
    standard.separateLessonRoom = locationSeparateRoom.checked;
    standard.lessonMode = locationLessonMode.value;
    standard.lessonMinimum = Number(locationLessonMinimum.value);
    standard.excludedMonths = [...locationExcludedMonths.querySelectorAll('input[name="excluded-month"]:checked')]
        .map((input) => Number(input.value))
        .sort((a, b) => a - b);
    standard.singleCoverageWindows = [...exceptionList.querySelectorAll('.exception-row')].map((row) => ({
        day: Number(row.querySelector('[data-window-field="day"]').value),
        start: row.querySelector('[data-window-field="start"]').value,
        end: row.querySelector('[data-window-field="end"]').value,
        label: row.querySelector('[data-window-field="label"]').value.trim()
    }));
}

function renderActiveLocation() {
    const standard = draftStandards.locations[activeLocation];
    activeLocationTitle.textContent = activeLocation;
    exceptionLocationTitle.textContent = `Enkele bezetting toegestaan — ${activeLocation}`;
    activeLocationSummary.textContent = getLessonModeLabel(standard.lessonMode);
    activeLocationSummary.className = `location-summary-pill is-${standard.lessonMode}`;
    locationSeparateRoom.checked = Boolean(standard.separateLessonRoom);
    locationLessonMode.value = standard.lessonMode;
    locationLessonMinimum.value = standard.lessonMinimum;
    renderExcludedMonths(standard.excludedMonths || []);
    renderExceptions(standard.singleCoverageWindows || []);
    applyReadOnlyState();
}

function switchLocation(location) {
    if (!LOCATIONS.includes(location) || location === activeLocation || !draftStandards) return;
    readActiveLocationFromForm();
    activeLocation = location;
    renderLocationTabs();
    renderActiveLocation();
    hideMessage();
}

function applyReadOnlyState() {
    const readOnly = !canEdit;
    form.classList.toggle('is-readonly', readOnly);

    form.querySelectorAll('input, select').forEach((element) => {
        element.disabled = readOnly;
    });

    saveButton.hidden = readOnly;
    addWindowButton.hidden = readOnly;
    exceptionList.querySelectorAll('[data-remove-window]').forEach((button) => {
        button.hidden = readOnly;
    });
}

function renderStandards(payload) {
    currentPayload = payload;
    canEdit = Boolean(payload.permissions?.canEdit);
    draftStandards = clone(payload.standards);

    eveningEnabled.checked = draftStandards.eveningPeak.enabled;
    eveningStart.value = draftStandards.eveningPeak.start;
    eveningEnd.value = draftStandards.eveningPeak.end;
    eveningMinimum.value = draftStandards.eveningPeak.minimum;
    renderWeekdays(draftStandards.eveningPeak.days);

    if (!draftStandards.locations[activeLocation]) {
        activeLocation = LOCATIONS[0];
    }
    renderLocationTabs();
    renderActiveLocation();

    fullLessonVulnerable.checked = draftStandards.lessonDemand.markFullOrWaitlistVulnerable;
    participantThreshold.value = draftStandards.lessonDemand.highParticipantThreshold;

    editStatus.textContent = canEdit ? 'Bewerkbaar door admin' : 'Alleen bekijken';
    editStatus.classList.toggle('is-readonly', !canEdit);
    meta.textContent = `Laatst bijgewerkt: ${formatUpdatedAt(payload.updatedAt)}${payload.updatedBy ? ` door ${payload.updatedBy}` : ''}.`;
    applyReadOnlyState();
}

function collectStandards() {
    readActiveLocationFromForm();

    draftStandards.version = 1;
    draftStandards.eveningPeak = {
        enabled: eveningEnabled.checked,
        days: [...document.querySelectorAll('input[name="evening-day"]:checked')].map((input) => Number(input.value)),
        start: eveningStart.value,
        end: eveningEnd.value,
        minimum: Number(eveningMinimum.value)
    };
    draftStandards.lessonDemand = {
        markFullOrWaitlistVulnerable: fullLessonVulnerable.checked,
        highParticipantThreshold: Number(participantThreshold.value)
    };
    draftStandards.reformerExcluded = true;

    return clone(draftStandards);
}

async function loadStandards() {
    hideMessage();
    editStatus.textContent = 'Laden...';

    try {
        const response = await fetch('/api/staffing-standards');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Standaarden konden niet worden geladen.');
        renderStandards(payload);
    } catch (error) {
        canEdit = false;
        applyReadOnlyState();
        editStatus.textContent = 'Niet beschikbaar';
        editStatus.classList.add('is-readonly');
        showMessage(error.message, 'error');
    }
}

addWindowButton.addEventListener('click', () => {
    exceptionList.querySelector('.exception-empty-state')?.remove();
    createExceptionRow({ day: 1, start: '08:00', end: '12:00' });
    applyReadOnlyState();
});

reloadButton.addEventListener('click', loadStandards);

locationLessonMode.addEventListener('change', () => {
    activeLocationSummary.textContent = getLessonModeLabel(locationLessonMode.value);
    activeLocationSummary.className = `location-summary-pill is-${locationLessonMode.value}`;
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit) return;

    hideMessage();
    saveButton.disabled = true;
    saveButton.textContent = 'Opslaan...';

    try {
        const response = await fetch('/api/staffing-standards', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ standards: collectStandards() })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Opslaan is mislukt.');
        await loadStandards();
        showMessage('Alle bezettingsstandaarden zijn opgeslagen en direct actief in de analyse.', 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Alle standaarden opslaan';
    }
});

loadStandards();
