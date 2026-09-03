(() => {
    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    const currentMonth = () => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };

    function formatDateTime(value) {
        if (!value) return 'Niet beschikbaar';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('nl-NL', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(date);
    }

    async function requestJson(url) {
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.message || 'Bron kon niet worden opgehaald.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function issue(type, title, description, href = null) { return { type, title, description, href }; }

    function renderKpis(items) {
        byId('quality-kpis').innerHTML = items.map((item) => `
            <article class="quality-kpi${item.tone ? ` is-${item.tone}` : ''}">
                <span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.note)}</p>
            </article>`).join('');
    }

    function renderIssues(items) {
        byId('quality-issue-count').textContent = String(items.length);
        if (!items.length) {
            byId('quality-issues').innerHTML = '<p class="quality-empty is-success">Geen blokkerende bronproblemen gevonden.</p>';
            return;
        }
        byId('quality-issues').innerHTML = items.map((item) => `
            <article class="quality-issue is-${escapeHtml(item.type)}">
                <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description)}</p></div>
                ${item.href ? `<a class="sso-button sso-button--text" href="${item.href}">Controleren →</a>` : ''}
            </article>`).join('');
    }

    function renderSources(sources) {
        byId('quality-sources').innerHTML = sources.map((source) => `
            <div><dt>${escapeHtml(source.label)}</dt><dd>${escapeHtml(source.value)}</dd></div>`).join('');
    }

    function renderOverall(issues, sourceErrors) {
        const blocking = issues.filter((item) => item.type === 'error').length + sourceErrors;
        const warnings = issues.filter((item) => item.type === 'warning').length;
        const badge = byId('quality-overall-status');
        badge.classList.remove('is-active', 'is-planned', 'is-error');
        if (blocking) {
            badge.textContent = 'Actie vereist'; badge.classList.add('is-error');
            byId('quality-overall-title').textContent = `${blocking} blokkerende broncontrole${blocking === 1 ? '' : 's'}`;
            byId('quality-overall-copy').textContent = 'Minimaal één bron kon niet worden opgehaald of bevat geen complete gegevens.';
            return;
        }
        if (warnings) {
            badge.textContent = 'Waarschuwingen'; badge.classList.add('is-planned');
            byId('quality-overall-title').textContent = `${warnings} aandachtspunt${warnings === 1 ? '' : 'en'}`;
            byId('quality-overall-copy').textContent = 'De applicatie kan functioneren, maar één of meer bronnen gebruiken een terugval of onvolledige instelling.';
            return;
        }
        badge.textContent = 'Bronnen compleet'; badge.classList.add('is-active');
        byId('quality-overall-title').textContent = 'Geen openstaande bronproblemen';
        byId('quality-overall-copy').textContent = 'De gecontroleerde rooster-, uren-, medewerkers- en accountbronnen zijn leesbaar.';
    }

    async function loadQualityCenter() {
        const month = currentMonth();
        const requests = await Promise.allSettled([
            requestJson('/release.json'), requestJson('/api/hours/excel-periods'),
            requestJson(`/api/hours/excel-analysis?month=${month}`), requestJson('/api/access/users'),
            requestJson('/api/hours/employees'), requestJson('/api/roster-preview')
        ]);
        const release = requests[0].status === 'fulfilled' ? requests[0].value : null;
        const periodsPayload = requests[1].status === 'fulfilled' ? requests[1].value : null;
        const analysis = requests[2].status === 'fulfilled' ? requests[2].value : null;
        const accountsPayload = requests[3].status === 'fulfilled' ? requests[3].value : null;
        const employeesPayload = requests[4].status === 'fulfilled' ? requests[4].value : null;
        const rosterPreview = requests[5].status === 'fulfilled' ? requests[5].value : null;
        const sourceErrors = requests.filter((result) => result.status === 'rejected').length;
        byId('quality-version').textContent = release ? `v${release.version}` : 'Versie onbekend';
        const periods = periodsPayload?.periods || [];
        const latestPeriod = periods[0] || null;
        const excelEmployees = analysis?.employees || [];
        const excelIssues = analysis?.issues || [];
        const fallbackEmployees = excelEmployees.filter((employee) => employee.usedFallback);
        const missingEmployees = excelEmployees.filter((employee) => !employee.isComplete);
        const accounts = accountsPayload?.users || [];
        const activeAccounts = accounts.filter((account) => account.isActive);
        const managerWithoutLocation = accounts.filter((account) => account.isActive && account.role === 'manager' && !account.location);
        const employees = employeesPayload?.employees || [];
        const activeEmployees = employees.filter((employee) => employee.isActive);
        const activeWithoutPeriods = activeEmployees.filter((employee) => employee.contractType === 'contract' && !(employee.contractPeriods || []).length);
        const issues = [];
        missingEmployees.forEach((employee) => issues.push(issue('error', `${employee.employeeName}: urenbron onvolledig`, `De gekozen maand ${month} en eventuele eerdere bron leveren niet alle vijf waarden.`, 'hours.html')));
        fallbackEmployees.forEach((employee) => issues.push(issue('warning', `${employee.employeeName}: terugvalbron`, `${employee.sourceSheetName || employee.sourcePeriodKey} wordt tijdelijk gebruikt in plaats van ${month}.`, 'hours.html')));
        managerWithoutLocation.forEach((account) => issues.push(issue('error', `${account.displayName}: manager zonder vestiging`, 'Vestigingsgebonden schermen kunnen hierdoor niet correct worden begrensd.', 'create.html')));
        activeWithoutPeriods.forEach((employee) => issues.push(issue('warning', `${employee.employeeName}: contract zonder periode`, 'De medewerker staat als contractmedewerker ingesteld maar heeft geen contracthistorie.', 'employee-settings.html')));
        for (const excelIssue of excelIssues) {
            if (['employee_fallback', 'employee_missing'].includes(excelIssue.type)) continue;
            issues.push(issue(excelIssue.type === 'source_validation' || excelIssue.type === 'period_structure' ? 'warning' : 'error', excelIssue.employeeName ? `${excelIssue.employeeName}: Excel-controle` : 'Excel-controle', excelIssue.message || 'Onbekende Excel-afwijking.', 'hours.html'));
        }
        requests.forEach((result, index) => {
            if (result.status !== 'rejected') return;
            const labels = ['Release', 'Excel-perioden', 'Excel-analyse', 'Accounts', 'Medewerkers', 'Rooster-preview'];
            issues.push(issue('error', `${labels[index]} niet bereikbaar`, result.reason?.message || 'De bron kon niet worden opgehaald.'));
        });
        renderKpis([
            { label: `Excel-uren ${month}`, value: missingEmployees.length ? `${missingEmployees.length} fout` : fallbackEmployees.length ? `${fallbackEmployees.length} terugval` : 'Compleet', note: `${excelEmployees.length} medewerkerregel(s) gecontroleerd.`, tone: missingEmployees.length ? 'error' : fallbackEmployees.length ? 'warning' : 'success' },
            { label: 'Actieve medewerkers', value: String(activeEmployees.length), note: `${employees.length} medewerkerinstelling(en) totaal.` },
            { label: 'Actieve accounts', value: String(activeAccounts.length), note: `${accounts.length} account(s) totaal; ${managerWithoutLocation.length} manager(s) zonder vestiging.`, tone: managerWithoutLocation.length ? 'error' : '' },
            { label: 'Laatste Excel-import', value: latestPeriod?.sheetName || 'Geen import', note: latestPeriod ? formatDateTime(latestPeriod.importedAt) : 'Importeer eerst het roosterbestand.', tone: latestPeriod ? '' : 'error' }
        ]);
        const previewCount = Array.isArray(rosterPreview?.items) ? rosterPreview.items.length : Array.isArray(rosterPreview) ? rosterPreview.length : Number(rosterPreview?.summary?.itemCount || rosterPreview?.itemsFound || 0);
        renderSources([
            { label: 'Excel-uren', value: latestPeriod ? `${latestPeriod.sourceFile || 'onbekend bestand'} · ${latestPeriod.sheetName} · ${latestPeriod.weekCount} weken · ${formatDateTime(latestPeriod.importedAt)}` : 'Geen geïmporteerde maandpagina' },
            { label: 'Rooster-preview', value: rosterPreview ? `${previewCount || 'Onbekend aantal'} item(s) in de laatste preview` : 'Geen leesbare preview' },
            { label: 'Release', value: release ? `v${release.version} · ${release.status} · ${release.branch}` : 'release.json niet leesbaar' }
        ]);
        renderIssues(issues); renderOverall(issues, sourceErrors);
    }

    document.addEventListener('authready', (event) => { if (event.detail.role === 'admin') loadQualityCenter(); }, { once: true });
})();
