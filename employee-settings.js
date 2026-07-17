const byId = (id) => document.getElementById(id);
const addForm = byId('add-employee-form');
const newName = byId('new-employee-name');
const newMonth = byId('new-employee-month');
const newBank = byId('new-employee-bank');
const newBankMonth = byId('new-employee-bank-month');
const newType = byId('new-employee-type');
const newHours = byId('new-employee-hours');
const newContractStart = byId('new-contract-start');
const newContractStop = byId('new-contract-stop');
const searchInput = byId('employee-search');
const statusFilter = byId('employee-status-filter');
const contractFilter = byId('employee-contract-filter');
const employeeList = byId('employee-list');
const employeeCount = byId('employee-count');
const message = byId('employee-message');

let employees = [];

const currentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const monthFirstDay = (month) => `${month}-01`;
const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const formatDate = (value) => value
    ? new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(new Date(`${value}T00:00:00`))
    : 'geen stopdatum';
const formatHours = (value) => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(Number(value || 0))} u`;

function setMessage(text, type = '') {
    message.textContent = text;
    message.className = `employee-message${type ? ` is-${type}` : ''}`;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.message || 'De aanvraag is mislukt.');
        error.status = response.status;
        throw error;
    }
    return payload;
}

function sortedPeriods(employee) {
    return [...(employee.contractPeriods || [])]
        .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
}

function latestPeriod(employee) {
    return sortedPeriods(employee).at(-1) || null;
}

function employeeMatches(employee) {
    const search = searchInput.value.trim().toLocaleLowerCase('nl-NL');
    const status = statusFilter.value;
    const contract = contractFilter.value;
    const hasContract = Boolean(employee.contractPeriods?.length);

    if (search && !employee.employeeName.toLocaleLowerCase('nl-NL').includes(search)) return false;
    if (status === 'active' && !employee.isActive) return false;
    if (status === 'inactive' && employee.isActive) return false;
    if (contract === 'contract' && !hasContract) return false;
    if (contract === 'flex' && hasContract) return false;
    return true;
}

function periodForm(employee, period) {
    return `
        <form class="contract-period-form" data-period-form data-employee-name="${escapeHtml(employee.employeeName)}" data-period-id="${period.id}">
            <label>Contract start<input name="effectiveFrom" type="date" value="${escapeHtml(period.effectiveFrom)}" required></label>
            <label>Contract stop<input name="effectiveTo" type="date" value="${escapeHtml(period.effectiveTo || '')}"></label>
            <label>Uren per week<input name="weeklyHours" type="number" min="0.25" max="60" step="0.25" value="${Number(period.weeklyHours || 0)}" required></label>
            <button type="submit" class="employee-action-button">Periode opslaan</button>
            <button type="button" class="employee-danger-button" data-delete-period>Periode verwijderen</button>
        </form>
    `;
}

function employeeCard(employee) {
    const periods = sortedPeriods(employee);
    const latest = periods.at(-1);
    const contractLabel = periods.length ? 'Contracthistorie' : 'Flexcontract';
    const statusLabel = employee.isActive ? 'Actief' : 'Verwijderd';

    return `
        <article class="employee-item${employee.isActive ? '' : ' is-inactive'}" data-employee-card="${escapeHtml(employee.employeeName)}">
            <div class="employee-item-header">
                <div>
                    <div class="employee-item-title">
                        <h3>${escapeHtml(employee.employeeName)}</h3>
                        <span class="employee-badge${periods.length ? ' is-contract' : ''}">${contractLabel}</span>
                        <span class="employee-badge${employee.isActive ? '' : ' is-inactive'}">${statusLabel}</span>
                    </div>
                    <p class="employee-meta">Actief vanaf ${formatDate(employee.activeFrom)}${latest ? ` · laatste contract: ${formatHours(latest.weeklyHours)} vanaf ${formatDate(latest.effectiveFrom)}` : ''}</p>
                </div>
            </div>

            <form class="employee-profile-form" data-profile-form data-employee-name="${escapeHtml(employee.employeeName)}">
                <label>Actief vanaf<input name="activeFrom" type="date" value="${escapeHtml(employee.activeFrom || '')}" required></label>
                <label>Startstand urenbank<input name="openingBankHours" type="number" min="-1000" max="1000" step="0.25" value="${Number(employee.openingBankHours || 0)}"></label>
                <label>Startmaand urenbank<input name="openingBankMonth" type="month" value="${escapeHtml(employee.openingBankMonth || currentMonth())}" required></label>
                <label class="employee-active"><input name="isActive" type="checkbox" ${employee.isActive ? 'checked' : ''}> Actief</label>
                <button type="submit" class="employee-action-button">Instellingen opslaan</button>
                <button type="button" class="${employee.isActive ? 'employee-danger-button' : 'employee-action-button'}" data-toggle-employee data-next-active="${employee.isActive ? 'false' : 'true'}">${employee.isActive ? 'Verwijderen' : 'Herstellen'}</button>
            </form>

            <div class="employee-contracts">
                <h4>Contractperiodes</h4>
                <p>Periodes mogen elkaar niet overlappen. Laat contract stop leeg voor een doorlopend contract.</p>
                <div class="contract-period-list">
                    ${periods.length ? periods.map((period) => periodForm(employee, period)).join('') : '<p class="contract-period-empty">Nog geen contractperiode. Deze medewerker wordt als flexmedewerker behandeld.</p>'}
                </div>
                <form class="contract-add-form" data-add-period-form data-employee-name="${escapeHtml(employee.employeeName)}">
                    <label>Nieuwe start<input name="effectiveFrom" type="date" required></label>
                    <label>Nieuwe stop<input name="effectiveTo" type="date"></label>
                    <label>Uren per week<input name="weeklyHours" type="number" min="0.25" max="60" step="0.25" required></label>
                    <button type="submit" class="employee-action-button">Contractperiode toevoegen</button>
                </form>
            </div>
        </article>
    `;
}

function bindEmployeeEvents() {
    employeeList.querySelectorAll('[data-profile-form]').forEach((form) => form.addEventListener('submit', saveProfile));
    employeeList.querySelectorAll('[data-toggle-employee]').forEach((button) => button.addEventListener('click', toggleEmployee));
    employeeList.querySelectorAll('[data-add-period-form]').forEach((form) => form.addEventListener('submit', addPeriod));
    employeeList.querySelectorAll('[data-period-form]').forEach((form) => {
        form.addEventListener('submit', savePeriod);
        form.querySelector('[data-delete-period]')?.addEventListener('click', deletePeriod);
    });
}

function renderEmployees() {
    const filtered = employees.filter(employeeMatches)
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.employeeName.localeCompare(b.employeeName, 'nl'));
    employeeCount.textContent = `${filtered.length} van ${employees.length} medewerker(s)`;
    employeeList.innerHTML = filtered.length
        ? filtered.map(employeeCard).join('')
        : '<p class="empty-state">Geen medewerkers binnen deze filters.</p>';
    bindEmployeeEvents();
}

async function loadEmployees() {
    setMessage('Medewerkers laden...');
    try {
        const payload = await requestJson('/api/hours/employees');
        if (!payload.permissions?.canEdit) {
            window.location.replace('index.html');
            return;
        }
        employees = payload.employees || [];
        renderEmployees();
        setMessage('Medewerkerinstellingen bijgewerkt.', 'success');
    } catch (error) {
        if (error.status === 401) return window.location.replace('login.html?next=employee-settings.html');
        if (error.status === 403) return window.location.replace('index.html');
        setMessage(error.message, 'error');
        employeeList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
}

function profilePayload(employee, form, isActive) {
    const latest = latestPeriod(employee);
    const data = new FormData(form);
    return {
        contractType: latest ? 'contract' : 'flex',
        weeklyContractHours: Number(latest?.weeklyHours || 0),
        activeFrom: data.get('activeFrom'),
        openingBankHours: Number(data.get('openingBankHours') || 0),
        openingBankMonth: data.get('openingBankMonth'),
        isActive
    };
}

async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.dataset.employeeName;
    const employee = employees.find((item) => item.employeeName === name);
    if (!employee) return setMessage('Medewerker niet gevonden.', 'error');

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}`, {
            method: 'PUT',
            body: JSON.stringify(profilePayload(employee, form, new FormData(form).get('isActive') === 'on'))
        });
        setMessage(`${name} is bijgewerkt.`, 'success');
        await loadEmployees();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function toggleEmployee(event) {
    const button = event.currentTarget;
    const card = button.closest('[data-employee-card]');
    const form = card?.querySelector('[data-profile-form]');
    const name = form?.dataset.employeeName;
    const employee = employees.find((item) => item.employeeName === name);
    const nextActive = button.dataset.nextActive === 'true';
    if (!employee || !form) return setMessage('Medewerker niet gevonden.', 'error');
    if (!nextActive && !window.confirm(`${name} verwijderen uit de actieve urenbank? Historische gegevens blijven bewaard.`)) return;

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}`, {
            method: 'PUT',
            body: JSON.stringify(profilePayload(employee, form, nextActive))
        });
        setMessage(nextActive ? `${name} is hersteld.` : `${name} is verwijderd uit de actieve urenbank.`, 'success');
        await loadEmployees();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

function periodPayload(form) {
    const data = new FormData(form);
    return {
        effectiveFrom: data.get('effectiveFrom'),
        effectiveTo: data.get('effectiveTo') || null,
        weeklyHours: Number(data.get('weeklyHours') || 0)
    };
}

async function addPeriod(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.dataset.employeeName;
    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}/contract-periods`, {
            method: 'POST', body: JSON.stringify(periodPayload(form))
        });
        setMessage(`Contractperiode voor ${name} toegevoegd.`, 'success');
        await loadEmployees();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function savePeriod(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.dataset.employeeName;
    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}/contract-periods/${encodeURIComponent(form.dataset.periodId)}`, {
            method: 'PUT', body: JSON.stringify(periodPayload(form))
        });
        setMessage(`Contractperiode voor ${name} bijgewerkt.`, 'success');
        await loadEmployees();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function deletePeriod(event) {
    const form = event.currentTarget.closest('[data-period-form]');
    const name = form.dataset.employeeName;
    if (!window.confirm(`Deze contractperiode van ${name} verwijderen?`)) return;
    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}/contract-periods/${encodeURIComponent(form.dataset.periodId)}`, {
            method: 'DELETE'
        });
        setMessage(`Contractperiode van ${name} verwijderd.`, 'success');
        await loadEmployees();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

function updateInitialContractFields() {
    const isContract = newType.value === 'contract';
    document.querySelectorAll('[data-initial-contract-field]').forEach((field) => { field.hidden = !isContract; });
    newHours.required = isContract;
    newContractStart.required = isContract;
    if (!isContract) {
        newHours.value = '';
        newContractStart.value = '';
        newContractStop.value = '';
    } else if (!newContractStart.value) {
        newContractStart.value = monthFirstDay(newMonth.value || currentMonth());
    }
}

async function addEmployee(event) {
    event.preventDefault();
    const name = newName.value.trim();
    const month = newMonth.value;
    const isContract = newType.value === 'contract';
    if (employees.some((employee) => employee.employeeName.toLocaleLowerCase('nl-NL') === name.toLocaleLowerCase('nl-NL'))) {
        return setMessage('Deze medewerker bestaat al.', 'error');
    }

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(name)}`, {
            method: 'PUT',
            body: JSON.stringify({
                contractType: isContract ? 'contract' : 'flex',
                weeklyContractHours: isContract ? Number(newHours.value) : 0,
                effectiveFrom: isContract ? newContractStart.value : undefined,
                effectiveTo: isContract ? (newContractStop.value || null) : undefined,
                activeFrom: monthFirstDay(month),
                openingBankHours: Number(newBank.value || 0),
                openingBankMonth: newBankMonth.value,
                isActive: true
            })
        });
        addForm.reset();
        newMonth.value = currentMonth();
        newBankMonth.value = currentMonth();
        newBank.value = '0';
        updateInitialContractFields();
        setMessage(`${name} is toegevoegd.`, 'success');
        await loadEmployees();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

[searchInput, statusFilter, contractFilter].forEach((element) => {
    element?.addEventListener(element === searchInput ? 'input' : 'change', renderEmployees);
});
newType?.addEventListener('change', updateInitialContractFields);
newMonth?.addEventListener('change', () => {
    if (newType.value === 'contract') newContractStart.value = monthFirstDay(newMonth.value);
});
addForm?.addEventListener('submit', addEmployee);

newMonth.value = currentMonth();
newBankMonth.value = currentMonth();
updateInitialContractFields();

document.addEventListener('authready', (event) => {
    if (event.detail.authenticated && event.detail.role === 'admin') loadEmployees();
}, { once: true });
