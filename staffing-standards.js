const ALL_LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const DAYS = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'].map((label, value) => ({ value, label }));
const MONTHS = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];
const FIXED_SHIFT_LABELS = {
    Barneveld: 'Ma–do 07:00–12:00 en 16:00–21:30 · vr 07:00–12:00 · za 08:30–12:00',
    Voorthuizen: 'Ma–do 07:00–12:00 en 16:00–21:30 · vr 07:00–12:00 · za 08:30–12:00',
    Wekerom: 'Ma–do 07:00–12:00 en 16:00–21:30 · vr 07:00–12:00 · za 08:30–12:00',
    Achterveld: 'Ma–do 07:00–12:00 en 16:00–21:30 · vr 07:00–12:00 · za–zo 08:30–12:00',
    Harskamp: 'Ma–do 08:30–12:00 en 16:00–21:00 · vr–za 08:30–12:00'
};
const $ = (id) => document.getElementById(id);
const form = $('standards-form');
const message = $('standards-message');
const editStatus = $('edit-status');
const meta = $('standards-meta');
const eveningEnabled = $('evening-enabled');
const eveningStart = $('evening-start');
const eveningEnd = $('evening-end');
const eveningMinimum = $('evening-minimum');
const eveningDays = $('evening-days');
const locationTabs = $('location-tabs');
const locationPickerCard = document.querySelector('.location-picker-card');
const activeLocationTitle = $('active-location-title');
const activeLocationSummary = $('active-location-summary');
const activeStandardShifts = $('active-standard-shifts');
const locationSeparateRoom = $('location-separate-room');
const locationLessonMode = $('location-lesson-mode');
const locationLessonMinimum = $('location-lesson-minimum');
const locationExcludedMonths = $('location-excluded-months');
const exceptionLocationTitle = $('exception-location-title');
const exceptionList = $('exception-list');
const addWindowButton = $('add-window');
const fullLessonVulnerable = $('full-lesson-vulnerable');
const participantThreshold = $('participant-threshold');
const reloadButton = $('reload-standards');
const saveButton = $('save-standards');
let draftStandards = null;
let availableLocations = [];
let activeLocation = null;
let canEdit = false;
let canEditGlobal = false;

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const clone = (value) => JSON.parse(JSON.stringify(value));

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
    const parsed = new Date(String(value).endsWith('Z') ? value : `${value}Z`);
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('nl-NL', {
        dateStyle: 'medium', timeStyle: 'short'
    }).format(parsed);
}

function lessonModeLabel(mode) {
    return mode === 'hard' ? 'Harde norm' : mode === 'advice' ? 'Adviesregel' : 'Geen lesregel';
}

function renderWeekdays(selected = []) {
    eveningDays.innerHTML = DAYS.map((day) => `<label><input type="checkbox" name="evening-day" value="${day.value}" ${selected.includes(day.value) ? 'checked' : ''}><span>${day.label}</span></label>`).join('');
}

function renderLocationTabs() {
    locationTabs.innerHTML = availableLocations.map((location) => `<button type="button" class="location-tab ${location === activeLocation ? 'is-active' : ''}" data-location-tab="${escapeHtml(location)}" role="tab" aria-selected="${location === activeLocation}">${escapeHtml(location)}</button>`).join('');
    locationTabs.querySelectorAll('[data-location-tab]').forEach((button) => button.addEventListener('click', () => switchLocation(button.dataset.locationTab)));
    locationPickerCard.hidden = availableLocations.length <= 1;
}

function renderExcludedMonths(selected = []) {
    locationExcludedMonths.innerHTML = MONTHS.map((month, index) => `<label><input type="checkbox" name="excluded-month" value="${index + 1}" ${selected.includes(index + 1) ? 'checked' : ''}><span>${month}</span></label>`).join('');
}

function createExceptionRow(window = {}) {
    const row = document.createElement('article');
    row.className = 'exception-row';
    row.innerHTML = `<label>Dag<select data-window-field="day">${DAYS.map((day) => `<option value="${day.value}" ${Number(window.day) === day.value ? 'selected' : ''}>${day.label}</option>`).join('')}</select></label>
        <label>Vanaf<input type="time" data-window-field="start" value="${escapeHtml(window.start || '08:00')}"></label>
        <label>Tot<input type="time" data-window-field="end" value="${escapeHtml(window.end || '12:00')}"></label>
        <label class="exception-description">Omschrijving<input type="text" maxlength="140" data-window-field="label" value="${escapeHtml(window.label || 'Enkele bezetting toegestaan')}"></label>
        <button type="button" class="standards-secondary-button" data-remove-window>Verwijderen</button>`;
    row.querySelector('[data-remove-window]').addEventListener('click', () => {
        row.remove();
        renderExceptionEmptyState();
    });
    exceptionList.appendChild(row);
}

function renderExceptionEmptyState() {
    const hasRows = Boolean(exceptionList.querySelector('.exception-row'));
    exceptionList.querySelector('.exception-empty-state')?.remove();
    if (!hasRows) {
        exceptionList.insertAdjacentHTML('beforeend', `<p class="exception-empty-state">Voor ${escapeHtml(activeLocation)} zijn geen uitzonderingsvensters ingesteld.</p>`);
    }
}

function renderExceptions(windows = []) {
    exceptionList.innerHTML = '';
    windows.forEach(createExceptionRow);
    renderExceptionEmptyState();
}

function readActiveLocationFromForm() {
    const standard = draftStandards?.locations?.[activeLocation];
    if (!standard || !canEdit) return;
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

function applyReadOnlyState() {
    form.classList.toggle('is-readonly', !canEdit);
    form.querySelectorAll('input, select').forEach((element) => {
        element.disabled = !canEdit;
    });

    if (canEdit && !canEditGlobal) {
        [eveningEnabled, eveningStart, eveningEnd, eveningMinimum, fullLessonVulnerable, participantThreshold]
            .forEach((element) => { element.disabled = true; });
        eveningDays.querySelectorAll('input').forEach((element) => { element.disabled = true; });
    }

    saveButton.hidden = !canEdit;
    addWindowButton.hidden = !canEdit;
    reloadButton.hidden = !canEdit;
    exceptionList.querySelectorAll('[data-remove-window]').forEach((button) => {
        button.hidden = !canEdit;
    });
}

function renderActiveLocation() {
    const standard = draftStandards?.locations?.[activeLocation];
    if (!standard) return showMessage('Voor deze vestiging zijn geen standaarden gevonden.', 'error');
    activeLocationTitle.textContent = activeLocation;
    exceptionLocationTitle.textContent = `Enkele bezetting toegestaan — ${activeLocation}`;
    activeLocationSummary.textContent = lessonModeLabel(standard.lessonMode);
    activeLocationSummary.className = `location-summary-pill is-${standard.lessonMode}`;
    activeStandardShifts.textContent = FIXED_SHIFT_LABELS[activeLocation] || 'Geen vaste standaarddiensten ingesteld.';
    locationSeparateRoom.checked = Boolean(standard.separateLessonRoom);
    locationLessonMode.value = standard.lessonMode;
    locationLessonMinimum.value = standard.lessonMinimum;
    renderExcludedMonths(standard.excludedMonths || []);
    renderExceptions(standard.singleCoverageWindows || []);
    applyReadOnlyState();
}

function switchLocation(location) {
    if (!availableLocations.includes(location) || location === activeLocation || !draftStandards) return;
    readActiveLocationFromForm();
    activeLocation = location;
    renderLocationTabs();
    renderActiveLocation();
    hideMessage();
}

function renderStandards(payload) {
    canEdit = Boolean(payload.permissions?.canEdit);
    canEditGlobal = Boolean(payload.permissions?.canEditGlobal);
    availableLocations = (payload.permissions?.allowedLocations || ALL_LOCATIONS)
        .filter((location) => payload.standards?.locations?.[location]);
    draftStandards = clone(payload.standards);
    activeLocation = availableLocations.includes(activeLocation) ? activeLocation : availableLocations[0];
    if (!activeLocation) throw new Error('Er is geen vestiging aan dit profiel gekoppeld.');

    eveningEnabled.checked = draftStandards.eveningPeak.enabled;
    eveningStart.value = draftStandards.eveningPeak.start;
    eveningEnd.value = draftStandards.eveningPeak.end;
    eveningMinimum.value = draftStandards.eveningPeak.minimum;
    renderWeekdays(draftStandards.eveningPeak.days);
    renderLocationTabs();
    renderActiveLocation();
    fullLessonVulnerable.checked = draftStandards.lessonDemand.markFullOrWaitlistVulnerable;
    participantThreshold.value = draftStandards.lessonDemand.highParticipantThreshold;

    editStatus.textContent = canEditGlobal
        ? 'Admin · alle vestigingen en algemene regels bewerkbaar'
        : `Manager · ${activeLocation} bewerkbaar`;
    editStatus.classList.toggle('is-readonly', !canEdit);
    meta.textContent = `Laatst bijgewerkt: ${formatUpdatedAt(payload.updatedAt)}${payload.updatedBy ? ` door ${payload.updatedBy}` : ''}.`;
    applyReadOnlyState();
}

function collectStandards() {
    readActiveLocationFromForm();
    draftStandards.version = 1;
    if (canEditGlobal) {
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
    }
    draftStandards.reformerExcluded = true;
    return clone(draftStandards);
}

async function loadStandards() {
    hideMessage();
    editStatus.textContent = 'Laden...';
    try {
        const response = await fetch('/api/location-staffing-standards');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Standaarden konden niet worden geladen.');
        renderStandards(payload);
    } catch (error) {
        canEdit = false;
        canEditGlobal = false;
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
    activeLocationSummary.textContent = lessonModeLabel(locationLessonMode.value);
    activeLocationSummary.className = `location-summary-pill is-${locationLessonMode.value}`;
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit) return;
    hideMessage();
    saveButton.disabled = true;
    saveButton.textContent = 'Opslaan...';
    try {
        const response = await fetch('/api/location-staffing-standards', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ standards: collectStandards() })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Opslaan is mislukt.');
        await loadStandards();
        showMessage(payload.message || 'Bezettingsstandaarden opgeslagen en direct actief in de analyse.', 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Standaarden opslaan';
    }
});

loadStandards();
