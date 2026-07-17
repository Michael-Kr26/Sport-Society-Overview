(() => {
    const byId = (id) => document.getElementById(id);
    const monthFilter = byId('month-filter');
    const contractTypeFilter = byId('contract-type-filter');
    const filterForm = byId('hours-filter-form');
    const summaryContainer = byId('hours-summary');
    const periodStatus = byId('excel-period-status');
    const contractSection = byId('contract-section');
    const flexSection = byId('flex-section');
    const contractResults = byId('contract-results');
    const flexResults = byId('flex-results');
    const contractCount = byId('contract-count');
    const flexCount = byId('flex-count');
    const qualitySection = byId('excel-quality-section');
    const issueCount = byId('excel-issue-count');
    const issuesContainer = byId('excel-issues');
    const overrideForm = byId('excel-override-form');
    const overrideEmployee = byId('override-employee');
    const overrideScheduled = byId('override-scheduled');
    const overrideMinimum = byId('override-minimum');
    const overrideThis = byId('override-this');
    const overridePrevious = byId('override-previous');
    const overrideAfter = byId('override-after');
    const overrideNote = byId('override-note');
    const overrideDelete = byId('override-delete');
    const overridePeriodLabel = byId('override-period-label');
    const message = byId('hours-message');

    const FILTER_LABELS = {
        all: 'vaste uren en flex',
        contract: 'vaste uren',
        flex: 'flexmedewerkers'
    };

    let analysis = null;
    let canEdit = false;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');
    const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const currentMonth = () => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };
    const selectedType = () => Object.hasOwn(FILTER_LABELS, contractTypeFilter?.value)
        ? contractTypeFilter.value
        : 'all';
    const typeMatches = (type, filter = selectedType()) => filter === 'all' || type === filter;

    function formatMonth(month) {
        const [year, number] = String(month || '').split('-').map(Number);
        return year && number
            ? new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' }).format(new Date(year, number - 1, 1))
            : month || '-';
    }

    function formatHours(value, signed = false) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
        const formatted = new Intl.NumberFormat('nl-NL', {
            minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
            maximumFractionDigits: 2
        }).format(value);
        return `${signed && value > 0 ? '+' : ''}${formatted} u`;
    }

    function balanceClass(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'is-unknown';
        if (value < -0.01) return 'is-negative';
        if (value > 0.01) return 'is-positive';
        return 'is-neutral';
    }

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
            const error = new Error('De server is niet bereikbaar. Start de applicatie met npm start.');
            error.status = 0;
            throw error;
        }
        const payload = String(response.headers.get('content-type') || '').includes('application/json')
            ? await response.json().catch(() => ({}))
            : {};
        if (!response.ok) {
            const error = new Error(payload.message || 'De aanvraag is mislukt.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function filteredEmployees() {
        return (analysis?.employees || []).filter((employee) => typeMatches(employee.contractType));
    }

    function renderPeriodStatus() {
        const period = analysis?.excelPeriod;
        if (!period) {
            periodStatus.className = 'excel-period-status is-error';
            periodStatus.innerHTML = '<strong>Geen Excel-maandpagina beschikbaar.</strong><span>Importeer het actuele Rooster.xlsx opnieuw.</span>';
            return;
        }
        const fallback = period.isFallback;
        periodStatus.className = `excel-period-status${fallback ? ' is-warning' : ' is-success'}`;
        periodStatus.innerHTML = `
            <div><strong>${escapeHtml(period.sheetName)}</strong><span>${period.dateCount} datumregels · ${period.weekCount} weken · bron ${escapeHtml(period.sourceFile || 'Rooster.xlsx')}</span></div>
            <span class="period-chip">${fallback ? `Terugval voor ${escapeHtml(analysis.excelRequestedMonth)}` : 'Exacte maandpagina'}</span>
        `;
    }

    function renderSummary() {
        const employees = filteredEmployees();
        const contracts = employees.filter((employee) => employee.contractType === 'contract');
        const flex = employees.filter((employee) => employee.contractType === 'flex');
        const cards = [];

        if (selectedType() !== 'flex') {
            const scheduled = contracts.reduce((sum, employee) => sum + numeric(employee.scheduledHours), 0);
            const minimum = contracts.reduce((sum, employee) => sum + numeric(employee.monthlyNorm), 0);
            const overtime = contracts.reduce((sum, employee) => sum + numeric(employee.monthDelta), 0);
            cards.push([formatHours(scheduled), 'Totaal ingepland', '']);
            cards.push([formatHours(minimum), 'Totaal minstens', '']);
            cards.push([formatHours(overtime, true), 'Overuren deze maand', balanceClass(overtime)]);
        }
        if (selectedType() !== 'contract') {
            const average = flex.length
                ? flex.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0) / flex.length
                : 0;
            cards.push([formatHours(average), 'Gemiddelde flex', '']);
        }
        cards.push([String(analysis?.excelPeriod?.weekCount ?? '—'), 'Weken op pagina', '']);
        cards.push([String(employees.length), 'Medewerkers getoond', '']);
        if (canEdit) {
            cards.push([
                String(analysis?.summary?.excelIssueCount || 0),
                'Controlepunten',
                analysis?.summary?.excelIssueCount ? 'is-negative' : 'is-positive'
            ]);
        }

        summaryContainer.innerHTML = cards.map(([value, label, className]) => `
            <article class="hours-summary-card ${className}">
                <span class="summary-value">${value}</span>
                <span class="summary-label">${label}</span>
            </article>
        `).join('');
    }

    function sourceBadge(employee) {
        const excel = employee.excel;
        if (!excel) return '<span class="source-badge is-warning">Geen Excel-koppeling</span>';
        if (excel.status === 'fallback') return `<span class="source-badge is-warning">Uit ${escapeHtml(excel.sourcePeriodKey)}</span>`;
        if (excel.status === 'corrected') return '<span class="source-badge is-corrected">Handmatig gecorrigeerd</span>';
        if (excel.status === 'missing') return '<span class="source-badge is-error">Onvolledig</span>';
        return `<span class="source-badge is-success">${escapeHtml(excel.sourceSheetName || 'Excel')}</span>`;
    }

    function renderContractTable() {
        const visible = selectedType() !== 'flex';
        setSectionVisible(contractSection, visible);
        if (!visible) return;

        const employees = (analysis?.employees || [])
            .filter((employee) => employee.contractType === 'contract')
            .sort((a, b) => numeric(a.bankBalance) - numeric(b.bankBalance)
                || a.employeeName.localeCompare(b.employeeName, 'nl'));
        contractCount.textContent = `${employees.length} medewerker(s) · ${analysis?.excelPeriod?.sheetName || formatMonth(analysis?.month)}`;
        contractResults.innerHTML = employees.length ? `
            <table class="hours-table excel-hours-table">
                <thead><tr>
                    <th>Medewerker</th><th>Contract</th><th>Ingepland</th><th>Minstens</th>
                    <th>Overuren deze maand</th><th>Overuren vorige maand</th><th>Overuren na deze maand</th><th>Bron</th>
                </tr></thead>
                <tbody>${employees.map((employee) => `
                    <tr class="${employee.excel?.usedFallback ? 'has-fallback' : ''}">
                        <td><strong>${escapeHtml(employee.employeeName)}</strong>
                            <span class="hours-location">${escapeHtml((employee.locations || []).join(', ') || 'Geen locatie op deze pagina')}</span></td>
                        <td>${typeof employee.weeklyContractHours === 'number' && Number.isFinite(employee.weeklyContractHours)
                            ? `${formatHours(employee.weeklyContractHours)} / week`
                            : 'Niet ingesteld'}</td>
                        <td><strong>${formatHours(employee.scheduledHours)}</strong></td>
                        <td>${formatHours(employee.monthlyNorm)}</td>
                        <td><span class="hours-balance ${balanceClass(employee.monthDelta)}">${formatHours(employee.monthDelta, true)}</span></td>
                        <td><span class="hours-balance ${balanceClass(employee.previousOvertime)}">${formatHours(employee.previousOvertime, true)}</span></td>
                        <td><span class="hours-balance ${balanceClass(employee.bankBalance)}">${formatHours(employee.bankBalance, true)}</span></td>
                        <td>${sourceBadge(employee)}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        ` : '<p class="empty-state">Geen medewerkers met vaste Excel-uren gevonden.</p>';
    }

    function renderFlexTable() {
        const visible = selectedType() !== 'contract';
        setSectionVisible(flexSection, visible);
        if (!visible) return;

        const employees = (analysis?.employees || [])
            .filter((employee) => employee.contractType === 'flex')
            .sort((a, b) => numeric(b.creditedHours) - numeric(a.creditedHours)
                || a.employeeName.localeCompare(b.employeeName, 'nl'));
        const average = employees.length
            ? employees.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0) / employees.length
            : 0;
        flexCount.textContent = `${employees.length} medewerker(s) · gemiddeld ${formatHours(average)}`;
        flexResults.innerHTML = employees.length ? `
            <table class="hours-table flex-hours-table">
                <thead><tr><th>Medewerker</th><th>Ingepland</th><th>Vorige maand</th><th>Verschil met gemiddelde</th><th>Locaties</th></tr></thead>
                <tbody>${employees.map((employee) => {
                    const difference = numeric(employee.creditedHours) - average;
                    return `<tr>
                        <td><strong>${escapeHtml(employee.employeeName)}</strong></td>
                        <td>${formatHours(employee.creditedHours)}</td>
                        <td>${formatHours(employee.previousScheduledHours)}</td>
                        <td><span class="hours-balance ${balanceClass(difference)}">${formatHours(difference, true)}</span></td>
                        <td>${escapeHtml((employee.locations || []).join(', ') || '—')}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        ` : '<p class="empty-state">Geen actieve flexmedewerkers gevonden.</p>';
    }

    function issueLabel(issue) {
        if (issue.type === 'employee_fallback') return 'Tijdelijke terugval';
        if (issue.type === 'employee_missing') return 'Ontbrekende waarden';
        if (issue.type === 'employee_not_configured') return 'Medewerkerinstelling';
        if (issue.type === 'period_fallback') return 'Maandpagina ontbreekt';
        if (issue.type === 'source_validation') return 'Excel-controle';
        return 'Structuurcontrole';
    }

    function selectOverrideEmployee(name) {
        if (!name || !overrideEmployee) return;
        const option = [...overrideEmployee.options].find((item) => employeeKey(item.value) === employeeKey(name));
        if (option) overrideEmployee.value = option.value;
        prefillOverridePlaceholders();
        overrideScheduled.focus();
        overrideForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function renderIssues() {
        if (!canEdit) return;
        const issues = analysis?.excelIssues || [];
        issueCount.textContent = issues.length ? `${issues.length} controlepunt(en)` : 'Alles compleet';
        issuesContainer.innerHTML = issues.length ? issues.map((issue) => `
            <article class="excel-issue-item">
                <div><span class="issue-type">${escapeHtml(issueLabel(issue))}</span><p>${escapeHtml(issue.message)}</p></div>
                ${issue.employeeName ? `<button type="button" class="hours-small-button" data-fix-employee="${escapeHtml(issue.employeeName)}">Corrigeer</button>` : ''}
            </article>
        `).join('') : '<p class="empty-state is-success">Geen ontbrekende of afwijkende Excel-velden gevonden.</p>';
        issuesContainer.querySelectorAll('[data-fix-employee]').forEach((button) => {
            button.addEventListener('click', () => selectOverrideEmployee(button.dataset.fixEmployee));
        });
    }

    function populateOverrideEmployees() {
        if (!canEdit) return;
        const employees = (analysis?.employees || [])
            .filter((employee) => employee.contractType === 'contract')
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'));
        const previousValue = overrideEmployee.value;
        overrideEmployee.innerHTML = employees
            .map((employee) => `<option value="${escapeHtml(employee.employeeName)}">${escapeHtml(employee.employeeName)}</option>`)
            .join('');
        if (employees.some((employee) => employeeKey(employee.employeeName) === employeeKey(previousValue))) {
            overrideEmployee.value = previousValue;
        }
        overrideEmployee.disabled = !employees.length;
        overridePeriodLabel.textContent = analysis?.excelPeriod?.periodKey || analysis?.month || '';
        prefillOverridePlaceholders();
    }

    function selectedOverrideEmployee() {
        return (analysis?.employees || []).find((employee) => employeeKey(employee.employeeName) === employeeKey(overrideEmployee.value));
    }

    function setInputSource(input, value) {
        if (!input) return;
        input.placeholder = typeof value === 'number' && Number.isFinite(value) ? String(value) : 'Ontbreekt';
        input.value = '';
    }

    function prefillOverridePlaceholders() {
        const employee = selectedOverrideEmployee();
        const excel = employee?.excel || {};
        setInputSource(overrideScheduled, excel.scheduledHours);
        setInputSource(overrideMinimum, excel.minimumHours);
        setInputSource(overrideThis, excel.overtimeThisMonth);
        setInputSource(overridePrevious, excel.overtimePreviousMonth);
        setInputSource(overrideAfter, excel.overtimeAfterMonth);
        overrideNote.value = excel.overrideNote || '';
        overrideDelete.disabled = !excel.hasOverride;
    }

    async function saveOverride(event) {
        event.preventDefault();
        if (!overrideEmployee.value) return setMessage('Kies eerst een medewerker.', 'error');
        const periodKey = analysis?.excelPeriod?.periodKey;
        if (!periodKey) return setMessage('Er is geen geïmporteerde Excel-maand om te corrigeren.', 'error');
        try {
            await requestJson('/api/hours/excel-overrides', {
                method: 'PUT',
                body: JSON.stringify({
                    periodKey,
                    employeeName: overrideEmployee.value,
                    scheduledHours: overrideScheduled.value,
                    minimumHours: overrideMinimum.value,
                    overtimeThisMonth: overrideThis.value,
                    overtimePreviousMonth: overridePrevious.value,
                    overtimeAfterMonth: overrideAfter.value,
                    note: overrideNote.value.trim()
                })
            });
            setMessage('Handmatige maandcorrectie opgeslagen.', 'success');
            await loadAll();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    async function deleteOverride() {
        const periodKey = analysis?.excelPeriod?.periodKey;
        if (!periodKey || !overrideEmployee.value || !window.confirm('Handmatige correctie verwijderen en weer volledig Excel gebruiken?')) return;
        try {
            await requestJson('/api/hours/excel-overrides', {
                method: 'DELETE',
                body: JSON.stringify({ periodKey, employeeName: overrideEmployee.value })
            });
            setMessage('Handmatige correctie verwijderd.', 'success');
            await loadAll();
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    function renderAll({ announce = false } = {}) {
        if (!analysis) return;
        renderPeriodStatus();
        renderSummary();
        renderContractTable();
        renderFlexTable();
        renderIssues();
        populateOverrideEmployees();
        if (announce) setMessage(`${FILTER_LABELS[selectedType()]} getoond: ${filteredEmployees().length} medewerker(s).`, 'success');
    }

    async function loadAll() {
        setMessage('Excel-maandpagina en urengegevens laden...');
        try {
            const month = monthFilter.value || currentMonth();
            analysis = await requestJson(`/api/hours/analysis?month=${encodeURIComponent(month)}`);
            canEdit = Boolean(analysis.permissions?.canEdit);
            qualitySection.hidden = !canEdit;
            renderAll();
            const pageName = analysis?.excelPeriod?.sheetName || formatMonth(analysis.month);
            setMessage(`Overzicht bijgewerkt vanuit ${pageName}.`, 'success');
        } catch (error) {
            console.error(error);
            if (error.status === 401) return window.location.replace('login.html?next=hours.html');
            if (error.status === 403) return window.location.replace('index.html');
            setMessage(error.message, 'error');
            summaryContainer.innerHTML = '';
            periodStatus.innerHTML = '';
            contractResults.innerHTML = flexResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
        }
    }

    filterForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        loadAll();
    });
    contractTypeFilter?.addEventListener('change', () => renderAll({ announce: true }));
    overrideEmployee?.addEventListener('change', prefillOverridePlaceholders);
    overrideForm?.addEventListener('submit', saveOverride);
    overrideDelete?.addEventListener('click', deleteOverride);

    monthFilter.value = currentMonth();
    document.addEventListener('authready', (event) => {
        if (event.detail.authenticated && ['manager', 'admin'].includes(event.detail.role)) loadAll();
    }, { once: true });
})();
