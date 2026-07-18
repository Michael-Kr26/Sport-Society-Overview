const form = document.getElementById('change-form');
const formMessage = document.getElementById('form-message');
const changeDate = document.getElementById('change-date');
const reportedDate = document.getElementById('change-reported-date');
const locationField = document.getElementById('change-location');
const employeeField = document.getElementById('change-employee');
const employee2Field = document.getElementById('change-employee2');
const typeField = document.getElementById('change-type');
const syncRosterField = document.getElementById('change-sync-roster');
const sourceFields = document.getElementById('change-source-fields');
const sourceShiftField = document.getElementById('change-source-shift');
const sourceMessage = document.getElementById('change-source-message');
const timeFields = document.getElementById('change-time-fields');
const startTimeField = document.getElementById('change-start-time');
const endTimeField = document.getElementById('change-end-time');

const SOURCE_TYPES = new Set([
    'Dienstwissel',
    'Ziekmelding',
    'Vakantieaanvraag',
    'Ouderschapsverlof',
    'Vervanging',
    'Vrij wegens overuren',
    'Tijdswijziging',
    'Locatiewijziging',
    'Dienst vervallen'
]);
const ADD_TYPES = new Set(['Extra dienst', 'Openstaande dienst', 'Dienst toegevoegd']);
const TIME_TYPES = new Set(['Tijdswijziging', ...ADD_TYPES]);
let sourceItems = [];
let sourceLoadTimer = null;

function today() {
    const date = new Date();
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getSelectedSourceItem() {
    return sourceItems.find((item) => item.sourceHash === sourceShiftField.value) || null;
}

function updateFieldVisibility() {
    const type = typeField.value;
    const syncEnabled = syncRosterField.checked;
    const supportsRosterSync = SOURCE_TYPES.has(type) || ADD_TYPES.has(type);

    if (!supportsRosterSync) {
        syncRosterField.checked = false;
        syncRosterField.disabled = true;
    } else {
        syncRosterField.disabled = false;
    }

    const effectiveSync = syncRosterField.checked && supportsRosterSync;
    sourceFields.hidden = !effectiveSync || !SOURCE_TYPES.has(type);
    timeFields.hidden = !effectiveSync || !TIME_TYPES.has(type);
    sourceShiftField.required = effectiveSync && SOURCE_TYPES.has(type);
    startTimeField.required = effectiveSync && TIME_TYPES.has(type);
    endTimeField.required = effectiveSync && TIME_TYPES.has(type);
    employee2Field.required = effectiveSync && ['Dienstwissel', 'Vervanging'].includes(type);

    if (effectiveSync && SOURCE_TYPES.has(type)) {
        scheduleSourceLoad();
    }
}

function renderSourceOptions(items) {
    sourceItems = items.filter((item) => item.sourceHash && !String(item.sourceHash).startsWith('override:'));

    if (!sourceItems.length) {
        sourceShiftField.innerHTML = '<option value="">Geen passende dienst gevonden</option>';
        sourceMessage.textContent = 'Controleer datum en medewerkernaam. Alleen geïmporteerde basisdiensten kunnen nu als bron worden geselecteerd.';
        return;
    }

    sourceShiftField.innerHTML = `
        <option value="">Kies de dienst</option>
        ${sourceItems.map((item) => `
            <option value="${escapeHtml(item.sourceHash)}">
                ${escapeHtml(item.startTime || '--:--')}–${escapeHtml(item.endTime || '--:--')} ·
                ${escapeHtml(item.location || 'Geen locatie')} · ${escapeHtml(item.employeeName)}
            </option>
        `).join('')}
    `;
    sourceMessage.textContent = `${sourceItems.length} passende dienst${sourceItems.length === 1 ? '' : 'en'} gevonden.`;
}

async function loadSourceShifts() {
    const date = changeDate.value;
    const employee = employeeField.value.trim();

    if (!date || employee.length < 2 || !SOURCE_TYPES.has(typeField.value) || !syncRosterField.checked) {
        sourceItems = [];
        sourceShiftField.innerHTML = '<option value="">Vul eerst datum en medewerker 1 in</option>';
        sourceMessage.textContent = '';
        return;
    }

    sourceMessage.textContent = 'Diensten ophalen...';
    const params = new URLSearchParams({
        from: date,
        to: date,
        name: employee,
        type: 'shift'
    });

    try {
        const response = await fetch(`/api/roster-effective?${params.toString()}`);
        const payload = await response.json().catch(() => []);
        if (!response.ok) {
            throw new Error(payload.message || 'Diensten konden niet worden opgehaald.');
        }
        renderSourceOptions(Array.isArray(payload) ? payload : []);
    } catch (error) {
        console.error(error);
        sourceItems = [];
        sourceShiftField.innerHTML = '<option value="">Diensten konden niet worden geladen</option>';
        sourceMessage.textContent = error.message;
    }
}

function scheduleSourceLoad() {
    window.clearTimeout(sourceLoadTimer);
    sourceLoadTimer = window.setTimeout(loadSourceShifts, 250);
}

sourceShiftField?.addEventListener('change', () => {
    const item = getSelectedSourceItem();
    if (!item) return;

    if (typeField.value !== 'Locatiewijziging' && item.location) {
        locationField.value = item.location;
    }

    if (typeField.value === 'Tijdswijziging') {
        startTimeField.value = item.startTime || '';
        endTimeField.value = item.endTime || '';
    }
});

[typeField, syncRosterField].forEach((field) => field?.addEventListener('change', updateFieldVisibility));
[changeDate, employeeField].forEach((field) => {
    field?.addEventListener('input', scheduleSourceLoad);
    field?.addEventListener('change', scheduleSourceLoad);
});

form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    const syncRoster = syncRosterField.checked && !syncRosterField.disabled;
    const newChange = {
        date: changeDate.value,
        reportedDate: reportedDate.value,
        location: locationField.value,
        employee: employeeField.value.trim(),
        employee2: employee2Field.value.trim(),
        type: typeField.value,
        reason: document.getElementById('change-reason').value.trim(),
        status: document.getElementById('change-status').value,
        syncRoster,
        sourceHash: syncRoster && SOURCE_TYPES.has(typeField.value) ? sourceShiftField.value : '',
        startTime: syncRoster && TIME_TYPES.has(typeField.value) ? startTimeField.value : '',
        endTime: syncRoster && TIME_TYPES.has(typeField.value) ? endTimeField.value : ''
    };

    submitButton.disabled = true;
    formMessage.textContent = syncRoster
        ? 'Wijziging opslaan en rooster bijwerken...'
        : 'Wijziging opslaan...';

    try {
        const response = await fetch('/api/changes-with-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newChange)
        });
        const result = await response.json().catch(() => ({}));

        if (response.status === 401 || response.status === 403) {
            window.location.replace('login.html?next=cf.html');
            return;
        }
        if (!response.ok) {
            throw new Error(result.message || 'Wijziging kon niet worden opgeslagen.');
        }

        form.reset();
        reportedDate.value = today();
        syncRosterField.checked = true;
        syncRosterField.disabled = false;
        sourceItems = [];
        updateFieldVisibility();
        formMessage.textContent = result.message;
    } catch (error) {
        console.error(error);
        formMessage.textContent = error.message || 'Er ging iets mis bij het opslaan van de wijziging.';
    } finally {
        submitButton.disabled = false;
    }
});

reportedDate.value = today();
updateFieldVisibility();
