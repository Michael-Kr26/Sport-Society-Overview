const monthFilter = document.getElementById('month-filter');
const filterForm = document.getElementById('hours-filter-form');
const summaryContainer = document.getElementById('hours-summary');
const contractResults = document.getElementById('contract-results');
const flexResults = document.getElementById('flex-results');
const contractCount = document.getElementById('contract-count');
const flexCount = document.getElementById('flex-count');
const employeeSettings = document.getElementById('employee-settings');
const adjustmentForm = document.getElementById('adjustment-form');
const adjustmentEmployee = document.getElementById('adjustment-employee');
const adjustmentDate = document.getElementById('adjustment-date');
const adjustmentType = document.getElementById('adjustment-type');
const adjustmentHours = document.getElementById('adjustment-hours');
const adjustmentNote = document.getElementById('adjustment-note');
const adjustmentList = document.getElementById('adjustment-list');
const message = document.getElementById('hours-message');

let analysis = null;
let employeeData = [];
let canEdit = false;

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function currentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function today() {
    const date = new Date();
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function monthFirstDay(month) {
    return `${month}-01`;
}

function formatMonth(month) {
    const [year, monthNumber] = String(month || '').split('-').map(Number);
    if (!year || !monthNumber) return month || '-';
    return new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' })
        .format(new Date(year, monthNumber - 1, 1));
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(new Date(`${dateString}T00:00:00`));
}

function formatHours(value, signed = false) {
    const number = Number(value || 0);
    const prefix = signed && number > 0 ? '+' : '';
    return `${prefix}${new Intl.NumberFormat('nl-NL', {
        minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
        maximumFractionDigits: 2
    }).format(number)} u`;
}

function getBalanceClass(value) {
    const number = Number(value || 0);
    if (number < -8) return 'is-negative';
    if (number > 8) return 'is-positive';
    return 'is-neutral';
}

function setMessage(text, type = '') {
    message.textContent = text;
    message.className = `hours-message ${type ? `is-${type}` : ''}`.trim();
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

function renderSummary() {
    const summary = analysis.summary;
    summaryContainer.innerHTML = `
        <article class="hours-summary-card">
            <span class="summary-value">${formatHours(summary.totalScheduledHours)}</span>
            <span class="summary-label">Ingepland</span>
        </article>
        <article class="hours-summary-card">
            <span class="summary-value">${formatHours(summary.totalCreditedHours)}</span>
            <span class="summary-label">Meegeteld</span>
        </article>
        <article class="hours-summary-card ${getBalanceClass(summary.contractMonthDelta)}">
            <span class="summary-value">${formatHours(summary.contractMonthDelta, true)}</span>
            <span class="summary-label">Mutatie contractgroep</span>
        </article>
        <article class="hours-summary-card">
            <span class="summary-value">${formatHours(summary.flexAverageHours)}</span>
            <span class="summary-label">Gemiddelde flex</span>
        </article>
        <article class="hours-summary-card">
            <span class="summary-value">${summary.employeeCount}</span>
            <span class="summary-label">Actieve medewerkers</span>
        </article>
    `;
}

function renderContractTable() {
    const employees = analysis.employees
        .filter((employee) => employee.contractType === 'contract')
        .sort((a, b) => a.bankBalance - b.bankBalance || a.employeeName.localeCompare(b.employeeName, 'nl'));

    contractCount.textContent = `${employees.length} contractmedewerker(s) · ${formatMonth(analysis.month)}`;
    if (!employees.length) {
        contractResults.innerHTML = '<p class="empty-state">Geen contractmedewerkers ingesteld.</p>';
        return;
    }

    contractResults.innerHTML = `
        <table class="hours-table">
            <thead>
                <tr>
                    <th>Medewerker</th>
                    <th>Contract</th>
                    <th>Maandnorm</th>
                    <th>Ingepland</th>
                    <th>Urencorrectie</th>
                    <th>Meegeteld</th>
                    <th>Maandmutatie</th>
                    <th>Urenbank</th>
                </tr>
            </thead>
            <tbody>
                ${employees.map((employee) => `
                    <tr>
                        <td>
                            <strong>${escapeHtml(employee.employeeName)}</strong>
                            <span class="hours-location">${escapeHtml(employee.locations.join(', ') || 'Geen locatie in deze maand')}</span>
                        </td>
                        <td>${formatHours(employee.weeklyContractHours)} / week</td>
                        <td>${formatHours(employee.monthlyNorm)}</td>
                        <td>${formatHours(employee.scheduledHours)}</td>
                        <td>${formatHours(employee.creditedAdjustment, true)}</td>
                        <td>${formatHours(employee.creditedHours)}</td>
                        <td><span class="hours-balance ${getBalanceClass(employee.monthDelta)}">${formatHours(employee.monthDelta, true)}</span></td>
                        <td><span class="hours-balance ${getBalanceClass(employee.bankBalance)}">${formatHours(employee.bankBalance, true)}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderFlexTable() {
    const employees = analysis.employees
        .filter((employee) => employee.contractType === 'flex')
        .sort((a, b) => b.creditedHours - a.creditedHours || a.employeeName.localeCompare(b.employeeName, 'nl'));

    flexCount.textContent = `${employees.length} flexmedewerker(s) · gemiddeld ${formatHours(analysis.summary.flexAverageHours)}`;
    if (!employees.length) {
        flexResults.innerHTML = '<p class="empty-state">Geen actieve flexmedewerkers gevonden.</p>';
        return;
    }

    flexResults.innerHTML = `
        <table class="hours-table">
            <thead>
                <tr>
                    <th>Medewerker</th>
                    <th>Ingepland</th>
                    <th>Urencorrectie</th>
                    <th>Meegeteld</th>
                    <th>Vorige maand</th>
                    <th>Trend</th>
                    <th>Verschil t.o.v. flexgemiddelde</th>
                </tr>
            </thead>
            <tbody>
                ${employees.map((employee) => `
                    <tr>
                        <td>
                            <strong>${escapeHtml(employee.employeeName)}</strong>
                            <span class="hours-location">${escapeHtml(employee.locations.join(', ') || 'Geen locatie in deze maand')}</span>
                        </td>
                        <td>${formatHours(employee.scheduledHours)}</td>
                        <td>${formatHours(employee.creditedAdjustment, true)}</td>
                        <td>${formatHours(employee.creditedHours)}</td>
                        <td>${formatHours(employee.previousScheduledHours)}</td>
                        <td><span class="hours-balance ${getBalanceClass(employee.trendHours)}">${formatHours(employee.trendHours, true)}</span></td>
                        <td><span class="hours-balance ${getBalanceClass(employee.flexDifference)}">${formatHours(employee.flexDifference, true)}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderPeriodSummary(periods) {
    if (!periods.length) return 'Nog geen contracthistorie';
    return periods.map((period) => {
        const end = period.effectiveTo ? ` t/m ${formatDate(period.effectiveTo)}` : '';
        return `${formatHours(period.weeklyHours)} vanaf ${formatDate(period.effectiveFrom)}${end}`;
    }).join(' · ');
}

function renderEmployeeSettings() {
    if (!canEdit) return;

    employeeSettings.innerHTML = employeeData.map((employee) => {
        const currentHours = Number(employee.weeklyContractHours || 0);
        return `
            <form class="employee-setting-row" data-employee-form data-employee-name="${escapeHtml(employee.employeeName)}">
                <div class="employee-setting-name">
                    <strong>${escapeHtml(employee.employeeName)}</strong>
                    <span>${escapeHtml(renderPeriodSummary(employee.contractPeriods || []))}</span>
                </div>
                <label>Type
                    <select name="contractType">
                        <option value="flex" ${employee.contractType === 'flex' ? 'selected' : ''}>Flex</option>
                        <option value="contract" ${employee.contractType === 'contract' ? 'selected' : ''}>Contract</option>
                    </select>
                </label>
                <label>Uren/week
                    <input name="weeklyContractHours" type="number" min="0" max="60" step="0.25" value="${currentHours}">
                </label>
                <label>Ingangsdatum
                    <input name="effectiveFrom" type="date" value="${monthFirstDay(analysis.month)}">
                </label>
                <label>Startstand bank
                    <input name="openingBankHours" type="number" min="-1000" max="1000" step="0.25" value="${Number(employee.openingBankHours || 0)}">
                </label>
                <label>Startmaand bank
                    <input name="openingBankMonth" type="month" value="${escapeHtml(employee.openingBankMonth || analysis.month)}">
                </label>
                <label class="employee-active"><input name="isActive" type="checkbox" ${employee.isActive ? 'checked' : ''}> Actief</label>
                <button type="submit" class="hours-small-button">Opslaan</button>
            </form>
        `;
    }).join('');

    document.querySelectorAll('[data-employee-form]').forEach((form) => {
        form.addEventListener('submit', saveEmployeeSettings);
    });
}

function populateAdjustmentEmployees() {
    if (!canEdit) return;
    adjustmentEmployee.innerHTML = employeeData
        .filter((employee) => employee.isActive)
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'))
        .map((employee) => `<option value="${escapeHtml(employee.employeeName)}">${escapeHtml(employee.employeeName)}</option>`)
        .join('');
}

function renderAdjustments() {
    if (!canEdit) return;
    const adjustments = analysis.adjustments || [];
    if (!adjustments.length) {
        adjustmentList.innerHTML = '<p class="empty-state">Geen correcties in deze maand.</p>';
        return;
    }

    adjustmentList.innerHTML = adjustments.map((adjustment) => `
        <article class="adjustment-item">
            <div>
                <strong>${escapeHtml(adjustment.employeeName)}</strong>
                <span>${formatDate(adjustment.adjustmentDate)} · ${adjustment.adjustmentType === 'bank' ? 'Urenbank' : 'Meegetelde uren'}</span>
                ${adjustment.note ? `<p>${escapeHtml(adjustment.note)}</p>` : ''}
            </div>
            <span class="hours-balance ${getBalanceClass(adjustment.hours)}">${formatHours(adjustment.hours, true)}</span>
            <button type="button" class="hours-delete-button" data-adjustment-id="${adjustment.id}">Verwijderen</button>
        </article>
    `).join('');

    adjustmentList.querySelectorAll('[data-adjustment-id]').forEach((button) => {
        button.addEventListener('click', deleteAdjustment);
    });
}

async function loadEmployees() {
    const payload = await requestJson('/api/hours/employees');
    employeeData = payload.employees || [];
    canEdit = Boolean(payload.permissions?.canEdit);
    renderEmployeeSettings();
    populateAdjustmentEmployees();
}

async function loadAnalysis() {
    setMessage('Urenanalyse laden...');
    const month = monthFilter.value || currentMonth();
    analysis = await requestJson(`/api/hours/analysis?month=${encodeURIComponent(month)}`);
    canEdit = Boolean(analysis.permissions?.canEdit);
    renderSummary();
    renderContractTable();
    renderFlexTable();
    renderAdjustments();
    setMessage(`Analyse bijgewerkt voor ${formatMonth(analysis.month)}.`, 'success');
}

async function refreshAll() {
    try {
        await Promise.all([loadAnalysis(), loadEmployees()]);
        renderEmployeeSettings();
        populateAdjustmentEmployees();
        renderAdjustments();
    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            window.location.replace('login.html?next=hours.html');
            return;
        }
        if (error.status === 403) {
            window.location.replace('dashboard.html');
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
    const formData = new FormData(form);

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(employeeName)}`, {
            method: 'PUT',
            body: JSON.stringify({
                contractType: formData.get('contractType'),
                weeklyContractHours: Number(formData.get('weeklyContractHours') || 0),
                effectiveFrom: formData.get('effectiveFrom'),
                openingBankHours: Number(formData.get('openingBankHours') || 0),
                openingBankMonth: formData.get('openingBankMonth'),
                isActive: formData.get('isActive') === 'on'
            })
        });
        setMessage(`${employeeName} is bijgewerkt.`, 'success');
        await refreshAll();
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
        await refreshAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function deleteAdjustment(event) {
    const id = event.currentTarget.dataset.adjustmentId;
    if (!window.confirm('Deze urencorrectie verwijderen?')) return;

    try {
        await requestJson(`/api/hours/adjustments/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setMessage('Correctie verwijderd.', 'success');
        await refreshAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    refreshAll();
});

adjustmentForm?.addEventListener('submit', saveAdjustment);

monthFilter.value = currentMonth();
adjustmentDate.value = today();

document.addEventListener('authready', (event) => {
    const authState = event.detail;
    if (!authState.authenticated || !['manager', 'admin'].includes(authState.role)) return;
    refreshAll();
}, { once: true });
