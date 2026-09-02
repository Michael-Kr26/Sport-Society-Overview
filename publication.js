(() => {
    const originalReplaceState = window.history.replaceState.bind(window.history);
    window.history.replaceState = (state, title, url) => {
        if (typeof url === 'string' && url.startsWith('roster.html?')) {
            url = `planner.html?${url.slice('roster.html?'.length)}`;
        }
        return originalReplaceState(state, title, url);
    };

    const elements = {
        open: document.getElementById('publish-roster'),
        backdrop: document.getElementById('publication-backdrop'),
        drawer: document.getElementById('publication-drawer'),
        close: document.getElementById('close-publication'),
        cancel: document.getElementById('cancel-publication'),
        refresh: document.getElementById('refresh-publication'),
        horizon: document.getElementById('publication-horizon'),
        candidates: document.getElementById('publication-candidates'),
        previewSection: document.getElementById('publication-preview-section'),
        preview: document.getElementById('publication-preview'),
        reasonField: document.getElementById('publication-reason-field'),
        reason: document.getElementById('publication-reason'),
        message: document.getElementById('publication-message'),
        prepare: document.getElementById('prepare-publication'),
        confirm: document.getElementById('confirm-publication'),
        plannerSuccess: document.getElementById('planner-success')
    };

    if (!elements.open || !elements.drawer) return;

    const state = {
        candidateData: null,
        preview: null,
        selectedIds: new Set(),
        loading: false
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function todayString() {
        const date = new Date();
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function dateObject(value) {
        return new Date(`${value}T12:00:00`);
    }

    function isoDate(date) {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function mondayOf(value) {
        const date = dateObject(value);
        const offset = (date.getDay() + 6) % 7;
        date.setDate(date.getDate() - offset);
        return isoDate(date);
    }

    function isoWeekNumber(value) {
        const date = new Date(`${value}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    }

    function formatDate(value) {
        return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(dateObject(value));
    }

    function referenceWeekStart() {
        return mondayOf(todayString());
    }

    function plannerWeekStart() {
        const query = new URLSearchParams(window.location.search);
        return mondayOf(query.get('focusDate') || todayString());
    }

    function plannerLocationCode() {
        return document.getElementById('planner-location')?.value || 'AVE';
    }

    function setMessage(message) {
        elements.message.hidden = !message;
        elements.message.textContent = message || '';
    }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        let payload = {};
        try { payload = await response.json(); } catch {}
        if (!response.ok) {
            const error = new Error(payload.message || 'Publicatie kon niet worden verwerkt.');
            error.code = payload.code || null;
            error.details = payload.details || null;
            throw error;
        }
        return payload;
    }

    function openDrawer() {
        elements.backdrop.hidden = false;
        elements.drawer.classList.add('is-open');
        elements.drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('drawer-open');
    }

    function closeDrawer() {
        elements.drawer.classList.remove('is-open');
        elements.drawer.setAttribute('aria-hidden', 'true');
        elements.backdrop.hidden = true;
        document.body.classList.remove('drawer-open');
        setMessage('');
    }

    function invalidatePreview() {
        state.preview = null;
        elements.previewSection.hidden = true;
        elements.preview.innerHTML = '';
        elements.reasonField.hidden = true;
        elements.confirm.hidden = true;
        setMessage('');
    }

    function renderHorizon(horizon) {
        if (!horizon?.locations?.length) {
            elements.horizon.innerHTML = '<p class="publication-empty">Nog geen horizoninformatie beschikbaar.</p>';
            return;
        }
        elements.horizon.innerHTML = horizon.locations.map((location) => {
            const statusText = location.status === 'target'
                ? 'Streef gehaald'
                : location.status === 'minimum'
                    ? 'Minimum gehaald'
                    : `${location.missingToMinimum} week/weken tekort`;
            return `
                <article class="publication-horizon-item is-${escapeHtml(location.status)}">
                    <strong>${escapeHtml(location.code)}</strong>
                    <b>${location.futurePublishedWeeks} wk</b>
                    <span>${escapeHtml(statusText)}</span>
                </article>
            `;
        }).join('');
    }

    function candidateMeta(item) {
        const parts = [];
        if (!item.valid) parts.push(`<span class="is-invalid">${item.errorCount} blokkade(s)</span>`);
        else parts.push('<span class="is-valid">Publiceerbaar</span>');
        if (item.warningCount) parts.push(`<span class="is-warning">${item.warningCount} waarschuwing(en)</span>`);
        return parts.join('');
    }

    function renderCandidates(data) {
        const items = data?.items || [];
        if (!items.length) {
            elements.candidates.innerHTML = '<div class="publication-empty">Geen open concepten binnen de 24-wekenhorizon.</div>';
            elements.prepare.disabled = true;
            return;
        }
        elements.prepare.disabled = false;
        elements.candidates.innerHTML = items.map((item) => `
            <label class="publication-candidate">
                <input type="checkbox" value="${item.versionId}" ${state.selectedIds.has(item.versionId) ? 'checked' : ''}>
                <span class="publication-candidate-main">
                    <strong>Week ${isoWeekNumber(item.weekStart)} · ${escapeHtml(item.locationName)}</strong>
                    <span>${formatDate(item.weekStart)} · v${item.versionNo} · ${item.changeCount} wijziging(en)${item.reasonRequired ? ' · herpublicatie' : ''}</span>
                </span>
                <span class="publication-candidate-meta">${candidateMeta(item)}</span>
            </label>
        `).join('');
        elements.candidates.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const id = Number(checkbox.value);
                if (checkbox.checked) state.selectedIds.add(id);
                else state.selectedIds.delete(id);
                invalidatePreview();
            });
        });
    }

    async function currentDraftId() {
        try {
            const params = new URLSearchParams({
                location: plannerLocationCode(),
                weekStart: plannerWeekStart(),
                view: 'draft'
            });
            const context = await request(`/api/roster-planner/context?${params.toString()}`);
            return context.views?.draftVersionId || null;
        } catch {
            return null;
        }
    }

    async function loadCandidates() {
        if (state.loading) return;
        state.loading = true;
        setMessage('');
        elements.candidates.innerHTML = '<p class="empty-state">Concepten laden...</p>';
        elements.horizon.innerHTML = '<p class="empty-state">Horizon laden...</p>';
        invalidatePreview();
        try {
            const activeDraft = await currentDraftId();
            const params = new URLSearchParams({
                fromWeekStart: referenceWeekStart(),
                weeks: '24'
            });
            const data = await request(`/api/roster-publication/candidates?${params.toString()}`);
            state.candidateData = data;
            const availableIds = new Set(data.items.map((item) => item.versionId));
            state.selectedIds = new Set([...state.selectedIds].filter((id) => availableIds.has(id)));
            if (activeDraft && availableIds.has(activeDraft)) state.selectedIds.add(activeDraft);
            renderHorizon(data.horizon);
            renderCandidates(data);
        } catch (error) {
            console.error(error);
            setMessage(error.message);
            elements.candidates.innerHTML = '<div class="publication-empty">Concepten konden niet worden geladen.</div>';
        } finally {
            state.loading = false;
        }
    }

    function shiftLabel(shift) {
        if (!shift) return '-';
        const employee = shift.employeeName || 'Open dienst';
        return `${employee} · ${shift.date} ${shift.startTime}–${shift.endTime}`;
    }

    function diffLabel(change) {
        if (change.changeType === 'added') return shiftLabel(change.after);
        if (change.changeType === 'removed') return shiftLabel(change.before);
        return `${shiftLabel(change.before)} → ${shiftLabel(change.after)}`;
    }

    function renderPreview(preview) {
        const totals = preview.totals;
        elements.previewSection.hidden = false;
        elements.reasonField.hidden = !preview.reasonRequired;
        elements.confirm.hidden = !preview.canPublish;
        elements.preview.innerHTML = `
            <div class="publication-preview-summary">
                <div class="publication-preview-metric"><strong>${totals.versions}</strong><span>Concepten</span></div>
                <div class="publication-preview-metric"><strong>${totals.changes}</strong><span>Wijzigingen</span></div>
                <div class="publication-preview-metric"><strong>${totals.warnings}</strong><span>Waarschuwingen</span></div>
                <div class="publication-preview-metric"><strong>${totals.errors}</strong><span>Blokkades</span></div>
            </div>
            ${preview.items.map((item) => `
                <article class="publication-preview-item">
                    <div class="publication-preview-item-head">
                        <strong>Week ${isoWeekNumber(item.version.weekStart)} · ${escapeHtml(item.version.locationName)}</strong>
                        <span>${item.diffCounts.added} + · ${item.diffCounts.modified} ~ · ${item.diffCounts.removed} −</span>
                    </div>
                    <div class="publication-diff-list">
                        ${item.changes.length ? item.changes.map((change) => `
                            <div class="publication-diff-row">
                                <b>${escapeHtml(change.changeType)}</b>
                                <span>${escapeHtml(diffLabel(change))}</span>
                            </div>
                        `).join('') : '<div class="publication-diff-row"><b>Geen</b><span>Geen inhoudelijke wijziging ten opzichte van de basisversie.</span></div>'}
                    </div>
                </article>
            `).join('')}
        `;
        renderHorizon(preview.horizonAfter);
        if (!preview.canPublish) {
            setMessage('Publicatie is geblokkeerd. Los eerst de blokkerende roosterconflicten op.');
        }
    }

    async function preparePublication() {
        const versionIds = [...state.selectedIds];
        if (!versionIds.length) {
            setMessage('Selecteer minimaal één concept om te publiceren.');
            return;
        }
        elements.prepare.disabled = true;
        elements.confirm.hidden = true;
        setMessage('');
        try {
            const preview = await request('/api/roster-publication/prepare', {
                method: 'POST',
                body: JSON.stringify({ versionIds, referenceWeekStart: referenceWeekStart() })
            });
            state.preview = preview;
            renderPreview(preview);
        } catch (error) {
            console.error(error);
            setMessage(error.message);
        } finally {
            elements.prepare.disabled = false;
        }
    }

    async function confirmPublication() {
        if (!state.preview?.canPublish) return;
        const reason = elements.reason.value.trim();
        if (state.preview.reasonRequired && !reason) {
            setMessage('Vul de reden van deze herpublicatie in.');
            elements.reason.focus();
            return;
        }
        elements.confirm.disabled = true;
        elements.prepare.disabled = true;
        setMessage('');
        try {
            const result = await request('/api/roster-publication/publish', {
                method: 'POST',
                body: JSON.stringify({
                    versionIds: [...state.selectedIds],
                    reason: reason || null,
                    referenceWeekStart: referenceWeekStart()
                })
            });
            const sideEffectWarning = result.sideEffects?.status === 'failed'
                ? ' Publicatie is gelukt, maar CML/notificatieverwerking vraagt controle.'
                : '';
            sessionStorage.setItem('sso_publication_success', `${result.versions.length} roosterweek/-weken gepubliceerd.${sideEffectWarning}`);
            window.location.reload();
        } catch (error) {
            console.error(error);
            setMessage(error.message);
            elements.confirm.disabled = false;
            elements.prepare.disabled = false;
        }
    }

    function showStoredSuccess() {
        const message = sessionStorage.getItem('sso_publication_success');
        if (!message || !elements.plannerSuccess) return;
        sessionStorage.removeItem('sso_publication_success');
        elements.plannerSuccess.textContent = message;
        elements.plannerSuccess.hidden = false;
    }

    elements.open.addEventListener('click', () => {
        openDrawer();
        loadCandidates();
    });
    elements.close.addEventListener('click', closeDrawer);
    elements.cancel.addEventListener('click', closeDrawer);
    elements.backdrop.addEventListener('click', closeDrawer);
    elements.refresh.addEventListener('click', loadCandidates);
    elements.prepare.addEventListener('click', preparePublication);
    elements.confirm.addEventListener('click', confirmPublication);
    elements.reason.addEventListener('input', () => setMessage(''));

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && elements.drawer.classList.contains('is-open')) closeDrawer();
    });

    document.addEventListener('authready', (event) => {
        const authState = event.detail || window.currentAuthState || {};
        elements.open.hidden = authState.role !== 'admin';
        if (authState.role === 'admin') showStoredSuccess();
    });
})();
