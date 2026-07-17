const byId = (id) => document.getElementById(id);
const monthFilter = byId('month-filter');
const contractTypeFilter = byId('contract-type-filter');
const filterForm = byId('hours-filter-form');
const summaryContainer = byId('hours-summary');
const contractSection = byId('contract-section');
const flexSection = byId('flex-section');
const contractResults = byId('contract-results');
const flexResults = byId('flex-results');
const contractCount = byId('contract-count');
const flexCount = byId('flex-count');
const adjustmentForm = byId('adjustment-form');
const adjustmentEmployee = byId('adjustment-employee');
const adjustmentDate = byId('adjustment-date');
const adjustmentType = byId('adjustment-type');
const adjustmentHours = byId('adjustment-hours');
const adjustmentNote = byId('adjustment-note');
const adjustmentList = byId('adjustment-list');
const message = byId('hours-message');

const FILTER_LABELS = {
    all: 'alle medewerkers',
    contract: 'vaste uren',
    flex: 'flexcontract'
};

let analysis = null;
let employeeData = [];
let canEdit = false;

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const currentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const selectedType = () => Object.hasOwn(FILTER_LABELS, contractTypeFilter?.value)
    ? contractTypeFilter.value
    : 'all';
const typeMatches = (type, filter = selectedType()) => filter === 'all' || type === filter;
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
    message.textContent = text;
    message.className = `hours-message${type ? ` is-${type}` : ''}`;
}

function setSectionVisible(section, visible) {
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
        const error = new Error('De server is niet bereikbaar. Start de applicatie met npm start en open http://localhost:3000/hours.html.');
        error.status = 0;
        throw error;
    }

    const payload = String(response.headers.get('content-type') || '').includes('application/json')
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

function filteredEmployees() {
    return (analysis?.employees || []).filter((employee) => typeMatches(employee.contractType));
}

function renderSummary() {
    const employees = filteredEmployees();
    const contracts = employees.filter((employee) => employee.contractType === 'contract');
    const flex = employees.filter((employee) => employee.contractType === 'flex');
    const cards = [
        [formatHours(employees.reduce((sum, employee) => sum + Number(employee.scheduledHours || 0), 0)), 'Ingepland', ''],
        [formatHours(employees.reduce((sum, employee) => sum + Number(employee.creditedHours || 0), 0)), 'Meegeteld', '']
    ];

    if (selectedType() !== 'flex') {
        const delta = contracts.reduce((sum, employee) => sum + Number(employee.monthDelta || 0), 0);
        cards.push([formatHours(delta, true), 'Mutatie vaste uren', balanceClass(delta)]);
    }
    if (selectedType() !== 'contract') {
        const average = flex.length
            ? flex.reduce((sum, employee) => sum + Number(employee.creditedHours || 0), 0) / flex.length
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
                        <span class="hours-location">${escapeHtml(employee.locations.join(', ') || 'Geen locatie in deze maand')}</span></td>
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
                return `<tr>
                    <td><strong>${escapeHtml(employee.employeeName)}</strong>
                        <span class="hours-location">${escapeHtml(employee.locations.join(', ') || 'Geen locatie in deze maand')}</span></td>
                    <td>${formatHours(employee.scheduledHours)}</td>
                    <td>${formatHours(employee.creditedAdjustment, true)}</td>
                    <td>${formatHours(employee.creditedHours)}</td>
                    <td>${formatHours(employee.previousScheduledHours)}</td>
                    <td><span class="hours-balance ${balanceClass(employee.trendHours)}">${formatHours(employee.trendHours, true)}</span></td>
                    <td><span class="hours-balance ${balanceClass(difference)}">${formatHours(difference, true)}</span></td>
                </tr>`;
            }).join('')}</tbody>
        </table>
    ` : '<p class="empty-state">Geen actieve flexmedewerkers gevonden.</p>';
}

function typeForEmployee(employeeName) {
    const fromAnalysis = analysis?.employees?.find((employee) => employee.employeeName === employeeName);
    if (fromAnalysis) return fromAnalysis.contractType;

    const settings = employeeData.find((employee) => employee.employeeName === employeeName);
    if (!settings) return 'flex';
    const monthStart = `${analysis.month}-01`;
    const [year, number] = analysis.month.split('-').map(Number);
    const monthEnd = new Date(year, number, 0).toISOString().slice(0, 10);
    const hasPeriod = (settings.contractPeriods || []).some((period) => (
        period.effectiveFrom <= monthEnd && (!period.effectiveTo || period.effectiveTo >= monthStart)
    ));
    return hasPeriod ? 'contract' : 'flex';
}

function populateAdjustmentEmployees() {
    if (!canEdit) return;
    const employees = (analysis?.employees || [])
        .filter((employee) => typeMatches(employee.contractType))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'));
    adjustmentEmployee.innerHTML = employees
        .map((employee) => `<option value="${escapeHtml(employee.employeeName)}">${escapeHtml(employee.employeeName)}</option>`)
        .join('');
    adjustmentEmployee.disabled = !employees.length;
}

function renderAdjustments() {
    if (!canEdit) return;
    const adjustments = (analysis?.adjustments || [])
        .filter((adjustment) => typeMatches(typeForEmployee(adjustment.employeeName)));
    adjustmentList.innerHTML = adjustments.length ? adjustments.map((adjustment) => `
        <article class="adjustment-item">
            <div>
                <strong>${escapeHtml(adjustment.employeeName)}</strong>
                <span>${formatDate(adjustment.adjustmentDate)} · ${adjustment.adjustmentType === 'bank' ? 'Urenbank' : 'Meegetelde uren'}</span>
                ${adjustment.note ? `<p>${escapeHtml(adjustment.note)}</p>` : ''}
            </div>
            <span class="hours-balance ${balanceClass(adjustment.hours)}">${formatHours(adjustment.hours, true)}</span>
            <button type="button" class="hours-delete-button" data-adjustment-id="${adjustment.id}">Verwijderen</button>
        </article>
    `).join('') : '<p class="empty-state">Geen correcties binnen dit filter in deze maand.</p>';
    adjustmentList.querySelectorAll('[data-adjustment-id]').forEach((button) => {
        button.addEventListener('click', deleteAdjustment);
    });
}

function renderAll({ announce = false } = {}) {
    if (!analysis) return;
    renderSummary();
    renderContractTable();
    renderFlexTable();
    populateAdjustmentEmployees();
    renderAdjustments();
    if (announce) {
        setMessage(`${FILTER_LABELS[selectedType()]} getoond: ${filteredEmployees().length} medewerker(s).`, 'success');
    }
}

async function loadAll() {
    setMessage('Urenanalyse laden...');
    try {
        const month = monthFilter.value || currentMonth();
        analysis = await requestJson(`/api/hours/analysis?month=${encodeURIComponent(month)}`);
        canEdit = Boolean(analysis.permissions?.canEdit);
        employeeData = canEdit
            ? (await requestJson('/api/hours/employees')).employees || []
            : [];
        renderAll();
        setMessage(`Analyse bijgewerkt voor ${formatMonth(analysis.month)}.`, 'success');
    } catch (error) {
        console.error(error);
        if (error.status === 401) return window.location.replace('login.html?next=hours.html');
        if (error.status === 403) return window.location.replace('index.html');
        setMessage(error.message, 'error');
        summaryContainer.innerHTML = '';
        contractResults.innerHTML = flexResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
}

async function saveAdjustment(event) {
    event.preventDefault();
    if (!adjustmentEmployee.value) return setMessage('Geen medewerker beschikbaar binnen dit filter.', 'error');
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
contractTypeFilter?.addEventListener('change', () => renderAll({ announce: true }));
adjustmentForm?.addEventListener('submit', saveAdjustment);

monthFilter.value = currentMonth();
adjustmentDate.value = today();

document.addEventListener('authready', (event) => {
    if (event.detail.authenticated && ['manager', 'admin'].includes(event.detail.role)) loadAll();
}, { once: true });
