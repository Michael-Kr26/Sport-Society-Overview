(() => {
    'use strict';

    const exportButton = document.getElementById('confirm-publication-export');
    const publishButton = document.getElementById('confirm-publication');
    const prepareButton = document.getElementById('prepare-publication');
    const reasonField = document.getElementById('publication-reason-field');
    const reasonInput = document.getElementById('publication-reason');
    const message = document.getElementById('publication-message');
    const plannerSuccess = document.getElementById('planner-success');
    if (!exportButton || !publishButton) return;

    function referenceWeekStart() {
        const now = new Date();
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
        const offset = (date.getDay() + 6) % 7;
        date.setDate(date.getDate() - offset);
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function setMessage(value) {
        if (!message) return;
        message.hidden = !value;
        message.textContent = value || '';
    }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        let payload = {};
        try { payload = await response.json(); } catch {}
        if (!response.ok) {
            const error = new Error(payload.message || 'Actie kon niet worden verwerkt.');
            error.code = payload.code || null;
            error.details = payload.details || null;
            throw error;
        }
        return payload;
    }

    function selectedVersionIds() {
        return [...document.querySelectorAll('#publication-candidates input[type="checkbox"]:checked')]
            .map((input) => Number(input.value))
            .filter(Number.isInteger);
    }

    function syncVisibility() {
        exportButton.hidden = publishButton.hidden;
    }

    function exportSummary(payload) {
        const results = payload?.results || [];
        if (!results.length) return ' Excel kon niet worden bijgewerkt.';
        const uploaded = results.filter((item) => item.status === 'uploaded').length;
        const incomplete = results.filter((item) => item.status === 'skipped_incomplete').length;
        const failed = results.filter((item) => item.status === 'failed').length;
        if (failed) return ` Excel: ${uploaded} maand(en) bijgewerkt, ${failed} mislukt; controleer SharePoint.`;
        if (incomplete) return ` Excel: ${uploaded} maand(en) bijgewerkt; ${incomplete} maand(en) nog niet volledig gepubliceerd en daarom overgeslagen.`;
        return ` Excel: ${uploaded} maand(en) bijgewerkt in SharePoint.`;
    }

    async function publishAndExport() {
        const versionIds = selectedVersionIds();
        if (!versionIds.length) {
            setMessage('Selecteer minimaal één concept om te publiceren.');
            return;
        }
        const reason = String(reasonInput?.value || '').trim();
        if (reasonField && !reasonField.hidden && !reason) {
            setMessage('Vul de reden van deze herpublicatie in.');
            reasonInput?.focus();
            return;
        }

        exportButton.disabled = true;
        publishButton.disabled = true;
        if (prepareButton) prepareButton.disabled = true;
        setMessage('');
        try {
            const publication = await request('/api/roster-publication/publish', {
                method: 'POST',
                body: JSON.stringify({
                    versionIds,
                    reason: reason || null,
                    referenceWeekStart: referenceWeekStart()
                })
            });

            let excelText = '';
            try {
                const exportResult = await request('/api/roster-export/sharepoint/from-versions', {
                    method: 'POST',
                    body: JSON.stringify({ versionIds })
                });
                excelText = exportSummary(exportResult);
            } catch (exportError) {
                console.error(exportError);
                excelText = ` Rooster is gepubliceerd, maar Excel/SharePoint is niet bijgewerkt: ${exportError.message}`;
            }

            const sideEffectWarning = publication.sideEffects?.status === 'failed'
                ? ' CML/notificatieverwerking vraagt controle.'
                : '';
            const success = `${publication.versions.length} roosterweek/-weken gepubliceerd.${sideEffectWarning}${excelText}`;
            sessionStorage.setItem('sso_publication_success', success);
            if (plannerSuccess) {
                plannerSuccess.textContent = success;
                plannerSuccess.hidden = false;
            }
            window.location.reload();
        } catch (error) {
            console.error(error);
            setMessage(error.message);
            exportButton.disabled = false;
            publishButton.disabled = false;
            if (prepareButton) prepareButton.disabled = false;
        }
    }

    const observer = new MutationObserver(syncVisibility);
    observer.observe(publishButton, { attributes: true, attributeFilter: ['hidden'] });
    syncVisibility();
    exportButton.addEventListener('click', publishAndExport);
})();
