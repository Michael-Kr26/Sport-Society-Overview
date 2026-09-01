'use strict';

const form = document.getElementById('change-form');
const changeDate = document.getElementById('change-date');
const locationField = document.getElementById('change-location');
const typeField = document.getElementById('change-type');
const sourceSection = document.getElementById('change-source-section');
const sourceShiftField = document.getElementById('change-source-shift');
const sourceMessage = document.getElementById('change-source-message');
const currentEmployeeWrap = document.getElementById('change-current-employee-wrap');
const employeeField = document.getElementById('change-employee');
const newEmployeeWrap = document.getElementById('change-new-employee-wrap');
const employee2Field = document.getElementById('change-employee2');
const addedEmployeeWrap = document.getElementById('change-added-employee-wrap');
const addedEmployeeField = document.getElementById('change-added-employee');
const newLocationWrap = document.getElementById('change-new-location-wrap');
const newLocationField = document.getElementById('change-new-location');
const startWrap = document.getElementById('change-start-wrap');
const endWrap = document.getElementById('change-end-wrap');
const startTimeField = document.getElementById('change-start-time');
const endTimeField = document.getElementById('change-end-time');
const reasonField = document.getElementById('change-reason');
const employeeDatalist = document.getElementById('change-employees');
const successBox = document.getElementById('change-success');
const formMessage = document.getElementById('form-message');
const errorMessage = document.getElementById('change-error');
const rosterLink = document.getElementById('change-open-roster');
const cmlLink = document.getElementById('change-open-cml');
const rosterResult = document.getElementById('change-roster-result');
const rosterResultCopy = document.getElementById('change-roster-result-copy');

const previewDate = document.getElementById('preview-date');
const previewLocation = document.getElementById('preview-location');
const previewTime = document.getElementById('preview-time');
const previewEmployee = document.getElementById('preview-employee');
const previewType = document.getElementById('preview-type');

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
const REPLACEMENT_TYPES = new Set(['Dienstwissel', 'Vervanging']);
const TIME_TYPES = new Set(['Tijdswijziging', ...ADD_TYPES]);
const CML_ONLY_TYPES = new Set(['Overige wijziging']);

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

function formatDate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ''))) return '-';
    const [year, month, day] = dateString.split('-');
    return `${day}-${month}-${year}`;
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

function setRequired(field, required) {
    if (field) field.required = Boolean(required);
}

function updateFieldVisibility() {
    const type = typeField.value;
    const usesSource = SOURCE_TYPES.has(type);
    const isAdded = ADD_TYPES.has(type);
    const isOpen = type === 'Openstaande dienst';
    const cmlOnly = CML_ONLY_TYPES.has(type);
    const needsFreeEmployee = (isAdded && !isOpen) || cmlOnly;

    sourceSection.hidden = !usesSource;
    currentEmployeeWrap.hidden = !usesSource;
    newEmployeeWrap.hidden = !REPLACEMENT_TYPES.has(type);
    addedEmployeeWrap.hidden = !needsFreeEmployee;
    newLocationWrap.hidden = type !== 'Locatiewijziging';
    startWrap.hidden = !TIME_TYPES.has(type);
    endWrap.hidden = !TIME_TYPES.has(type);

    setRequired(sourceShiftField, usesSource);
    setRequired(employee2Field, REPLACEMENT_TYPES.has(type));
    setRequired(addedEmployeeField, needsFreeEmployee);
    setRequired(newLocationField, type === 'Locatiewijziging');
    setRequired(startTimeField, TIME_TYPES.has(type));
    setRequired(endTimeField, TIME_TYPES.has(type));

    rosterResult.classList.toggle('is-muted', cmlOnly);
    rosterResultCopy.textContent = cmlOnly
        ? 'Dit type registreert alleen een CML-notitie en wijzigt geen dienst.'
        : 'De wijziging wordt direct verwerkt in het actuele rooster.';

    if (usesSource) scheduleSourceLoad();
    updatePreview();
}

function renderSourceOptions(items) {
    sourceItems = items.filter((item) => item.sourceHash && item.itemType === 'shift');

    if (!sourceItems.length) {
        sourceShiftField.innerHTML = '<option value="">Geen dienst gevonden</option>';
        sourceMessage.textContent = 'Op deze datum en vestiging staat geen selecteerbare dienst.';
        employeeField.value = '';
        updatePreview();
        return;
    }

    sourceShiftField.innerHTML = `
        <option value="">Kies de huidige dienst</option>
        ${sourceItems.map((item) => `
            <option value="${escapeHtml(item.sourceHash)}">
                ${escapeHtml(item.startTime || '--:--')}–${escapeHtml(item.endTime || '--:--')} · ${escapeHtml(item.employeeName || 'Open dienst')}
            </option>
        `).join('')}
    `;
    sourceMessage.textContent = `${sourceItems.length} dienst${sourceItems.length === 1 ? '' : 'en'} gevonden. Ook eerder gewijzigde diensten kunnen opnieuw worden aangepast.`;
}

async function loadSourceShifts() {
    const date = changeDate.value;
    const location = locationField.value;

    if (!date || !location || !SOURCE_TYPES.has(typeField.value)) {
        sourceItems = [];
        sourceShiftField.innerHTML = '<option value="">Kies eerst datum en vestiging</option>';
        sourceMessage.textContent = '';
        employeeField.value = '';
        updatePreview();
        return;
    }

    sourceMessage.textContent = 'Diensten ophalen...';
    sourceMessage.classList.remove('is-error');
    const params = new URLSearchParams({ from: date, to: date, location, type: 'shift' });

    try {
        const response = await fetch(`/api/roster-effective?${params.toString()}`);
        const payload = await response.json().catch(() => []);
        if (response.status === 401 || response.status === 403) {
            window.location.replace('login.html?next=cf.html');
            return;
        }
        if (!response.ok) throw new Error(payload.message || 'Diensten konden niet worden opgehaald.');
        renderSourceOptions(Array.isArray(payload) ? payload : []);
    } catch (error) {
        console.error(error);
        sourceItems = [];
        sourceShiftField.innerHTML = '<option value="">Diensten konden niet worden geladen</option>';
        sourceMessage.textContent = error.message;
        sourceMessage.classList.add('is-error');
    }
}

function scheduleSourceLoad() {
    window.clearTimeout(sourceLoadTimer);
    sourceLoadTimer = window.setTimeout(loadSourceShifts, 180);
}

async function loadEmployees() {
    try {
        const response = await fetch('/api/change-form/employees');
        const employees = await response.json().catch(() => []);
        if (!response.ok || !Array.isArray(employees)) return;
        employeeDatalist.innerHTML = employees
            .map((employee) => `<option value="${escapeHtml(employee.displayName || employee)}"></option>`)
            .join('');
    } catch (error) {
        console.warn('Medewerkerslijst kon niet worden geladen:', error.message);
    }
}

function updatePreview() {
    const type = typeField.value;
    const source = getSelectedSourceItem();
    const isAdded = ADD_TYPES.has(type);
    const isOpen = type === 'Openstaande dienst';
    const cmlOnly = CML_ONLY_TYPES.has(type);

    const resultingLocation = type === 'Locatiewijziging'
        ? newLocationField.value
        : locationField.value;

    let resultingEmployee = source?.employeeName || employeeField.value || '-';
    if (REPLACEMENT_TYPES.has(type)) resultingEmployee = employee2Field.value.trim() || '-';
    if (isOpen) resultingEmployee = 'Open dienst';
    if ((isAdded && !isOpen) || cmlOnly) resultingEmployee = addedEmployeeField.value.trim() || '-';
    if (['Ziekmelding', 'Vakantieaanvraag', 'Ouderschapsverlof', 'Vrij wegens overuren'].includes(type)) {
        resultingEmployee = source?.employeeName ? `${source.employeeName} · afwezig` : '-';
    }
    if (type === 'Dienst vervallen') resultingEmployee = source?.employeeName ? `${source.employeeName} · dienst vervalt` : '-';

    let timeText = '-';
    if (TIME_TYPES.has(type)) {
        timeText = startTimeField.value && endTimeField.value
            ? `${startTimeField.value}–${endTimeField.value}`
            : '-';
    } else if (source?.startTime && source?.endTime) {
        timeText = `${source.startTime}–${source.endTime}`;
    }

    previewDate.textContent = formatDate(changeDate.value);
    previewLocation.textContent = resultingLocation || '-';
    previewTime.textContent = cmlOnly ? 'Geen roosterwijziging' : timeText;
    previewEmployee.textContent = resultingEmployee;
    previewType.textContent = typeField.options[typeField.selectedIndex]?.text || type || '-';
}

sourceShiftField?.addEventListener('change', () => {
    const item = getSelectedSourceItem();
    employeeField.value = item?.employeeName || '';

    if (typeField.value === 'Tijdswijziging' && item) {
        startTimeField.value = item.startTime || '';
        endTimeField.value = item.endTime || '';
    }
    updatePreview();
});

typeField?.addEventListener('change', updateFieldVisibility);
[changeDate, locationField].forEach((field) => {
    field?.addEventListener('change', () => {
        scheduleSourceLoad();
        updatePreview();
    });
});
[employee2Field, addedEmployeeField, newLocationField, startTimeField, endTimeField, reasonField].forEach((field) => {
    field?.addEventListener('input', updatePreview);
    field?.addEventListener('change', updatePreview);
});

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';
    successBox.hidden = true;

    const type = typeField.value;
    const source = getSelectedSourceItem();
    const isAdded = ADD_TYPES.has(type);
    const isOpen = type === 'Openstaande dienst';
    const cmlOnly = CML_ONLY_TYPES.has(type);
    const submitButton = form.querySelector('button[type="submit"]');

    let employee = source?.employeeName || employeeField.value.trim();
    if (isAdded && !isOpen) employee = addedEmployeeField.value.trim();
    if (isOpen) employee = '';
    if (cmlOnly) employee = addedEmployeeField.value.trim();

    const location = type === 'Locatiewijziging'
        ? newLocationField.value
        : locationField.value;

    const newChange = {
        date: changeDate.value,
        reportedDate: today(),
        location,
        employee,
        employee2: REPLACEMENT_TYPES.has(type) ? employee2Field.value.trim() : '',
        type,
        reason: reasonField.value.trim(),
        status: 'Afgerond',
        syncRoster: !cmlOnly,
        sourceHash: SOURCE_TYPES.has(type) ? sourceShiftField.value : '',
        startTime: TIME_TYPES.has(type) ? startTimeField.value : '',
        endTime: TIME_TYPES.has(type) ? endTimeField.value : ''
    };

    submitButton.disabled = true;
    submitButton.textContent = cmlOnly ? 'CML-notitie opslaan...' : 'Rooster en CML bijwerken...';

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
        if (!response.ok) throw new Error(result.message || 'Wijziging kon niet worden verwerkt.');

        formMessage.textContent = result.message || 'Wijziging verwerkt.';
        rosterLink.href = result.rosterUrl || `roster.html?focusDate=${encodeURIComponent(changeDate.value)}&location=${encodeURIComponent(location)}`;
        cmlLink.href = result.cmlUrl || 'cml.html';
        rosterLink.hidden = !result.rosterUpdated;
        successBox.hidden = false;
        successBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        console.error(error);
        errorMessage.textContent = error.message || 'Er ging iets mis bij het verwerken van de wijziging.';
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Wijziging doorvoeren';
    }
});

changeDate.value = today();
loadEmployees();
updateFieldVisibility();
updatePreview();
