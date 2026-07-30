(() => {
    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    const DOMAIN_ORDER = ['sales', 'leads', 'members', 'visits', 'coaching', 'retention'];
    let domainLabels = {};
    let authState = null;

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(`${value}T12:00:00`);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
    }

    function formatDateTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('nl-NL', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(date);
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(Number(seconds))) return '-';
        const value = Math.max(0, Math.round(Number(seconds)));
        const days = Math.floor(value / 86400);
        const hours = Math.floor((value % 86400) / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const remainder = value % 60;
        return [days ? `${days} d` : '', hours ? `${hours} u` : '', minutes ? `${minutes} min` : '', remainder || !value ? `${remainder} sec` : '']
            .filter(Boolean).join(' ');
    }

    function formatValue(value, unit) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
        const number = Number(value);
        if (unit === 'percentage') return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(number)}%`;
        if (unit === 'duration_seconds') return formatDuration(number);
        if (unit === 'ratio') return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(number);
        return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2, signDisplay: unit === 'signed_count' ? 'exceptZero' : 'auto' }).format(number);
    }

    async function requestJson(url) {
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'HealthPlanner-gegevens konden niet worden opgehaald.');
        return payload;
    }

    function queryString() {
        const query = new URLSearchParams();
        const from = byId('hp-from').value;
        const to = byId('hp-to').value;
        const location = byId('hp-location').value;
        const domain = byId('hp-domain').value;
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        if (location) query.set('location', location);
        if (domain) query.set('domain', domain);
        return query.toString();
    }

    function latestMap(rows) {
        return new Map(rows.map((row) => [`${row.location}|${row.metricKey}|${row.periodType}`, row]));
    }

    function metricValue(map, location, key, scope = 'month_to_date') {
        return map.get(`${location}|${key}|${scope}`) || null;
    }

    function renderKpis(payload) {
        const location = payload.filters.location;
        const map = latestMap(payload.latest || []);
        let items;
        if (!location) {
            items = [
                { label: 'Vestigingen', value: String(payload.summary.locationCount || 0), note: 'Selecteer één vestiging voor inhoudelijke KPI-kaarten.' },
                { label: 'KPI’s', value: String(payload.summary.metricCount || 0), note: 'Unieke ingelezen HealthPlanner-metrics.' },
                { label: 'Rapportdatum', value: formatDate(payload.summary.latestReportDate), note: 'Meest recente rapportdatum in deze selectie.' },
                { label: 'Bronregels', value: String(payload.summary.rowCount || 0), note: 'Aantal historische metingen binnen de filters.' }
            ];
        } else {
            const sold = metricValue(map, location, 'membershipsSold');
            const closing = metricValue(map, location, 'closingRate');
            const active = metricValue(map, location, 'activeMembers');
            const frequency = metricValue(map, location, 'visitFrequency');
            const dormant = metricValue(map, location, 'dormantMembers');
            const coached = metricValue(map, location, 'membersWithCoach');
            const cancellations = metricValue(map, location, 'cancellations');
            const coachCoverage = coached && active && Number(active.metricValue) > 0
                ? Math.round((Number(coached.metricValue) / Number(active.metricValue)) * 10000) / 100
                : null;
            items = [
                { label: 'Verkochte lidmaatschappen', value: formatValue(sold?.metricValue, sold?.metricUnit), note: 'Maand tot rapportdatum.' },
                { label: 'Afsluitingspercentage', value: formatValue(closing?.metricValue, closing?.metricUnit), note: 'HealthPlanner-verkoopresultaat.' },
                { label: 'Actieve leden', value: formatValue(active?.metricValue, active?.metricUnit), note: 'Momentopname uit de laatste rapportage.' },
                { label: 'Bezoekersfrequentie', value: formatValue(frequency?.metricValue, frequency?.metricUnit), note: 'Algemene frequentie uit HealthPlanner.' },
                { label: 'Slapende leden', value: formatValue(dormant?.metricValue, dormant?.metricUnit), note: 'Momentopname; definitie blijft die van HealthPlanner.', tone: Number(dormant?.metricValue) > 0 ? 'negative' : '' },
                { label: 'Coachdekking', value: coachCoverage === null ? '-' : `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(coachCoverage)}%`, note: 'Leden met coach gedeeld door actieve leden.' },
                { label: 'Opzeggingen', value: formatValue(cancellations?.metricValue, cancellations?.metricUnit), note: 'Maand tot rapportdatum.', tone: Number(cancellations?.metricValue) > 0 ? 'negative' : '' },
                { label: 'Rapportdatum', value: formatDate(payload.summary.latestReportDate), note: location }
            ];
        }
        byId('hp-kpis').innerHTML = items.map((item) => `
            <article class="hp-kpi${item.tone ? ` is-${item.tone}` : ''}">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
                <p>${escapeHtml(item.note)}</p>
            </article>
        `).join('');
    }

    function pairedLatest(rows) {
        const map = latestMap(rows);
        const result = [];
        const keys = new Set(rows.map((row) => `${row.location}|${row.metricKey}`));
        for (const key of keys) {
            const [location, metricKey] = key.split('|');
            const day = map.get(`${location}|${metricKey}|day`) || null;
            const month = map.get(`${location}|${metricKey}|month_to_date`) || null;
            const sample = month || day;
            result.push({ location, metricKey, day, month, sample });
        }
        return result.sort((a, b) => {
            const locationCompare = a.location.localeCompare(b.location, 'nl-NL');
            if (locationCompare) return locationCompare;
            const domainA = DOMAIN_ORDER.indexOf(a.sample?.metricDomain);
            const domainB = DOMAIN_ORDER.indexOf(b.sample?.metricDomain);
            if (domainA !== domainB) return domainA - domainB;
            return String(a.sample?.metricLabel).localeCompare(String(b.sample?.metricLabel), 'nl-NL');
        });
    }

    function renderLatest(payload) {
        const pairs = pairedLatest(payload.latest || []);
        if (!pairs.length) {
            byId('hp-latest').innerHTML = '<p class="hp-state">Geen HealthPlanner-metingen binnen deze selectie.</p>';
            return;
        }
        const locations = [...new Set(pairs.map((item) => item.location))];
        byId('hp-latest').innerHTML = locations.map((location) => {
            const locationPairs = pairs.filter((item) => item.location === location);
            const domains = DOMAIN_ORDER.filter((domain) => locationPairs.some((item) => item.sample?.metricDomain === domain));
            return `<section class="hp-location-block">
                ${locations.length > 1 ? `<h3>${escapeHtml(location)}</h3>` : ''}
                ${domains.map((domain) => `
                    <div class="hp-domain">
                        <h3>${escapeHtml(domainLabels[domain] || domain)}</h3>
                        <div class="hp-metric-grid">
                            ${locationPairs.filter((item) => item.sample?.metricDomain === domain).map((item) => `
                                <div class="hp-metric">
                                    <span>${escapeHtml(item.sample.metricLabel || item.metricKey)}</span>
                                    <strong title="Gisteren">${escapeHtml(formatValue(item.day?.metricValue, item.sample.metricUnit))}</strong>
                                    <small title="Maand tot rapportdatum">${escapeHtml(formatValue(item.month?.metricValue, item.sample.metricUnit))}</small>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </section>`;
        }).join('');
    }

    function renderHistory(payload) {
        const rows = [...(payload.rows || [])].reverse().slice(0, 500);
        byId('hp-row-count').textContent = `${payload.summary.rowCount || 0} regels`;
        if (!rows.length) {
            byId('hp-history').innerHTML = '<tr><td colspan="7">Geen historische metingen binnen deze selectie.</td></tr>';
            return;
        }
        byId('hp-history').innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(formatDate(row.reportDate))}</td>
                <td>${escapeHtml(row.location)}</td>
                <td>${row.periodType === 'day' ? 'Gisteren' : 'Maand'}</td>
                <td>${escapeHtml(domainLabels[row.metricDomain] || row.metricDomain)}</td>
                <td>${escapeHtml(row.metricLabel || row.metricKey)}</td>
                <td class="is-number">${escapeHtml(formatValue(row.metricValue, row.metricUnit))}${row.revisionCount ? `<span class="revision">${row.revisionCount} revisie</span>` : ''}</td>
                <td class="source-cell">${escapeHtml(row.sourceFile || '-')}${row.sourceRow ? ` · rij ${row.sourceRow}` : ''}</td>
            </tr>
        `).join('');
    }

    function renderSource(payload) {
        const latestImport = payload.summary.latestImport;
        const status = byId('hp-source-status');
        status.classList.remove('is-success', 'is-warning', 'is-error');
        if (!latestImport) {
            status.textContent = 'Geen import';
            status.classList.add('is-warning');
            byId('hp-source-date').textContent = 'Nog geen HealthPlanner-bron';
            byId('hp-source-meta').textContent = 'Gebruik eerst de gevalideerde importtemplate.';
        } else {
            status.textContent = Number(latestImport.warningCount) ? 'Import met waarschuwingen' : 'Bron beschikbaar';
            status.classList.add(Number(latestImport.warningCount) ? 'is-warning' : 'is-success');
            byId('hp-source-date').textContent = formatDate(payload.summary.latestReportDate);
            byId('hp-source-meta').textContent = `${latestImport.sourceFile} · ${formatDateTime(latestImport.importedAt)}`;
        }
        byId('hp-source-list').innerHTML = `
            <div><dt>Laatste bronbestand</dt><dd>${escapeHtml(latestImport?.sourceFile || 'Geen import')}</dd></div>
            <div><dt>Geïmporteerd</dt><dd>${escapeHtml(formatDateTime(latestImport?.importedAt))}</dd></div>
            <div><dt>Bronregels</dt><dd>${escapeHtml(latestImport ? String(latestImport.rowCount) : '0')}</dd></div>
            <div><dt>Waarschuwingen</dt><dd>${escapeHtml(latestImport ? String(latestImport.warningCount) : '0')}</dd></div>
            <div><dt>Toegang</dt><dd>${authState?.role === 'manager' ? `Alleen ${escapeHtml(authState.user?.location || 'gekoppelde vestiging')}` : 'Alle toegestane vestigingen'}</dd></div>
        `;
    }

    async function loadData() {
        byId('hp-refresh').disabled = true;
        try {
            const payload = await requestJson(`/api/insights/healthplanner?${queryString()}`);
            renderKpis(payload);
            renderLatest(payload);
            renderHistory(payload);
            renderSource(payload);
        } catch (error) {
            byId('hp-latest').innerHTML = `<p class="hp-state is-error">${escapeHtml(error.message)}</p>`;
            byId('hp-history').innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
            const status = byId('hp-source-status');
            status.textContent = 'Bronfout';
            status.className = 'hp-status is-error';
        } finally {
            byId('hp-refresh').disabled = false;
        }
    }

    async function initialize(event) {
        authState = event.detail;
        if (!['manager', 'admin'].includes(authState.role)) return;
        try {
            const registry = await requestJson('/api/insights/healthplanner/metrics');
            domainLabels = registry.domains || {};
            byId('hp-domain').innerHTML = '<option value="">Alle domeinen</option>' + DOMAIN_ORDER
                .filter((domain) => domainLabels[domain])
                .map((domain) => `<option value="${domain}">${escapeHtml(domainLabels[domain])}</option>`).join('');

            const locationSelect = byId('hp-location');
            const locations = authState.role === 'manager'
                ? [authState.user?.location].filter(Boolean)
                : ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp', 'Sport Society totaal'];
            locationSelect.innerHTML = authState.role === 'admin' ? '<option value="">Alle toegestane vestigingen</option>' : '';
            locationSelect.innerHTML += locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');
            if (authState.role === 'manager' && authState.user?.location) {
                locationSelect.value = authState.user.location;
                locationSelect.disabled = true;
            }
            await loadData();
        } catch (error) {
            byId('hp-latest').innerHTML = `<p class="hp-state is-error">${escapeHtml(error.message)}</p>`;
        }
    }

    byId('hp-filters')?.addEventListener('change', loadData);
    byId('hp-refresh')?.addEventListener('click', loadData);
    document.addEventListener('authready', initialize, { once: true });
})();
