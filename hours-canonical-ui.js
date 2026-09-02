(() => {
    const byId = (id) => document.getElementById(id);
    const form = byId('hours-filter-form');
    const monthFilter = byId('month-filter');
    const typeFilter = byId('contract-type-filter');
    const sourceStatus = byId('hours-source-status');
    const message = byId('hours-message');
    const summary = byId('hours-summary');
    const contractSection = byId('contract-section');
    const flexSection = byId('flex-section');
    const contractResults = byId('contract-results');
    const flexResults = byId('flex-results');
    const contractCount = byId('contract-count');
    const flexCount = byId('flex-count');
    const paritySection = byId('shadow-parity-section');
    const parityStatus = byId('shadow-parity-status');
    const parityResults = byId('shadow-parity-results');

    let currentAnalysis = null;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

    function currentMonth() {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function formatMonth(month) {
        const [year, number] = String(month || '').split('-').map(Number);
        return year && number
            ? new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' }).format(new Date(year, number - 1, 1))
            : month || '-';
    }

    function formatHours(value, signed = false) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
        const number = Number(value);
        const formatted = new Intl.NumberFormat('nl-NL', {
            minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
            maximumFractionDigits: 2
        }).format(number);
        return `${signed && number > 0 ? '+' : ''}${formatted} u`;
    }

    function balanceClass(value) {
        if (!Number.isFinite(Number(value))) return 'is-unknown';
        if (Number(value) < -0.01) return 'is-negative';
        if (Number(value) > 0.01) return 'is-positive';
        return 'is-neutral';
    }

    async function requestJson(url) {
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'De urenanalyse kon niet worden geladen.');
        return payload;
    }

    function selectedType() {
        return ['all', 'contract', 'flex'].includes(typeFilter.value) ? typeFilter.value : 'all';
    }

    function setMessage(text, type = '') {
        if (!message) return;
        message.textContent = text;
        message.className = `hours-message${type ? ` is-${type}` : ''}`;
    }

    function renderSourceStatus(data) {
        const canonical = data.source === 'canonical_published';
        sourceStatus.className = `excel-period-status ${canonical ? 'is-success' : 'is-warning'}`;
        sourceStatus.innerHTML = `
            <div>
                <strong>${canonical ? 'Rooster V2 · published' : 'Historische legacybron'}</strong>
                <span>${escapeHtml(data.sourceLabel || '')}</span>
            </div>
            <span class="period-chip">${canonical ? `vanaf ${escapeHtml(data.planningBaseline)}` : 'vóór Rooster V2-baseline'}</span>
        `;
    }

    function visibleEmployees() {
        const type = selectedType();
        return (currentAnalysis?.employees || []).filter((employee) => type === 'all' || employee.contractType === type);
    }

    function renderSummary() {
        const employees = visibleEmployees();
        const contracts = employees.filter((employee) => employee.contractType === 'contract');
        const flex = employees.filter((employee) => employee.contractType === 'flex');
        const cards = [];
        if (selectedType() !== 'flex') {
            const scheduled = contracts.reduce((sum, employee) => sum + numeric(employee.scheduledHours), 0);
            const delta = contracts.reduce((sum, employee) => sum + numeric(employee.monthDelta), 0);
            cards.push([formatHours(scheduled), 'Published ingepland', '']);
            cards.push([formatHours(delta, true), 'Maandverschil contract', balanceClass(delta)]);
        }
        if (selectedType() !== 'contract') {
            const average = flex.length
                ? flex.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0) / flex.length
                : 0;
            cards.push([formatHours(average), 'Gemiddelde flex', '']);
        }
        cards.push([String(employees.length), 'Medewerkers', '']);
        summary.innerHTML = cards.map(([value, label, className]) => `
            <article class="hours-summary-card ${className}">
                <span class="summary-value">${escapeHtml(value)}</span>
                <span class="summary-label">${escapeHtml(label)}</span>
            </article>
        `).join('');
    }

    function setSectionVisible(section, visible) {
        if (!section) return;
        section.hidden = !visible;
        section.classList.toggle('hours-filter-hidden', !visible);
    }

    function renderContracts() {
        const visible = selectedType() !== 'flex';
        setSectionVisible(contractSection, visible);
        if (!visible) return;
        const employees = (currentAnalysis?.employees || [])
            .filter((employee) => employee.contractType === 'contract')
            .sort((a, b) => numeric(a.bankBalance) - numeric(b.bankBalance)
                || a.employeeName.localeCompare(b.employeeName, 'nl'));
        contractCount.textContent = `${employees.length} medewerker${employees.length === 1 ? '' : 's'} · ${formatMonth(currentAnalysis?.month)}`;
        contractResults.innerHTML = employees.length ? `
            <table class="hours-table excel-hours-table">
                <thead><tr>
                    <th>Medewerker</th><th>Contract</th><th>Published</th><th>Maandnorm</th>
                    <th>Verschil</th><th>Urenbank</th><th>Locaties</th>
                </tr></thead>
                <tbody>${employees.map((employee) => `
                    <tr>
                        <td><strong>${escapeHtml(employee.employeeName)}</strong></td>
                        <td>${formatHours(employee.weeklyContractHours)} / week</td>
                        <td><strong>${formatHours(employee.scheduledHours)}</strong></td>
                        <td>${formatHours(employee.monthlyNorm)}</td>
                        <td><span class="hours-balance ${balanceClass(employee.monthDelta)}">${formatHours(employee.monthDelta, true)}</span></td>
                        <td><span class="hours-balance ${balanceClass(employee.bankBalance)}">${formatHours(employee.bankBalance, true)}</span></td>
                        <td>${escapeHtml((employee.locations || []).join(', ') || '—')}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        ` : '<p class="empty-state">Geen contractmedewerkers voor deze maand.</p>';
    }

    function renderFlex() {
        const visible = selectedType() !== 'contract';
        setSectionVisible(flexSection, visible);
        if (!visible) return;
        const employees = (currentAnalysis?.employees || [])
            .filter((employee) => employee.contractType === 'flex')
            .sort((a, b) => numeric(b.creditedHours) - numeric(a.creditedHours)
                || a.employeeName.localeCompare(b.employeeName, 'nl'));
        const average = employees.length
            ? employees.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0) / employees.length
            : 0;
        flexCount.textContent = `${employees.length} medewerker${employees.length === 1 ? '' : 's'} · gemiddeld ${formatHours(average)}`;
        flexResults.innerHTML = employees.length ? `
            <table class="hours-table flex-hours-table">
                <thead><tr><th>Medewerker</th><th>Published</th><th>Vorige maand</th><th>Verschil gemiddelde</th><th>Locaties</th></tr></thead>
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
        ` : '<p class="empty-state">Geen flexmedewerkers voor deze maand.</p>';
    }

    function parityStatusLabel(status) {
        if (status === 'match') return 'Gelijk';
        if (status === 'canonical_only') return 'Alleen V2';
        if (status === 'legacy_only') return 'Alleen legacy';
        return 'Verschil';
    }

    async function renderParity(month) {
        if (!currentAnalysis?.permissions?.canViewShadowParity || !paritySection) {
            if (paritySection) paritySection.hidden = true;
            return;
        }
        paritySection.hidden = false;
        parityStatus.textContent = 'Vergelijking laden...';
        parityResults.innerHTML = '';
        try {
            const parity = await requestJson(`/api/roster-operations/parity?month=${encodeURIComponent(month)}`);
            if (!parity.available) {
                parityStatus.textContent = parity.message || 'Geen legacyvergelijking beschikbaar.';
                parityResults.innerHTML = '<p class="empty-state">De canonical uren blijven de primaire waarheid.</p>';
                return;
            }
            const mismatches = (parity.rows || []).filter((row) => row.status !== 'match');
            parityStatus.textContent = `${parity.summary?.match || 0} gelijk · ${mismatches.length} afwijking${mismatches.length === 1 ? '' : 'en'} · V2 ${formatHours(parity.summary?.canonicalHours)} / legacy ${formatHours(parity.summary?.legacyHours)}`;
            parityResults.innerHTML = parity.rows?.length ? `
                <table class="hours-table">
                    <thead><tr><th>Medewerker</th><th>Rooster V2</th><th>Legacy</th><th>Delta</th><th>Status</th></tr></thead>
                    <tbody>${parity.rows.map((row) => `
                        <tr>
                            <td><strong>${escapeHtml(row.employeeName)}</strong></td>
                            <td>${formatHours(row.canonicalHours)}</td>
                            <td>${formatHours(row.legacyHours)}</td>
                            <td><span class="hours-balance ${balanceClass(row.deltaHours)}">${formatHours(row.deltaHours, true)}</span></td>
                            <td>${escapeHtml(parityStatusLabel(row.status))}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            ` : '<p class="empty-state">Geen vergelijkbare diensten gevonden.</p>';
        } catch (error) {
            parityStatus.textContent = 'Shadow parity mislukt';
            parityResults.innerHTML = `<p class="error-state">${escapeHtml(error.message)}</p>`;
        }
    }

    function renderAll() {
        renderSummary();
        renderContracts();
        renderFlex();
    }

    async function loadAnalysis() {
        const month = monthFilter.value || currentMonth();
        setMessage('Uren uit het gepubliceerde rooster laden...');
        try {
            currentAnalysis = await requestJson(`/api/roster-operations/hours?month=${encodeURIComponent(month)}`);
            renderSourceStatus(currentAnalysis);
            renderAll();
            await renderParity(month);
            setMessage(`Urenanalyse ${formatMonth(month)} geladen.`, 'success');
        } catch (error) {
            currentAnalysis = null;
            summary.innerHTML = '';
            contractResults.innerHTML = `<p class="error-state">${escapeHtml(error.message)}</p>`;
            flexResults.innerHTML = '';
            setMessage(error.message, 'error');
        }
    }

    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        loadAnalysis();
    });
    typeFilter?.addEventListener('change', () => {
        if (currentAnalysis) renderAll();
    });

    document.addEventListener('authready', () => {
        if (!monthFilter.value) monthFilter.value = currentMonth();
        loadAnalysis();
    }, { once: true });
})();
