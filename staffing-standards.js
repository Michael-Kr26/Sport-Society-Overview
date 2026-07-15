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

const form = document.getElementById('standards-form');
const message = document.getElementById('standards-message');
const editStatus = document.getElementById('edit-status');
const meta = document.getElementById('standards-meta');
const eveningEnabled = document.getElementById('evening-enabled');
const eveningStart = document.getElementById('evening-start');
const eveningEnd = document.getElementById('evening-end');
const eveningMinimum = document.getElementById('evening-minimum');
const eveningDays = document.getElementById('evening-days');
const locationStandards = document.getElementById('location-standards');
const exceptionList = document.getElementById('exception-list');
const addWindowButton = document.getElementById('add-window');
const fullLessonVulnerable = document.getElementById('full-lesson-vulnerable');
const participantThreshold = document.getElementById('participant-threshold');
const reloadButton = document.getElementById('reload-standards');
const saveButton = document.getElementById('save-standards');

let currentPayload = null;
let canEdit = false;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
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

function renderLocations(locations) {
    locationStandards.innerHTML = LOCATIONS.map((location) => {
        const standard = locations[location];
        return `
            <article class="location-card" data-location-card="${escapeHtml(location)}">
                <h3>${escapeHtml(location)}</h3>
                <label class="switch-field">
                    <input type="checkbox" data-field="separateLessonRoom" ${standard.separateLessonRoom ? 'checked' : ''}>
                    <span>Groepslesruimte ligt apart</span>
                </label>
                <div class="location-fields">
                    <label>
                        Lesregel
                        <select data-field="lessonMode">
                            <option value="none" ${standard.lessonMode === 'none' ? 'selected' : ''}>Geen extra norm</option>
                            <option value="advice" ${standard.lessonMode === 'advice' ? 'selected' : ''}>Dubbele bezetting adviseren</option>
                            <option value="hard" ${standard.lessonMode === 'hard' ? 'selected' : ''}>Dubbele bezetting verplicht</option>
                        </select>
                    </label>
                    <label>
                        Minimum
                        <input type="number" min="1" max="10" data-field="lessonMinimum" value="${standard.lessonMinimum}">
                    </label>
                    <label class="excluded-months">
                        Uitgesloten maanden, nummers gescheiden door komma's
                        <input type="text" data-field="excludedMonths" value="${escapeHtml(standard.excludedMonths.join(', '))}" placeholder="Bijvoorbeeld 7, 8">
                    </label>
                </div>
            </article>
        `;
    }).join('');
}

function createExceptionRow(window = {}) {
    const row = document.createElement('article');
    row.className = 'exception-row';
    row.innerHTML = `
        <label>
            Locatie
            <select data-window-field="location">
                ${LOCATIONS.map((location) => `<option ${location === window.location ? 'selected' : ''}>${location}</option>`).join('')}
            </select>
        </label>
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
        <label>
            Omschrijving
            <input type="text" maxlength="140" data-window-field="label" value="${escapeHtml(window.label || 'Enkele bezetting toegestaan')}">
        </label>
        <button type="button" class="standards-secondary-button" data-remove-window>Verwijderen</button>
    `;

    row.querySelector('[data-remove-window]').addEventListener('click', () => row.remove());
    exceptionList.appendChild(row);
}

function renderExceptions(locations) {
    exceptionList.innerHTML = '';
    LOCATIONS.forEach((location) => {
        locations[location].singleCoverageWindows.forEach((window) => {
            createExceptionRow({ location, ...window });
        });
    });

    if (!exceptionList.children.length) {
        createExceptionRow({ location: 'Achterveld', day: 2, start: '08:00', end: '12:00' });
    }
}

function setReadOnly(readOnly) {
    form.classList.toggle('is-readonly', readOnly);
    form.querySelectorAll('input, select, button').forEach((element) => {
        if (element === reloadButton) return;
        element.disabled = readOnly;
    });
    saveButton.hidden = readOnly;
    addWindowButton.hidden = readOnly;
}

function renderStandards(payload) {
    currentPayload = payload;
    canEdit = Boolean(payload.permissions?.canEdit);
    const standards = payload.standards;

    eveningEnabled.checked = standards.eveningPeak.enabled;
    eveningStart.value = standards.eveningPeak.start;
    eveningEnd.value = standards.eveningPeak.end;
    eveningMinimum.value = standards.eveningPeak.minimum;
    renderWeekdays(standards.eveningPeak.days);
    renderLocations(standards.locations);
    renderExceptions(standards.locations);
    fullLessonVulnerable.checked = standards.lessonDemand.markFullOrWaitlistVulnerable;
    participantThreshold.value = standards.lessonDemand.highParticipantThreshold;

    editStatus.textContent = canEdit ? 'Bewerkbaar door admin' : 'Alleen bekijken';
    editStatus.classList.toggle('is-readonly', !canEdit);
    meta.textContent = `Laatst bijgewerkt: ${formatUpdatedAt(payload.updatedAt)}${payload.updatedBy ? ` door ${payload.updatedBy}` : ''}.`;
    setReadOnly(!canEdit);
}

function parseMonths(value) {
    return [...new Set(String(value || '')
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))]
        .sort((a, b) => a - b);
}

function collectLocations() {
    const locations = {};

    document.querySelectorAll('[data-location-card]').forEach((card) => {
        const location = card.dataset.locationCard;
        locations[location] = {
            separateLessonRoom: card.querySelector('[data-field="separateLessonRoom"]').checked,
            lessonMode: card.querySelector('[data-field="lessonMode"]').value,
            lessonMinimum: Number(card.querySelector('[data-field="lessonMinimum"]').value),
            excludedMonths: parseMonths(card.querySelector('[data-field="excludedMonths"]').value),
            singleCoverageWindows: []
        };
    });

    exceptionList.querySelectorAll('.exception-row').forEach((row) => {
        const location = row.querySelector('[data-window-field="location"]').value;
        locations[location].singleCoverageWindows.push({
            day: Number(row.querySelector('[data-window-field="day"]').value),
            start: row.querySelector('[data-window-field="start"]').value,
            end: row.querySelector('[data-window-field="end"]').value,
            label: row.querySelector('[data-window-field="label"]').value.trim()
        });
    });

    return locations;
}

function collectStandards() {
    return {
        version: 1,
        eveningPeak: {
            enabled: eveningEnabled.checked,
            days: [...document.querySelectorAll('input[name="evening-day"]:checked')].map((input) => Number(input.value)),
            start: eveningStart.value,
            end: eveningEnd.value,
            minimum: Number(eveningMinimum.value)
        },
        locations: collectLocations(),
        lessonDemand: {
            markFullOrWaitlistVulnerable: fullLessonVulnerable.checked,
            highParticipantThreshold: Number(participantThreshold.value)
        },
        reformerExcluded: true
    };
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
        setReadOnly(true);
        editStatus.textContent = 'Niet beschikbaar';
        editStatus.classList.add('is-readonly');
        showMessage(error.message, 'error');
    }
}

addWindowButton.addEventListener('click', () => {
    createExceptionRow({ location: 'Achterveld', day: 1, start: '08:00', end: '12:00' });
});

reloadButton.addEventListener('click', loadStandards);

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
        showMessage(payload.message, 'success');
        await loadStandards();
        showMessage('Bezettingsstandaarden opgeslagen en direct actief in de analyse.', 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Standaarden opslaan';
    }
});

loadStandards();
