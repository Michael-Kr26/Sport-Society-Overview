(() => {
    const byId = (id) => document.getElementById(id);
    const roleLabels = { guest: 'Guest', employee: 'Employee', manager: 'Manager', admin: 'Admin' };

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    function isoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function currentMonth() {
        return isoDate(new Date()).slice(0, 7);
    }

    function addDays(date, amount) {
        const result = new Date(date);
        result.setDate(result.getDate() + amount);
        return result;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
    }

    function formatHours(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
        return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(Number(value))} u`;
    }

    function statusClass(status) {
        if (status === 'Open') return 'status-open';
        if (status === 'In behandeling') return 'status-progress';
        if (status === 'Afgerond') return 'status-done';
        return 'status-archived';
    }

    async function requestJson(url) {
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.message || 'Gegevens konden niet worden opgehaald.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function renderKpis(items) {
        const container = byId('dashboard-kpis');
        if (!container) return;
        container.innerHTML = items.map((item) => `
            <article class="dashboard-kpi${item.tone ? ` is-${item.tone}` : ''}">
                <p class="dashboard-kpi-label">${escapeHtml(item.label)}</p>
                <p class="dashboard-kpi-value">${escapeHtml(item.value)}</p>
                <p class="dashboard-kpi-note">${escapeHtml(item.note)}</p>
            </article>
        `).join('');
    }

    function action(href, icon, title, description) {
        return `<a class="dashboard-action" href="${href}">
            <span class="dashboard-action-icon" aria-hidden="true">${icon}</span>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(description)}</span>
        </a>`;
    }

    function renderActions(role) {
        const container = byId('dashboard-actions');
        if (!container) return;
        const actions = [action('roster.html', '▦', 'Rooster', 'Bekijk diensten, afwezigheid en locaties.')];

        if (role === 'guest') {
            actions.push(action('login.html', '●', 'Inloggen', 'Open de functies die aan jouw accountrol zijn gekoppeld.'));
        } else {
            actions.push(action('login.html', '●', 'Mijn account', 'Bekijk de actieve sessie en accounttoegang.'));
        }

        if (['manager', 'admin'].includes(role)) {
            actions.push(action('staffing.html', '◫', 'Bezettingsanalyse', 'Controleer kwetsbare en onderbezette standaarddiensten.'));
            actions.push(action('hours.html', '◷', 'Urenanalyse', 'Bekijk de maandbron, urenbank en datakwaliteit.'));
            actions.push(action('cml.html', '↔', 'Roosterwijzigingen', 'Behandel en controleer operationele wijzigingen.'));
        }

        if (role === 'admin') {
            actions.push(action('employee-settings.html', '♙', 'Medewerkers', 'Beheer contractperiodes, start- en einddatums.'));
            actions.push(action('dashboard.html', '◇', 'Integratiestatus', 'Controleer imports, preview en technische koppelingen.'));
            actions.push(action('create.html', '◎', 'Accounts', 'Beheer rollen, vestigingen en actieve accounts.'));
        }

        actions.push(action('help.html', '?', 'Handleiding', 'Open procedures, bronregels en probleemoplossing.'));
        container.innerHTML = actions.join('');
    }

    function renderLatestChange(change, error = null) {
        const container = byId('latest-change-content');
        if (!container) return;
        if (error) {
            container.innerHTML = `<p class="dashboard-state is-error">${escapeHtml(error.message)}</p>`;
            return;
        }
        if (!change) {
            container.innerHTML = '<p class="dashboard-state">Geen open wijziging beschikbaar voor deze selectie.</p>';
            return;
        }
        const employees = [change.employee, change.employee2].filter(Boolean).join(' / ');
        container.innerHTML = `
            <p><span class="field-label">Wie:</span> ${escapeHtml(employees)}</p>
            <p><span class="field-label">Datum:</span> ${escapeHtml(formatDate(change.date))}</p>
            <p><span class="field-label">Type:</span> ${escapeHtml(change.type)}</p>
            <p><span class="field-label">Locatie:</span> ${escapeHtml(change.location || '-')}</p>
            <p><span class="field-label">Status:</span> <span class="status-pill ${statusClass(change.status)}">${escapeHtml(change.status)}</span></p>
        `;
    }

    async function loadLatestChange(authState) {
        if (!['manager', 'admin'].includes(authState.role)) {
            renderLatestChange(null);
            return;
        }
        try {
            if (authState.role === 'manager' && authState.user?.location) {
                const query = new URLSearchParams({ location: authState.user.location, page: '1' });
                const payload = await requestJson(`/api/changes?${query}`);
                renderLatestChange((payload.items || [])[0] || null);
                return;
            }
            renderLatestChange(await requestJson('/api/changes/latest'));
        } catch (error) {
            if (error.status === 404) renderLatestChange(null);
            else renderLatestChange(null, error);
        }
    }

    async function loadRelease() {
        try {
            const release = await requestJson('/release.json');
            byId('dashboard-release-badge').textContent = `v${release.version}`;
            byId('dashboard-release-meta').textContent = `${release.status} · ${release.channel}`;
            byId('dashboard-release-title').textContent = release.title;
            byId('dashboard-release-copy').textContent = `Branch ${release.branch}; nog niet vrijgegeven als productieversie.`;
            byId('dashboard-release-list').innerHTML = (release.highlights || [])
                .map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Geen releasepunten vastgelegd.</li>';
        } catch (error) {
            byId('dashboard-release-badge').textContent = 'Versie onbekend';
            byId('dashboard-release-meta').textContent = 'release.json niet leesbaar';
            byId('dashboard-release-list').innerHTML = `<li>${escapeHtml(error.message)}</li>`;
        }
    }

    function publicKpis(role) {
        if (role === 'employee') {
            return [
                { label: 'Toegang', value: 'Employee', note: 'Persoonlijke uren blijven geparkeerd tot expliciete uitvoering.' },
                { label: 'Rooster', value: 'Actief', note: 'Het effectieve rooster is beschikbaar via de roosterpagina.' },
                { label: 'Selfservice', value: 'V2', note: 'Verlof, beschikbaarheid en dienstenruil volgen pas op de V2-basis.' },
                { label: 'Release', value: 'V1.5', note: 'Stabiliteit, dashboards en datakwaliteit zijn de huidige focus.' }
            ];
        }
        return [
            { label: 'Toegang', value: 'Guest', note: 'Log in voor rolgebonden beheer en analyses.' },
            { label: 'Rooster', value: 'Openbaar', note: 'De algemene roosterweergave blijft beschikbaar.' },
            { label: 'Handleiding', value: 'Beschikbaar', note: 'Procedures en bronregels staan centraal beschreven.' },
            { label: 'Release', value: 'V1.5', note: 'De operationele release is in ontwikkeling.' }
        ];
    }

    async function managementKpis(authState) {
        const today = new Date();
        const from = isoDate(today);
        const to = isoDate(addDays(today, 13));
        const rosterQuery = new URLSearchParams({ from, to, type: 'shift' });
        if (authState.role === 'manager' && authState.user?.location) rosterQuery.set('location', authState.user.location);

        const month = currentMonth();
        const requests = [
            requestJson(`/api/roster?${rosterQuery}`),
            requestJson(`/api/hours/excel-analysis?month=${month}`)
        ];
        if (authState.role === 'admin') requests.push(requestJson('/api/access/users'));

        const results = await Promise.allSettled(requests);
        const rosterPayload = results[0].status === 'fulfilled' ? results[0].value : [];
        const roster = Array.isArray(rosterPayload) ? rosterPayload : (rosterPayload.items || []);
        const shifts = roster.filter((item) => item.itemType === 'shift' || item.item_type === 'shift');
        const employees = new Set(shifts.map((item) => item.employeeName || item.employee_name).filter((name) => name && String(name).toUpperCase() !== 'ALL'));

        const excel = results[1].status === 'fulfilled' ? results[1].value : null;
        const excelEmployees = excel?.employees || [];
        const fallbackCount = excelEmployees.filter((employee) => employee.usedFallback).length;
        const missingCount = excelEmployees.filter((employee) => !employee.isComplete).length;
        const sourceTone = missingCount ? 'negative' : fallbackCount ? '' : 'positive';
        const sourceValue = missingCount ? `${missingCount} fout` : fallbackCount ? `${fallbackCount} terugval` : 'Compleet';

        const items = [
            {
                label: authState.user?.location ? `Diensten ${authState.user.location}` : 'Diensten organisatie',
                value: String(shifts.length),
                note: `${formatDate(from)} t/m ${formatDate(to)}; effectieve roosterbron.`
            },
            {
                label: 'Ingeplande medewerkers',
                value: String(employees.size),
                note: 'Unieke medewerkers binnen dezelfde veertiendaagse selectie.'
            },
            {
                label: `Urenbron ${month}`,
                value: sourceValue,
                note: excel?.period ? `Bronpagina ${excel.period.sheetName}; ${excelEmployees.length} medewerkerregels.` : 'Geen Excel-maandbron beschikbaar.',
                tone: sourceTone
            }
        ];

        if (authState.role === 'admin') {
            const accountPayload = results[2].status === 'fulfilled' ? results[2].value : null;
            const accounts = accountPayload?.users || [];
            items.push({
                label: 'Actieve accounts',
                value: String(accounts.filter((account) => account.isActive).length),
                note: `${accounts.length} account(s) totaal; rollen en vestigingen via Accounts.`
            });
        } else {
            items.push({
                label: 'Profielvestiging',
                value: authState.user?.location || 'Niet gekoppeld',
                note: authState.user?.location ? 'Dashboardselecties gebruiken deze vestiging waar mogelijk.' : 'Laat een admin een vestiging koppelen.',
                tone: authState.user?.location ? '' : 'negative'
            });
        }
        return items;
    }

    function applyProfile(authState) {
        const role = authState.role || 'guest';
        const name = authState.user?.displayName || authState.user?.username || 'Niet ingelogd';
        const location = authState.user?.location || (role === 'admin' ? 'Alle vestigingen' : 'Openbare toegang');
        byId('dashboard-role-kicker').textContent = `${roleLabels[role] || role} dashboard`;
        byId('dashboard-role-badge').textContent = roleLabels[role] || role;
        byId('dashboard-profile-name').textContent = name;
        byId('dashboard-profile-meta').textContent = location;

        const titleByRole = {
            guest: 'Welkom bij Sport Society Overview',
            employee: `Welkom, ${name}`,
            manager: `Operationeel overzicht · ${location}`,
            admin: 'Organisatiebreed beheeroverzicht'
        };
        const introByRole = {
            guest: 'Bekijk het rooster of log in om de functies te openen die bij jouw rol horen.',
            employee: 'Gebruik het rooster en de beschikbare accountfuncties. Persoonlijke uren worden pas gebouwd na de geparkeerde V2-beslissing.',
            manager: 'Controleer de komende diensten, urenbronnen, bezetting en roosterwijzigingen binnen jouw operationele verantwoordelijkheid.',
            admin: 'Controleer organisatiebrede bronnen, accounts, medewerkersinstellingen en operationele afwijkingen.'
        };
        byId('dashboard-title').textContent = titleByRole[role] || titleByRole.guest;
        byId('dashboard-intro').textContent = introByRole[role] || introByRole.guest;
    }

    async function initialize(authState) {
        applyProfile(authState);
        renderActions(authState.role);
        loadRelease();
        loadLatestChange(authState);

        if (!['manager', 'admin'].includes(authState.role)) {
            renderKpis(publicKpis(authState.role));
            return;
        }

        try {
            renderKpis(await managementKpis(authState));
        } catch (error) {
            renderKpis([
                { label: 'Dashboardfout', value: 'Niet compleet', note: error.message, tone: 'negative' },
                { label: 'Detailpagina’s', value: 'Beschikbaar', note: 'Gebruik de modules om bronnen afzonderlijk te controleren.' }
            ]);
        }
    }

    document.addEventListener('authready', (event) => initialize(event.detail), { once: true });
})();
