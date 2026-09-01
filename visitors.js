(() => {
    const byId = (id) => document.getElementById(id);
    const locations = ['Achterveld', 'Barneveld', 'Harskamp', 'Voorthuizen', 'Wekerom'];
    let authState = null;
    let currentRows = [];
    let chartRows = [];
    let resizeTimer = null;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    function formatNumber(value, maximumFractionDigits = 0) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
        return new Intl.NumberFormat('nl-NL', { maximumFractionDigits }).format(Number(value));
    }

    function formatMonth(value) {
        if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return String(value || '-');
        return new Intl.DateTimeFormat('nl-NL', { month: 'short', year: 'numeric' })
            .format(new Date(`${value}-01T12:00:00`));
    }

    function frequency(row) {
        if (Number.isFinite(row.visitFrequency)) return Number(row.visitFrequency);
        if (Number.isFinite(row.calculatedFrequency)) return Number(row.calculatedFrequency);
        if (Number.isFinite(row.totalVisits) && Number(row.activeMembers) > 0) {
            return Math.round((Number(row.totalVisits) / Number(row.activeMembers)) * 100) / 100;
        }
        return null;
    }

    async function requestJson(url) {
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.message || 'Bezoekersgegevens konden niet worden geladen.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function monthlySeries(rows) {
        const groups = new Map();
        for (const row of rows) {
            if (!groups.has(row.periodMonth)) groups.set(row.periodMonth, []);
            groups.get(row.periodMonth).push(row);
        }
        return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([periodMonth, monthRows]) => {
            const totalRow = monthRows.find((row) => row.location === 'Sport Society totaal');
            if (totalRow) {
                return {
                    periodMonth,
                    totalVisits: Number.isFinite(totalRow.totalVisits) ? totalRow.totalVisits : null,
                    activeMembers: Number.isFinite(totalRow.activeMembers) ? totalRow.activeMembers : null,
                    visitFrequency: frequency(totalRow),
                    source: 'Sport Society totaal'
                };
            }

            const locationRows = monthRows.filter((row) => locations.includes(row.location));
            const visits = locationRows.map((row) => row.totalVisits).filter(Number.isFinite);
            const members = locationRows.map((row) => row.activeMembers).filter(Number.isFinite);
            const totalVisits = visits.length ? visits.reduce((sum, value) => sum + value, 0) : null;
            const activeMembers = members.length === locationRows.length && members.length
                ? members.reduce((sum, value) => sum + value, 0)
                : null;
            const values = locationRows.map(frequency).filter(Number.isFinite);
            return {
                periodMonth,
                totalVisits,
                activeMembers,
                visitFrequency: totalVisits !== null && activeMembers > 0
                    ? Math.round((totalVisits / activeMembers) * 100) / 100
                    : values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null,
                source: `${locationRows.length} vestiging(en)`
            };
        });
    }

    function renderKpis(series) {
        const totalVisitsValues = series.map((row) => row.totalVisits).filter(Number.isFinite);
        const totalVisits = totalVisitsValues.length ? totalVisitsValues.reduce((sum, value) => sum + value, 0) : null;
        const frequencies = series.map((row) => row.visitFrequency).filter(Number.isFinite);
        const averageFrequency = frequencies.length
            ? frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length
            : null;
        const peak = [...series].filter((row) => Number.isFinite(row.totalVisits ?? row.visitFrequency))
            .sort((a, b) => Number(b.totalVisits ?? b.visitFrequency) - Number(a.totalVisits ?? a.visitFrequency))[0] || null;

        const items = [
            { label: 'Datadekking', value: `${series.length} maand(en)`, note: series.length ? `${formatMonth(series[0].periodMonth)} t/m ${formatMonth(series.at(-1).periodMonth)}` : 'Geen historie beschikbaar.' },
            { label: 'Totaal bezoeken', value: formatNumber(totalVisits), note: 'Som van maandtotalen; totaalregels hebben voorrang op vestigingssom.' },
            { label: 'Gemiddelde frequentie', value: averageFrequency === null ? '-' : formatNumber(averageFrequency, 2), note: 'Gemiddelde van de beschikbare maandfrequenties.' },
            { label: 'Piekmaand', value: peak ? formatMonth(peak.periodMonth) : '-', note: peak ? `${formatNumber(peak.totalVisits ?? peak.visitFrequency, peak.totalVisits === null ? 2 : 0)} volgens ${peak.source}.` : 'Nog geen piek te bepalen.' }
        ];
        byId('visitors-kpis').innerHTML = items.map((item) => `
            <article class="visitors-kpi"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.note)}</p></article>
        `).join('');
    }

    function renderPeaks(series) {
        const hasVisits = series.some((row) => Number.isFinite(row.totalVisits));
        const sorted = [...series]
            .filter((row) => Number.isFinite(hasVisits ? row.totalVisits : row.visitFrequency))
            .sort((a, b) => Number(hasVisits ? b.totalVisits : b.visitFrequency) - Number(hasVisits ? a.totalVisits : a.visitFrequency))
            .slice(0, 5);
        byId('visitors-peaks').innerHTML = sorted.length ? sorted.map((row, index) => `
            <article class="visitors-peak">
                <strong>${index + 1}. ${escapeHtml(formatMonth(row.periodMonth))}</strong>
                <span>${escapeHtml(formatNumber(hasVisits ? row.totalVisits : row.visitFrequency, hasVisits ? 0 : 2))}</span>
                <small>${escapeHtml(row.source)} · ${hasVisits ? 'bezoeken' : 'frequentie'}</small>
            </article>
        `).join('') : '<p class="visitors-empty">Nog onvoldoende numerieke maandgegevens.</p>';
    }

    function renderTable(rows) {
        const body = byId('visitors-table-body');
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="6">Geen gegevens binnen deze selectie.</td></tr>';
            return;
        }
        body.innerHTML = [...rows].sort((a, b) => b.periodMonth.localeCompare(a.periodMonth) || a.location.localeCompare(b.location, 'nl')).map((row) => `
            <tr>
                <td>${escapeHtml(formatMonth(row.periodMonth))}</td>
                <td>${escapeHtml(row.location)}</td>
                <td>${escapeHtml(formatNumber(row.totalVisits))}</td>
                <td>${escapeHtml(formatNumber(row.activeMembers))}</td>
                <td>${escapeHtml(formatNumber(frequency(row), 2))}</td>
                <td>${escapeHtml(row.sourceFile || '-')}</td>
            </tr>
        `).join('');
    }

    function drawChart(series) {
        chartRows = series;
        const canvas = byId('visitors-chart');
        const wrapper = canvas?.parentElement;
        if (!canvas || !wrapper) return;
        const width = Math.max(320, Math.floor(wrapper.clientWidth));
        const height = wrapper.clientHeight || 360;
        const scale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(width * scale);
        canvas.height = Math.floor(height * scale);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const context = canvas.getContext('2d');
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.clearRect(0, 0, width, height);

        const hasVisits = series.some((row) => Number.isFinite(row.totalVisits));
        const points = series.map((row) => ({
            label: formatMonth(row.periodMonth),
            value: hasVisits ? row.totalVisits : row.visitFrequency
        })).filter((point) => Number.isFinite(point.value));
        byId('visitors-chart-unit').textContent = hasVisits ? 'Bezoeken' : 'Frequentie';

        if (!points.length) {
            context.fillStyle = '#aeb7c0';
            context.font = '14px sans-serif';
            context.fillText('Geen numerieke trendgegevens beschikbaar.', 20, 35);
            return;
        }

        const padding = { left: 58, right: 20, top: 28, bottom: 58 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        const maxValue = Math.max(...points.map((point) => point.value), 1);
        const minValue = Math.min(...points.map((point) => point.value), 0);
        const range = Math.max(maxValue - minValue, 1);

        context.strokeStyle = 'rgba(255,255,255,.12)';
        context.fillStyle = '#9fa8af';
        context.font = '12px sans-serif';
        context.lineWidth = 1;
        for (let index = 0; index <= 4; index += 1) {
            const y = padding.top + (chartHeight * index / 4);
            const value = maxValue - (range * index / 4);
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.stroke();
            context.fillText(formatNumber(value, hasVisits ? 0 : 2), 4, y + 4);
        }

        const xFor = (index) => points.length === 1 ? padding.left + chartWidth / 2 : padding.left + (chartWidth * index / (points.length - 1));
        const yFor = (value) => padding.top + ((maxValue - value) / range) * chartHeight;
        context.strokeStyle = '#e6e6e6';
        context.lineWidth = 2.5;
        context.beginPath();
        points.forEach((point, index) => {
            const x = xFor(index);
            const y = yFor(point.value);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.stroke();

        context.fillStyle = '#ffffff';
        points.forEach((point, index) => {
            const x = xFor(index);
            const y = yFor(point.value);
            context.beginPath();
            context.arc(x, y, 4, 0, Math.PI * 2);
            context.fill();
            const shouldLabel = points.length <= 12 || index % Math.ceil(points.length / 12) === 0 || index === points.length - 1;
            if (shouldLabel) {
                context.save();
                context.translate(x, height - 18);
                context.rotate(-0.45);
                context.fillStyle = '#aeb7c0';
                context.font = '11px sans-serif';
                context.fillText(point.label, 0, 0);
                context.restore();
            }
        });
    }

    function setMessage(text, error = false) {
        const element = byId('visitors-message');
        element.textContent = text;
        element.classList.toggle('is-error', error);
    }

    async function loadData() {
        setMessage('Bezoekersgegevens laden...');
        const query = new URLSearchParams();
        if (byId('visitors-from').value) query.set('from', byId('visitors-from').value);
        if (byId('visitors-to').value) query.set('to', byId('visitors-to').value);
        if (authState.role === 'admin' && byId('visitors-location').value) query.set('location', byId('visitors-location').value);

        try {
            const payload = await requestJson(`/api/insights/visitor-frequency?${query}`);
            currentRows = payload.rows || [];
            const series = monthlySeries(currentRows);
            renderKpis(series);
            renderPeaks(series);
            renderTable(currentRows);
            drawChart(series);
            byId('visitors-source').textContent = currentRows[0]?.sourceFile || 'Nog geen bezoekersimport';
            byId('visitors-range').textContent = payload.summary?.firstMonth
                ? `${formatMonth(payload.summary.firstMonth)} t/m ${formatMonth(payload.summary.lastMonth)}`
                : 'Geen historische periode beschikbaar';
            setMessage(`${currentRows.length} bronregel(s) geladen.`);
        } catch (error) {
            currentRows = [];
            renderKpis([]);
            renderPeaks([]);
            renderTable([]);
            drawChart([]);
            setMessage(error.message, true);
        }
    }

    function initialize(state) {
        authState = state;
        if (!['manager', 'admin'].includes(state.role)) {
            window.location.replace(state.authenticated ? 'index.html' : 'login.html?next=visitors.html');
            return;
        }
        document.querySelector('[data-visitors-content]').hidden = false;
        byId('visitors-role').textContent = state.role;
        if (state.role === 'manager') {
            byId('visitors-location').value = state.user?.location || '';
            byId('visitors-location').disabled = true;
            byId('visitors-location-label').title = 'Managers zien uitsluitend hun gekoppelde vestiging.';
        }
        byId('visitors-filter-form').addEventListener('submit', (event) => {
            event.preventDefault();
            loadData();
        });
        loadData();
    }

    window.addEventListener('resize', () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => drawChart(chartRows), 120);
    });
    document.addEventListener('authready', (event) => initialize(event.detail), { once: true });
})();
