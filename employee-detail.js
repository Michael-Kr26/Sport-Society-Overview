(() => {
    const byId = (id) => document.getElementById(id);
    const view = window.SSOEmployeeView;
    const today = () => new Date().toISOString().slice(0, 10);
    const message = byId('employee-detail-message');
    const profileSummary = byId('employee-profile-summary');
    const settingsSection = byId('employee-settings-section');
    const contractSection = byId('employee-contract-section');
    const dangerSection = byId('employee-danger-section');
    const notFound = byId('employee-not-found');
    const profileForm = byId('employee-profile-form');
    const contractList = byId('contract-period-list');
    const addForm = byId('contract-add-form');
    const addButton = byId('show-add-contract');
    const cancelAddButton = byId('cancel-add-contract');
    const toggleEmployeeButton = byId('toggle-employee-active');

    let employee = null;
    let employmentStatus = null;
    let directory = [];
    let editingPeriodId = null;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const formatDate = (value, fallback = '—') => value
        ? new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
            .format(new Date(`${value}T00:00:00`))
        : fallback;
    const formatHours = (value) => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(Number(value || 0))} uur/week`;

    function mondayOfCurrentWeek() {
        const date = new Date();
        const day = date.getDay() || 7;
        date.setDate(date.getDate() - day + 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function setMessage(text, type = '') {
        message.textContent = text;
        message.className = `employee-detail-message${type ? ` is-${type}` : ''}`;
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

    async function loadDirectory() {
        const weekStart = mondayOfCurrentWeek();
        const locationCodes = ['AVE', 'BVE', 'VHU', 'WEK', 'HAR'];
        const results = await Promise.allSettled(locationCodes.map((location) =>
            requestJson(`/api/roster-planner/context?location=${location}&weekStart=${weekStart}&view=published`)));
        const records = new Map();
        for (const result of results) {
            if (result.status !== 'fulfilled') continue;
            const context = result.value;
            for (const item of context.employees || []) {
                const key = view.normalizeName(item.employeeName);
                if (!records.has(key)) {
                    records.set(key, {
                        employeeId: item.employeeId,
                        employeeCode: item.employeeCode,
                        employeeName: item.employeeName,
                        locations: []
                    });
                }
                if (item.eligibleAtLocation && context.location?.name) {
                    const record = records.get(key);
                    if (!record.locations.includes(context.location.name)) record.locations.push(context.location.name);
                }
            }
        }
        directory = [...records.values()];
    }

    function profilePayload(isActive) {
        const data = new FormData(profileForm);
        const latest = view.latestPeriod(employee);
        return {
            contractType: latest ? 'contract' : 'flex',
            weeklyContractHours: Number(latest?.weeklyHours || 0),
            activeFrom: data.get('activeFrom'),
            openingBankHours: Number(data.get('openingBankHours') || 0),
            openingBankMonth: data.get('openingBankMonth'),
            isActive
        };
    }

    function badgeClass(tone) {
        return `sso-badge sso-badge--${tone}`;
    }

    function renderSummary() {
        const latest = view.latestPeriod(employee);
        const state = view.employeeState(employee, employmentStatus, today());
        const directoryRecord = view.directoryRecordForEmployee(employee, directory);
        byId('employee-avatar').textContent = employee.employeeName.trim().charAt(0).toLocaleUpperCase('nl-NL') || '?';
        byId('employee-profile-name').textContent = employee.employeeName;
        byId('employee-profile-status').className = badgeClass(state.tone);
        byId('employee-profile-status').textContent = state.label;
        byId('employee-profile-hours').textContent = latest ? formatHours(latest.weeklyHours) : 'Flexmedewerker';
        byId('employee-profile-active-from').textContent = `Actief sinds ${formatDate(employee.activeFrom)}`;
        byId('employee-profile-locations').textContent = directoryRecord?.locations?.length
            ? directoryRecord.locations.join(' · ')
            : 'Geen locatiecontext';
        profileSummary.hidden = false;
    }

    function fillProfileForm() {
        profileForm.elements.activeFrom.value = employee.activeFrom || '';
        profileForm.elements.openingBankHours.value = Number(employee.openingBankHours || 0);
        profileForm.elements.openingBankMonth.value = employee.openingBankMonth || '';
        profileForm.elements.activeUntil.value = employmentStatus?.activeUntil || '';
        profileForm.elements.isActive.checked = Boolean(employee.isActive);
        settingsSection.hidden = false;
    }

    function periodRow(period) {
        const state = view.periodState(period, today());
        const periodText = `${formatDate(period.effectiveFrom)} → ${period.effectiveTo ? formatDate(period.effectiveTo) : 'doorlopend'}`;
        if (Number(period.id) === Number(editingPeriodId)) {
            return `<tr class="employee-contract-edit-row"><td colspan="4">
                <form class="employee-contract-editor employee-contract-inline-editor" data-edit-period-form data-period-id="${period.id}">
                    <label class="sso-field">Start<input class="sso-input" name="effectiveFrom" type="date" value="${escapeHtml(period.effectiveFrom)}" required></label>
                    <label class="sso-field">Stop<input class="sso-input" name="effectiveTo" type="date" value="${escapeHtml(period.effectiveTo || '')}"></label>
                    <label class="sso-field">Uren per week<input class="sso-input" name="weeklyHours" type="number" min="0.25" max="60" step="0.25" value="${Number(period.weeklyHours || 0)}" required></label>
                    <div class="employee-contract-editor-actions">
                        <button type="button" class="sso-button sso-button--secondary" data-cancel-period>Annuleren</button>
                        <button type="button" class="sso-button sso-button--danger" data-delete-period>Verwijderen</button>
                        <button type="submit" class="sso-button sso-button--primary">Opslaan</button>
                    </div>
                </form>
            </td></tr>`;
        }
        return `<tr>
            <td>${escapeHtml(periodText)}</td>
            <td>${escapeHtml(formatHours(period.weeklyHours))}</td>
            <td><span class="${badgeClass(state.tone)}">${escapeHtml(state.label)}</span></td>
            <td><button type="button" class="sso-button sso-button--text" data-edit-period="${period.id}">Bewerken</button></td>
        </tr>`;
    }

    function bindContractRows() {
        contractList.querySelectorAll('[data-edit-period]').forEach((button) => button.addEventListener('click', () => {
            editingPeriodId = Number(button.dataset.editPeriod);
            renderContracts();
        }));
        contractList.querySelector('[data-cancel-period]')?.addEventListener('click', () => {
            editingPeriodId = null;
            renderContracts();
        });
        contractList.querySelector('[data-delete-period]')?.addEventListener('click', deletePeriod);
        contractList.querySelector('[data-edit-period-form]')?.addEventListener('submit', savePeriod);
    }

    function renderContracts() {
        const periods = view.sortedPeriods(employee, 'desc');
        contractList.innerHTML = periods.length
            ? periods.map(periodRow).join('')
            : '<tr><td colspan="4" class="sso-empty-state">Nog geen contractperiode. Deze medewerker wordt als flexmedewerker behandeld.</td></tr>';
        bindContractRows();
        contractSection.hidden = false;
    }

    function renderDangerZone() {
        dangerSection.hidden = false;
        if (employee.isActive) {
            toggleEmployeeButton.className = 'sso-button sso-button--danger';
            toggleEmployeeButton.textContent = 'Medewerker verwijderen';
        } else {
            toggleEmployeeButton.className = 'sso-button sso-button--secondary';
            toggleEmployeeButton.textContent = 'Medewerker herstellen';
        }
    }

    function renderEmployee() {
        window.ssoPageHeader?.set({
            title: 'Medewerkerinstellingen',
            crumbs: ['Admin', { label: 'Medewerkers', href: 'employee-settings.html' }, employee.employeeName],
            action: { href: 'employee-settings.html', label: '← Terug naar overzicht' }
        });
        renderSummary();
        fillProfileForm();
        renderContracts();
        renderDangerZone();
        setMessage('');
    }

    function periodPayload(form) {
        const data = new FormData(form);
        return {
            effectiveFrom: data.get('effectiveFrom'),
            effectiveTo: data.get('effectiveTo') || null,
            weeklyHours: Number(data.get('weeklyHours') || 0)
        };
    }

    async function reloadEmployee() {
        const payload = await requestJson('/api/hours/employees');
        const fresh = (payload.employees || []).find((item) => view.normalizeName(item.employeeName) === view.normalizeName(employee.employeeName));
        if (fresh) employee = fresh;
        const statuses = await requestJson('/api/hours/employment-status');
        employmentStatus = (statuses.employees || []).find((item) => view.normalizeName(item.employeeName) === view.normalizeName(employee.employeeName)) || null;
        renderEmployee();
    }

    async function saveProfile(event) {
        event.preventDefault();
        const data = new FormData(profileForm);
        try {
            await requestJson(`/api/hours/employees/${encodeURIComponent(employee.employeeName)}`, {
                method: 'PUT',
                body: JSON.stringify(profilePayload(data.get('isActive') === 'on'))
            });
            const nextActiveUntil = data.get('activeUntil') || '';
            const currentActiveUntil = employmentStatus?.activeUntil || '';
            if (nextActiveUntil !== currentActiveUntil) {
                await requestJson(`/api/hours/employment-status/${encodeURIComponent(employee.employeeName)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ activeUntil: nextActiveUntil })
                });
            }
            setMessage('Medewerkerinstellingen opgeslagen.', 'success');
            await reloadEmployee();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    async function addPeriod(event) {
        event.preventDefault();
        try {
            await requestJson(`/api/hours/employees/${encodeURIComponent(employee.employeeName)}/contract-periods`, {
                method: 'POST',
                body: JSON.stringify(periodPayload(addForm))
            });
            addForm.reset();
            addForm.hidden = true;
            addButton.hidden = false;
            setMessage('Contractperiode toegevoegd.', 'success');
            await reloadEmployee();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    async function savePeriod(event) {
        event.preventDefault();
        const form = event.currentTarget;
        try {
            await requestJson(`/api/hours/employees/${encodeURIComponent(employee.employeeName)}/contract-periods/${encodeURIComponent(form.dataset.periodId)}`, {
                method: 'PUT',
                body: JSON.stringify(periodPayload(form))
            });
            editingPeriodId = null;
            setMessage('Contractperiode bijgewerkt.', 'success');
            await reloadEmployee();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    async function deletePeriod(event) {
        const form = event.currentTarget.closest('[data-edit-period-form]');
        if (!form || !window.confirm('Deze contractperiode verwijderen?')) return;
        try {
            await requestJson(`/api/hours/employees/${encodeURIComponent(employee.employeeName)}/contract-periods/${encodeURIComponent(form.dataset.periodId)}`, {
                method: 'DELETE'
            });
            editingPeriodId = null;
            setMessage('Contractperiode verwijderd.', 'success');
            await reloadEmployee();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    async function toggleEmployee() {
        const nextActive = !employee.isActive;
        if (!nextActive && !window.confirm(`${employee.employeeName} verwijderen uit actieve overzichten? Historische gegevens blijven behouden.`)) return;
        try {
            await requestJson(`/api/hours/employees/${encodeURIComponent(employee.employeeName)}`, {
                method: 'PUT',
                body: JSON.stringify(profilePayload(nextActive))
            });
            setMessage(nextActive ? 'Medewerker hersteld.' : 'Medewerker verwijderd uit actieve overzichten.', 'success');
            await reloadEmployee();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    async function load() {
        setMessage('Medewerker laden...');
        try {
            const [employeePayload, statusPayload] = await Promise.all([
                requestJson('/api/hours/employees'),
                requestJson('/api/hours/employment-status')
            ]);
            if (!employeePayload.permissions?.canEdit) return window.location.replace('index.html');
            await loadDirectory().catch((error) => console.warn('Canonieke employee-ID context niet beschikbaar:', error));
            const params = new URLSearchParams(window.location.search);
            employee = view.resolveEmployee({
                employees: employeePayload.employees || [],
                directory,
                id: params.get('id'),
                name: params.get('name')
            });
            if (!employee) {
                notFound.hidden = false;
                setMessage('');
                return;
            }
            employmentStatus = (statusPayload.employees || []).find((item) =>
                view.normalizeName(item.employeeName) === view.normalizeName(employee.employeeName)) || null;
            renderEmployee();
        } catch (error) {
            if (error.status === 401) return window.location.replace(`login.html?next=${encodeURIComponent(`employee.html${window.location.search}`)}`);
            if (error.status === 403) return window.location.replace('index.html');
            setMessage(error.message, 'error');
        }
    }

    profileForm?.addEventListener('submit', saveProfile);
    addButton?.addEventListener('click', () => {
        addForm.hidden = false;
        addButton.hidden = true;
        addForm.elements.effectiveFrom.focus();
    });
    cancelAddButton?.addEventListener('click', () => {
        addForm.reset();
        addForm.hidden = true;
        addButton.hidden = false;
    });
    addForm?.addEventListener('submit', addPeriod);
    toggleEmployeeButton?.addEventListener('click', toggleEmployee);

    document.addEventListener('authready', (event) => {
        if (event.detail.authenticated && event.detail.role === 'admin') load();
    }, { once: true });
})();
