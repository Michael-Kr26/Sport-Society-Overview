const $ = (id) => document.getElementById(id);

const monthFilter = $('month-filter');
const contractTypeFilter = $('contract-type-filter');
const filterForm = $('hours-filter-form');
const summaryContainer = $('hours-summary');
const contractSection = $('contract-section');
const flexSection = $('flex-section');
const contractResults = $('contract-results');
const flexResults = $('flex-results');
const contractCount = $('contract-count');
const flexCount = $('flex-count');
const employeeSettings = $('employee-settings');
const addEmployeeForm = $('add-employee-form');
const newEmployeeName = $('new-employee-name');
const newEmployeeType = $('new-employee-type');
const newEmployeeHours = $('new-employee-hours');
const newEmployeeMonth = $('new-employee-month');
const newEmployeeBank = $('new-employee-bank');
const adjustmentForm = $('adjustment-form');
const adjustmentEmployee = $('adjustment-employee');
const adjustmentDate = $('adjustment-date');
const adjustmentType = $('adjustment-type');
const adjustmentHours = $('adjustment-hours');
const adjustmentNote = $('adjustment-note');
const adjustmentList = $('adjustment-list');
const message = $('hours-message');

const FILTER_LABELS = {
    all: 'alle medewerkers',
    contract: 'vaste uren',
    flex: 'flexcontracten'
};

let analysis = null;
let employeeData = [];
let canEdit = false;

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const currentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const monthFirstDay = (month) => `${month}-01`;

const monthLastDay = (month) => {
    const [year, number] = String(month || '').split('-').map(Number);
    return year && number ? new Date(year, number, 0).toISOString().slice(0, 10) : '';
};

const selectedType = () => {
    const value = contractTypeFilter?.value;
    return Object.hasOwn(FILTER_LABELS, value) ? value : 'all';
};

const typeMatches = (contractType, filter = selectedType()) => (
    filter === 'all' || contractType === filter
);

const formatMonth = (month) => {
    const [year, number] = String(month || '').split('-').map(Number);
    return year && number
        ? new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' })
            .format(new Date(year, number - 1, 1))
        : month || '-';
};

const formatDate = (value) => value
    ? new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(new Date(`${value}T00:00:00`))
    : '-';

const formatHours = (value, signed = false) => {
    const number = Number(value || 0);
    const formatted = new Intl.NumberFormat('nl-NL', {
        minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
        maximumFractionDigits: 2
    }).format(number);
    return `${signed && number > 0 ? '+' : ''}${formatted} u`;
};

const balanceClass = (value) => {
    const number = Number(value || 0);
    if (number < -8) return 'is-negative';
    if (number > 8) return 'is-positive';
    return 'is-neutral';
};

function setMessage(text, type = '') {
    if (!message) return;
    message.textContent = text;
    message.className = `hours-message${type ? ` is-${type}` : ''}`;
}

function setSectionVisible(section, visible) {
    if (!section) return;
    section.hidden = !visible;
    section.classList.toggle('hours-filter-hidden', !visible);
    section.setAttribute('aria-hidden', String(!visible));
}

async function requestJson(url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
    } catch {
        const error = new Error(
            'De server is niet bereikbaar. Start de applicatie met npm start en open http://localhost:3000/hours.html.'
        );
        error.status = 0;
        throw error;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};

    if (!response.ok) {
        const fallback = response.status === 404 && String(url).startsWith('/api/hours/')
            ? 'De uren-API is niet actief. Stop de server, start opnieuw met npm start en open http://localhost:3000/hours.html.'
            : 'De aanvraag is mislukt.';
        const error = new Error(payload.message || fallback);
        error.status = response.status;
        throw error;
    }

    return payload;
}

function analysisEmployeesForFilter(filter = selectedType()) {
    return (analysis?.employees || []).filter((employee) => typeMatches(employee.contractType, filter));
}

function renderSummary() {
    const filter = selectedType();
    const employees = analysisEmployeesForFilter(filter);
    const contracts = employees.filter((employee) => employee.contractType === 'contract');
    const flexEmployees = employees.filter((employee) => employee.contractType === 'flex');

    const scheduled = employees.reduce((sum, employee) => sum + Number(employee.scheduledHours || 0), 0);
    const credited = employees.reduce((sum, employee) => sum + Number(employee.creditedHours || 0), 0);
    const cards = [
        [formatHours(scheduled), 'Ingepland', ''],
        [formatHours(credited), 'Meegeteld', '']
    ];

    if (filter !== 'flex') {
        const delta = contracts.reduce((sum, employee) => sum + Number(employee.monthDelta || 0), 0);
        cards.push([formatHours(delta, true), 'Mutatie vaste uren', balanceClass(delta)]);
    }

    if (filter !== 'contract') {
        const average = flexEmployees.length
            ? flexEmployees.reduce((sum, employee) => sum + Number(employee.creditedHours || 0), 0) / flexEmployees.length
            : 0;
        cards.push([formatHours(average), 'Gemiddelde flex', '']);
    }

    cards.push([String(employees.length), 'Actieve medewerkers', '']);
    summaryContainer.innerHTML = cards.map(([value, label, className]) => `
        <article class="hours-summary-card ${className}">
            <span class="summary-value">${value}</span>
            <span class="summary-label">${label}</span>
        </article>
    `).join('');
}

function renderContractTable() {
    const visible = selectedType() !== 'flex';
    setSectionVisible(contractSection, visible);
    if (!visible) return;

    const employees = (analysis?.employees || [])
        .filter((employee) => employee.contractType === 'contract')
        .sort((a, b) => Number(a.bankBalance || 0) - Number(b.bankBalance || 0)
            || a.employeeName.localeCompare(b.employeeName, 'nl'));

    contractCount.textContent = `${employees.length} medewerker(s) · ${formatMonth(analysis.month)}`;
    contractResults.innerHTML = employees.length ? `
        <table class="hours-table">
            <thead><tr><th>Medewerker</th><th>Contract</th><th>Maandnorm</th><th>Ingepland</th>
            <th>Urencorrectie</th><th>Meegeteld</th><th>Maandmutatie</th><th>Urenbank</th></tr></thead>
            <tbody>${employees.map((employee) => `
                <tr>
                    <td><strong>${escapeHtml(employee.employeeName)}</strong>
                        <span class="hours-location">${escapeHtml(employee.locations?.join(', ') || 'Geen locatie in deze maand')}</span></td>
                    <td>${formatHours(employee.weeklyContractHours)} / week</td>
                    <td>${formatHours(employee.monthlyNorm)}</td>
                    <td>${formatHours(employee.scheduledHours)}</td>
                    <td>${formatHours(employee.creditedAdjustment, true)}</td>
                    <td>${formatHours(employee.creditedHours)}</td>
                    <td><span class="hours-balance ${balanceClass(employee.monthDelta)}">${formatHours(employee.monthDelta, true)}</span></td>
                    <td><span class="hours-balance ${balanceClass(employee.bankBalance)}">${formatHours(employee.bankBalance, true)}</span></td>
                </tr>
            `).join('')}</tbody>
        </table>
    ` : '<p class="empty-state">Geen medewerkers met vaste uren ingesteld.</p>';
}

function renderFlexTable() {
    const visible = selectedType() !== 'contract';
    setSectionVisible(flexSection, visible);
    if (!visible) return;

    const employees = (analysis?.employees || [])
        .filter((employee) => employee.contractType === 'flex')
        .sort((a, b) => Number(b.creditedHours || 0) - Number(a.creditedHours || 0)
            || a.employeeName.localeCompare(b.employeeName, 'nl'));

    const average = employees.length
        ? employees.reduce((sum, employee) => sum + Number(employee.creditedHours || 0), 0) / employees.length
        : 0;

    flexCount.textContent = `${employees.length} medewerker(s) · gemiddeld ${formatHours(average)}`;
    flexResults.innerHTML = employees.length ? `
        <table class="hours-table">
            <thead><tr><th>Medewerker</th><th>Ingepland</th><th>Urencorrectie</th><th>Meegeteld</th>
            <th>Vorige maand</th><th>Trend</th><th>Verschil t.o.v. gemiddelde</th></tr></thead>
            <tbody>${employees.map((employee) => {
                const difference = Number(employee.creditedHours || 0) - average;
                return `
                    <tr>
                        <td><strong>${escapeHtml(employee.employeeName)}</strong>
                            <span class="hours-location">${escapeHtml(employee.locations?.join(', ') || 'Geen locatie in deze maand')}</span></td>
                        <td>${formatHours(employee.scheduledHours)}</td>
                        <td>${formatHours(employee.creditedAdjustment, true)}</td>
                        <td>${formatHours(employee.creditedHours)}</td>
                        <td>${formatHours(employee.previousScheduledHours)}</td>
                        <td><span class="hours-balance ${balanceClass(employee.trendHours)}">${formatHours(employee.trendHours, true)}</span></td>
                        <td><span class="hours-balance ${balanceClass(difference)}">${formatHours(difference, true)}</span></td>
                    </tr>
                `;
            }).join('')}</tbody>
        </table>
    ` : '<p class="empty-state">Geen actieve flexmedewerkers gevonden.</p>';
}

const periodSummary = (periods = []) => periods.length
    ? periods.map((period) => `${formatHours(period.weeklyHours)} vanaf ${formatDate(period.effectiveFrom)}${
        period.effectiveTo ? ` t/m ${formatDate(period.effectiveTo)}` : ''
    }`).join(' · ')
    : 'Nog geen contracthistorie';

function latestContractPeriod(employee) {
    return [...(employee.contractPeriods || [])]
        .sort((a, b) => String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || '')))[0] || null;
}

function employeePayload(employee, isActive = Boolean(employee.isActive)) {
    const latest = latestContractPeriod(employee);
    const activeFrom = employee.activeFrom || latest?.effectiveFrom || monthFirstDay(analysis.month);
    return {
        contractType: employee.contractType,
        weeklyContractHours: Number(employee.weeklyContractHours || 0),
        effectiveFrom: latest?.effectiveFrom || activeFrom,
        activeFrom,
        openingBankHours: Number(employee.openingBankHours || 0),
        openingBankMonth: employee.openingBankMonth || analysis.month,
        isActive
    };
}

function activeEmployeeRow(employee) {
    const latest = latestContractPeriod(employee);
    return `
        <form class="employee-setting-row" data-employee-form data-employee-name="${escapeHtml(employee.employeeName)}">
            <div class="employee-setting-name"><strong>${escapeHtml(employee.employeeName)}</strong>
                <span>${escapeHtml(periodSummary(employee.contractPeriods))}</span></div>
            <label>Type<select name="contractType">
                <option value="flex" ${employee.contractType === 'flex' ? 'selected' : ''}>Flex</option>
                <option value="contract" ${employee.contractType === 'contract' ? 'selected' : ''}>Vaste uren</option>
            </select></label>
            <label>Uren/week<input name="weeklyContractHours" type="number" min="0" max="60" step="0.25" value="${Number(employee.weeklyContractHours || 0)}"></label>
            <label>Contract vanaf<input name="effectiveFrom" type="date" value="${escapeHtml(latest?.effectiveFrom || employee.activeFrom || monthFirstDay(analysis.month))}"></label>
            <label>Actief vanaf<input name="activeFrom" type="date" value="${escapeHtml(employee.activeFrom || monthFirstDay(analysis.month))}"></label>
            <label>Startstand bank<input name="openingBankHours" type="number" min="-1000" max="1000" step="0.25" value="${Number(employee.openingBankHours || 0)}"></label>
            <label>Startmaand bank<input name="openingBankMonth" type="month" value="${escapeHtml(employee.openingBankMonth || analysis.month)}"></label>
            <label class="employee-active"><input name="isActive" type="checkbox" checked> Actief</label>
            <div class="employee-setting-actions">
                <button type="submit" class="hours-small-button">Opslaan</button>
                <button type="button" class="hours-delete-button" data-remove-employee="${escapeHtml(employee.employeeName)}">Verwijderen</button>
            </div>
        </form>
    `;
}

const removedEmployeeRow = (employee) => `
    <article class="employee-setting-row employee-setting-row-removed">
        <div class="employee-setting-name"><strong>${escapeHtml(employee.employeeName)}</strong>
            <span>Niet actief; historische gegevens zijn bewaard.</span></div>
        <button type="button" class="hours-small-button" data-restore-employee="${escapeHtml(employee.employeeName)}">Herstellen</button>
    </article>
`;

function renderEmployeeSettings() {
    if (!canEdit || !employeeSettings) return;
    const filter = selectedType();
    const matches = (employee) => typeMatches(employee.contractType, filter);
    const sortByName = (a, b) => a.employeeName.localeCompare(b.employeeName, 'nl');
    const active = employeeData.filter((employee) => Boolean(employee.isActive) && matches(employee)).sort(sortByName);
    const removed = employeeData.filter((employee) => !employee.isActive && matches(employee)).sort(sortByName);

    employeeSettings.innerHTML = `
        ${active.length ? active.map(activeEmployeeRow).join('') : '<p class="empty-state">Geen actieve medewerkers binnen dit filter.</p>'}
        ${removed.length ? `
            <details class="removed-employees-panel">
                <summary>Verwijderde medewerkers (${removed.length})</summary>
                <div class="removed-employees-list">${removed.map(removedEmployeeRow).join('')}</div>
            </details>
        ` : ''}
    `;

    employeeSettings.querySelectorAll('[data-employee-form]')
        .forEach((form) => form.addEventListener('submit', saveEmployeeSettings));
    employeeSettings.querySelectorAll('[data-remove-employee]')
        .forEach((button) => button.addEventListener('click', removeEmployee));
    employeeSettings.querySelectorAll('[data-restore-employee]')
        .forEach((button) => button.addEventListener('click', restoreEmployee));
}

function employeeIsAvailable(employee) {
    const selectedMonthEnd = monthLastDay(analysis?.month);
    return Boolean(employee.isActive)
        && (!employee.activeFrom || !selectedMonthEnd || employee.activeFrom <= selectedMonthEnd)
        && typeMatches(employee.contractType);
}

function populateAdjustmentEmployees() {
    if (!canEdit || !adjustmentEmployee) return;
    const previousSelection = adjustmentEmployee.value;
    const employees = employeeData.filter(employeeIsAvailable)
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'));

    adjustmentEmployee.innerHTML = employees
        .map((employee) => `<option value="${escapeHtml(employee.employeeName)}">${escapeHtml(employee.employeeName)}</option>`)
        .join('');

    if (employees.some((employee) => employee.employeeName === previousSelection)) {
        adjustmentEmployee.value = previousSelection;
    }
}

function adjustmentMatches(adjustment) {
    if (selectedType() === 'all') return true;
    const normalizedName = String(adjustment.employeeName || '').toLocaleLowerCase('nl-NL');
    const employee = employeeData.find((item) => item.employeeName.toLocaleLowerCase('nl-NL') === normalizedName);
    return employee?.contractType === selectedType();
}

function renderAdjustments() {
    if (!canEdit || !adjustmentList) return;
    const adjustments = (analysis?.adjustments || []).filter(adjustmentMatches);
    adjustmentList.innerHTML = adjustments.length ? adjustments.map((adjustment) => `
        <article class="adjustment-item">
            <div><strong>${escapeHtml(adjustment.employeeName)}</strong>
                <span>${formatDate(adjustment.adjustmentDate)} · ${adjustment.adjustmentType === 'bank' ? 'Urenbank' : 'Meegetelde uren'}</span>
                ${adjustment.note ? `<p>${escapeHtml(adjustment.note)}</p>` : ''}
            </div>
            <span class="hours-balance ${balanceClass(adjustment.hours)}">${formatHours(adjustment.hours, true)}</span>
            <button type="button" class="hours-delete-button" data-adjustment-id="${adjustment.id}">Verwijderen</button>
        </article>
    `).join('') : '<p class="empty-state">Geen correcties binnen dit filter in deze maand.</p>';

    adjustmentList.querySelectorAll('[data-adjustment-id]')
        .forEach((button) => button.addEventListener('click', deleteAdjustment));
}

function renderAll() {
    if (!analysis) return;
    renderSummary();
    renderContractTable();
    renderFlexTable();
    renderEmployeeSettings();
    populateAdjustmentEmployees();
    renderAdjustments();
}

function applyContractTypeFilter({ announce = true } = {}) {
    if (!analysis) return;
    renderAll();
    if (announce) {
        const count = analysisEmployeesForFilter().length;
        setMessage(
            `Filter toegepast: ${FILTER_LABELS[selectedType()]}. ${count} medewerker(s) getoond voor ${formatMonth(analysis.month)}.`,
            'success'
        );
    }
}

async function loadAll() {
    setMessage('Urenanalyse laden...');
    try {
        const month = monthFilter.value || currentMonth();
        const [analysisPayload, employeePayloadData] = await Promise.all([
            requestJson(`/api/hours/analysis?month=${encodeURIComponent(month)}`),
            requestJson('/api/hours/employees')
        ]);

        analysis = analysisPayload;
        employeeData = employeePayloadData.employees || [];
        canEdit = Boolean(analysisPayload.permissions?.canEdit && employeePayloadData.permissions?.canEdit);
        renderAll();
        setMessage(
            `Analyse bijgewerkt voor ${formatMonth(analysis.month)} · filter: ${FILTER_LABELS[selectedType()]}.`,
            'success'
        );
    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            window.location.replace('login.html?next=hours.html');
            return;
        }
        if (error.status === 403) {
            window.location.replace('index.html');
            return;
        }
        setMessage(error.message, 'error');
        summaryContainer.innerHTML = '';
        contractResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        flexResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
}

async function saveEmployeeSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const employeeName = form.dataset.employeeName;
    const data = new FormData(form);

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(employeeName)}`, {
            method: 'PUT',
            body: JSON.stringify({
                contractType: data.get('contractType'),
                weeklyContractHours: Number(data.get('weeklyContractHours') || 0),
                effectiveFrom: data.get('effectiveFrom'),
                activeFrom: data.get('activeFrom'),
                openingBankHours: Number(data.get('openingBankHours') || 0),
                openingBankMonth: data.get('openingBankMonth'),
                isActive: data.get('isActive') === 'on'
            })
        });
        setMessage(`${employeeName} is bijgewerkt.`, 'success');
        await loadAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function changeEmployeeState(employeeName, isActive) {
    const employee = employeeData.find((item) => item.employeeName === employeeName);
    if (!employee) {
        setMessage('Medewerker kon niet worden gevonden.', 'error');
        return;
    }

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(employeeName)}`, {
            method: 'PUT',
            body: JSON.stringify(employeePayload(employee, isActive))
        });
        setMessage(
            isActive ? `${employeeName} is hersteld.` : `${employeeName} is verwijderd uit de actieve urenbank.`,
            'success'
        );
        await loadAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function removeEmployee(event) {
    const name = event.currentTarget.dataset.removeEmployee;
    const confirmed = window.confirm(
        `${name} verwijderen uit de actieve urenbank? Historische gegevens blijven bewaard.`
    );
    if (confirmed) await changeEmployeeState(name, false);
}

const restoreEmployee = (event) => changeEmployeeState(event.currentTarget.dataset.restoreEmployee, true);

function updateNewEmployeeFields() {
    if (!newEmployeeType || !newEmployeeHours) return;
    const fixed = newEmployeeType.value === 'contract';
    newEmployeeHours.disabled = !fixed;
    newEmployeeHours.required = fixed;
    if (!fixed) newEmployeeHours.value = '0';
}

async function addEmployee(event) {
    event.preventDefault();
    const name = newEmployeeName.value.trim();
    const month = newEmployeeMonth.value;
    const normalizedName = name.toLocaleLowerCase('nl-NL');

    if (employeeData.some((employee) => employee.employeeName.toLocaleLowerCase('nl-NL') === normalizedName)) {
        setMessage('Deze medewerker bestaat al. Pas de bestaande medewerkerinstellingen aan.', 'error');
        return;
    }

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}`, {
            method: 'PUT',
            body: JSON.stringify({
                contractType: newEmployeeType.value,
                weeklyContractHours: Number(newEmployeeHours.value || 0),
                effectiveFrom: monthFirstDay(month),
                activeFrom: monthFirstDay(month),
                openingBankHours: Number(newEmployeeBank.value || 0),
                openingBankMonth: month,
                isActive: true
            })
        });
        addEmployeeForm.reset();
        newEmployeeMonth.value = monthFilter.value || currentMonth();
        newEmployeeBank.value = '0';
        updateNewEmployeeFields();
        setMessage(`${name} is toegevoegd vanaf ${formatMonth(month)}.`, 'success');
        await loadAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function saveAdjustment(event) {
    event.preventDefault();
    try {
        await requestJson('/api/hours/adjustments', {
            method: 'POST',
            body: JSON.stringify({
                employeeName: adjustmentEmployee.value,
                adjustmentDate: adjustmentDate.value,
                adjustmentType: adjustmentType.value,
                hours: Number(adjustmentHours.value),
                note: adjustmentNote.value.trim()
            })
        });
        adjustmentHours.value = '';
        adjustmentNote.value = '';
        setMessage('Correctie opgeslagen.', 'success');
        await loadAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function deleteAdjustment(event) {
    if (!window.confirm('Deze urencorrectie verwijderen?')) return;
    try {
        await requestJson(`/api/hours/adjustments/${encodeURIComponent(event.currentTarget.dataset.adjustmentId)}`, {
            method: 'DELETE'
        });
        setMessage('Correctie verwijderd.', 'success');
        await loadAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

filterForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadAll();
});
contractTypeFilter?.addEventListener('change', () => applyContractTypeFilter());
contractTypeFilter?.addEventListener('input', () => applyContractTypeFilter({ announce: false }));
newEmployeeType?.addEventListener('change', updateNewEmployeeFields);
addEmployeeForm?.addEventListener('submit', addEmployee);
adjustmentForm?.addEventListener('submit', saveAdjustment);

monthFilter.value = currentMonth();
newEmployeeMonth.value = currentMonth();
adjustmentDate.value = today();
updateNewEmployeeFields();

document.addEventListener('authready', (event) => {
    if (event.detail.authenticated && ['manager', 'admin'].includes(event.detail.role)) loadAll();
}, { once: true });
