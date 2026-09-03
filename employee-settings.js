(() => {
    const byId = (id) => document.getElementById(id);
    const view = window.SSOEmployeeView;
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
    const createPanel = byId('employee-create-panel');
    const toggleCreate = byId('toggle-add-employee');
    const cancelCreate = byId('cancel-add-employee');

    let employees = [];
    let employmentStatuses = new Map();
    let directory = [];

    const currentMonth = () => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const monthFirstDay = (month) => `${month}-01`;
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const formatHours = (value) => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(Number(value || 0))} u/week`;

    function setMessage(text, type = '') {
        if (!message) return;
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
            error.code = payload.code || null;
            throw error;
        }
        return payload;
    }

    async function loadDirectory() {
        const payload = await requestJson(`/api/masterdata/employees?effectiveDate=${encodeURIComponent(today())}`);
        directory = (payload.employees || []).map((employee) => ({
            employeeId: employee.employeeId,
            employeeCode: employee.employeeCode,
            employeeName: employee.employeeName,
            locations: employee.locations || []
        }));
    }

    function statusFor(employee) {
        return employmentStatuses.get(view.normalizeName(employee.employeeName)) || null;
    }

    function employeeMatches(employee) {
        const search = searchInput.value.trim().toLocaleLowerCase('nl-NL');
        const status = statusFilter.value;
        const contract = contractFilter.value;
        const hasContract = Boolean(employee.contractPeriods?.length);
        const state = view.employeeState(employee, statusFor(employee), today());

        if (search && !employee.employeeName.toLocaleLowerCase('nl-NL').includes(search)) return false;
        if (status === 'active' && !['Actief', 'Toekomstig'].includes(state.label)) return false;
        if (status === 'inactive' && ['Actief', 'Toekomstig'].includes(state.label)) return false;
        if (contract === 'contract' && !hasContract) return false;
        if (contract === 'flex' && hasContract) return false;
        return true;
    }

    function employeeRow(employee) {
        const latest = view.latestPeriod(employee);
        const state = view.employeeState(employee, statusFor(employee), today());
        const record = view.directoryRecordForEmployee(employee, directory);
        const locations = record?.locations?.length ? record.locations.join(' · ') : '—';
        const toneClass = `sso-badge--${state.tone}`;
        const hours = latest ? formatHours(latest.weeklyHours) : 'Flex';
        return `
            <tr>
                <td>
                    <div class="employee-row-name">${escapeHtml(employee.employeeName)}</div>
                    ${record?.employeeCode ? `<div class="employee-row-code">${escapeHtml(record.employeeCode)}</div>` : ''}
                </td>
                <td>${escapeHtml(hours)}</td>
                <td><span class="sso-badge ${toneClass}">${escapeHtml(state.label)}</span></td>
                <td class="employee-row-locations">${escapeHtml(locations)}</td>
                <td class="employee-row-action"><a class="sso-button sso-button--text" href="${view.employeeHref(employee, directory)}">Openen <span aria-hidden="true">→</span></a></td>
            </tr>`;
    }

    function renderEmployees() {
        const filtered = employees.filter(employeeMatches)
            .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.employeeName.localeCompare(b.employeeName, 'nl'));
        employeeCount.textContent = `${filtered.length} van ${employees.length} medewerkers`;
        employeeList.innerHTML = filtered.length
            ? filtered.map(employeeRow).join('')
            : '<tr><td colspan="5" class="sso-empty-state">Geen medewerkers binnen deze filters.</td></tr>';
    }

    async function loadEmployees() {
        setMessage('Medewerkers laden...');
        try {
            const [employeePayload, statusPayload] = await Promise.all([
                requestJson('/api/hours/employees'),
                requestJson('/api/hours/employment-status')
            ]);
            if (!employeePayload.permissions?.canEdit) return window.location.replace('index.html');
            employees = employeePayload.employees || [];
            employmentStatuses = new Map((statusPayload.employees || [])
                .map((status) => [view.normalizeName(status.employeeName), status]));
            await loadDirectory().catch((error) => console.warn('Canonieke employee-directory niet beschikbaar:', error));
            renderEmployees();
            setMessage('');
        } catch (error) {
            if (error.status === 401) return window.location.replace('login.html?next=employee-settings.html');
            if (error.status === 403) return window.location.replace('index.html');
            setMessage(error.message, 'error');
            employeeList.innerHTML = `<tr><td colspan="5" class="sso-empty-state">${escapeHtml(error.message)}</td></tr>`;
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
        const existing = employees.find((employee) => view.normalizeName(employee.employeeName) === view.normalizeName(name));
        if (existing) {
            window.location.href = view.employeeHref(existing, directory);
            return;
        }

        try {
            const startDate = isContract ? newContractStart.value : monthFirstDay(month);
            const canonical = await requestJson('/api/masterdata/employees', {
                method: 'POST',
                body: JSON.stringify({
                    displayName: name,
                    employmentType: isContract ? 'contract' : 'flex',
                    startsOn: startDate,
                    endsOn: isContract ? (newContractStop.value || null) : null,
                    weeklyHours: isContract ? Number(newHours.value) : 0
                })
            });

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

            const employeeId = canonical.employee?.employeeId || canonical.employee?.id;
            if (employeeId) {
                window.location.href = `employee.html?id=${encodeURIComponent(employeeId)}`;
                return;
            }
            await loadEmployees();
            const created = employees.find((employee) => view.normalizeName(employee.employeeName) === view.normalizeName(name));
            if (created) window.location.href = view.employeeHref(created, directory);
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    function setCreatePanel(open) {
        createPanel.hidden = !open;
        toggleCreate.setAttribute('aria-expanded', String(open));
        if (open) newName.focus();
    }

    [searchInput, statusFilter, contractFilter].forEach((element) => {
        element?.addEventListener(element === searchInput ? 'input' : 'change', renderEmployees);
    });
    newType?.addEventListener('change', updateInitialContractFields);
    newMonth?.addEventListener('change', () => {
        if (newType.value === 'contract') newContractStart.value = monthFirstDay(newMonth.value);
    });
    addForm?.addEventListener('submit', addEmployee);
    toggleCreate?.addEventListener('click', () => setCreatePanel(createPanel.hidden));
    cancelCreate?.addEventListener('click', () => setCreatePanel(false));

    newMonth.value = currentMonth();
    newBankMonth.value = currentMonth();
    updateInitialContractFields();

    document.addEventListener('authready', (event) => {
        if (event.detail.authenticated && event.detail.role === 'admin') loadEmployees();
    }, { once: true });
})();
