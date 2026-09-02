(() => {
    const byId = (id) => document.getElementById(id);
    const form = byId('staffing-filter-form');
    const fromFilter = byId('from-filter');
    const toFilter = byId('to-filter');
    const locationFilter = byId('location-filter');
    const statusFilter = byId('status-filter');
    const summary = byId('staffing-summary');
    const results = byId('staffing-results');
    const resultCount = byId('staffing-result-count');
    const rulesGrid = byId('active-rules-grid');

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    function isoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatDate(value) {
        const [year, month, day] = String(value || '').split('-').map(Number);
        if (!year || !month || !day) return value || '-';
        return new Intl.DateTimeFormat('nl-NL', {
            weekday: 'short', day: '2-digit', month: '2-digit'
        }).format(new Date(year, month - 1, day));
    }

    function statusLabel(status) {
        if (status === 'under') return 'Onderbezet';
        if (status === 'vulnerable') return 'Kwetsbaar';
        return 'Voldoende';
    }

    async function requestJson(url) {
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'De bezettingsanalyse kon niet worden geladen.');
        return payload;
    }

    function setDefaultDates() {
        if (!fromFilter || !toFilter) return;
        const from = new Date();
        const to = new Date(from.getTime());
        to.setDate(to.getDate() + 41);
        if (!fromFilter.value) fromFilter.value = isoDate(from);
        if (!toFilter.value) toFilter.value = isoDate(to);
    }

    function applyAllowedLocations(permissions = {}) {
        const allowed = Array.isArray(permissions.allowedLocations) ? permissions.allowedLocations : [];
        if (!allowed.length || permissions.organizationWide) return;
        [...locationFilter.options].forEach((option) => {
            if (!option.value) {
                option.textContent = allowed.length > 1 ? 'Mijn vestigingen' : allowed[0];
                option.disabled = false;
                return;
            }
            option.disabled = !allowed.includes(option.value);
            option.hidden = !allowed.includes(option.value);
        });
        if (locationFilter.value && !allowed.includes(locationFilter.value)) locationFilter.value = '';
    }

    function renderRules(data) {
        const evening = data.rules?.eveningPeak || {};
        const lessonLocations = data.rules?.lessonLocations || [];
        const schedules = Object.entries(data.rules?.standardSchedules || {});
        const cards = [
            `<article><strong>Roosterbron</strong><p>Alleen de nieuwste gepubliceerde Rooster V2-versies tellen mee.</p></article>`,
            `<article><strong>Avondpiek</strong><p>${evening.enabled ? `${escapeHtml(evening.start)}–${escapeHtml(evening.end)} · minimaal ${Number(evening.minimum || 0)}` : 'Niet actief'}</p></article>`,
            `<article><strong>Groepslesregel</strong><p>${lessonLocations.length ? `${escapeHtml(lessonLocations.join(', '))} hebben extra lesdekking.` : 'Geen extra lesminimum actief.'}</p></article>`,
            `<article><strong>Enkele-bezetting uitzonderingen</strong><p>${Number(data.rules?.singleCoverageExceptionCount || 0)} actief binnen de gekozen vestiging(en).</p></article>`
        ];
        for (const [location, schedule] of schedules) {
            cards.push(`<article><strong>${escapeHtml(location)}</strong><p>Standaardvensters uit database · ${escapeHtml(schedule)}</p></article>`);
        }
        rulesGrid.innerHTML = cards.join('');
    }

    function renderSummary(data) {
        const cards = [
            [data.summary?.noCoverage || 0, 'Blokken zonder medewerker', 'is-danger'],
            [data.summary?.singleCoverage || 0, 'Kwetsbare enkele bezetting', 'is-warning'],
            [data.summary?.otherIssues || 0, 'Overige aandachtspunten', 'is-warning'],
            [data.summary?.sufficient || 0, 'Voldoende blokken', 'is-ok'],
            [`${Number(data.summary?.underHours || 0).toLocaleString('nl-NL')} u`, 'Onderbezette tijd', 'is-danger']
        ];
        summary.innerHTML = cards.map(([value, label, className]) => `
            <article class="summary-card ${className}">
                <span class="summary-value">${escapeHtml(value)}</span>
                <span class="summary-label">${escapeHtml(label)}</span>
            </article>
        `).join('');
    }

    function renderRows(data) {
        const rows = data.rows || [];
        resultCount.textContent = `${rows.length} tijdsblok${rows.length === 1 ? '' : 'ken'}`;
        if (!rows.length) {
            results.innerHTML = '<p class="empty-state">Geen tijdsblokken binnen dit filter.</p>';
            return;
        }
        results.innerHTML = rows.map((row) => {
            const employeeText = row.employees?.length ? row.employees.join(', ') : 'Niemand ingepland';
            const openText = row.openShiftCount ? ` · ${row.openShiftCount} open dienst${row.openShiftCount === 1 ? '' : 'en'}` : '';
            const lessonText = row.activeLessons?.length
                ? `<span class="muted">Les: ${escapeHtml(row.activeLessons.map((lesson) => lesson.name).join(', '))}</span>`
                : '<span class="muted">Geen groepsles actief</span>';
            const reasons = (row.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
            return `
                <article class="staffing-row is-${escapeHtml(row.status)}">
                    <div class="staffing-date"><strong>${escapeHtml(formatDate(row.date))}</strong><span class="muted">${escapeHtml(row.date)}</span></div>
                    <div class="staffing-location"><strong>${escapeHtml(row.location)}</strong>${lessonText}</div>
                    <div><strong>${escapeHtml(row.startTime)}–${escapeHtml(row.endTime)}</strong><span class="muted">${row.standardShift ? 'Standaarddienst' : 'Analyseblok'}</span></div>
                    <div><strong>${row.employees?.length || 0}</strong><span class="muted">${escapeHtml(employeeText + openText)}</span></div>
                    <div><span class="status-pill is-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span></div>
                    <div class="staffing-reason">${reasons ? `<ul>${reasons}</ul>` : 'Geen aanvullende reden.'}</div>
                </article>
            `;
        }).join('');
    }

    async function loadAnalysis() {
        results.innerHTML = '<p class="empty-state">Bezetting berekenen...</p>';
        resultCount.textContent = 'Laden...';
        const params = new URLSearchParams({
            from: fromFilter.value,
            to: toFilter.value,
            status: statusFilter.value
        });
        if (locationFilter.value) params.set('location', locationFilter.value);
        try {
            const data = await requestJson(`/api/roster-operations/staffing?${params}`);
            applyAllowedLocations(data.permissions);
            renderRules(data);
            renderSummary(data);
            renderRows(data);
        } catch (error) {
            resultCount.textContent = 'Analyse mislukt';
            results.innerHTML = `<p class="error-state">${escapeHtml(error.message)}</p>`;
            summary.innerHTML = '';
        }
    }

    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        loadAnalysis();
    });

    document.addEventListener('authready', () => {
        setDefaultDates();
        loadAnalysis();
    }, { once: true });
})();
