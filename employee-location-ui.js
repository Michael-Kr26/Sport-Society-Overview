(() => {
    function ensureStylesheet() {
        if (document.querySelector('link[href^="employee-locations.css"]')) return;
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = 'employee-locations.css?v=20260903-employee-locations';
        document.head.appendChild(stylesheet);
    }

    function ensureUi() {
        let section = document.getElementById('employee-location-section');
        if (section) return section;
        const anchor = document.getElementById('employee-settings-section');
        if (!anchor) return null;

        section = document.createElement('section');
        section.className = 'sso-section';
        section.id = 'employee-location-section';
        section.hidden = true;
        section.innerHTML = `
            <div class="sso-section-header">
                <div>
                    <h2 class="sso-section-title">Locaties</h2>
                    <p class="sso-section-copy">Beheer de primaire vestiging en de locaties waarop deze medewerker in de Planner inzetbaar is.</p>
                </div>
            </div>
            <form id="employee-location-form" class="employee-location-form">
                <label class="sso-field">Primaire locatie
                    <select class="sso-input" id="employee-primary-location" name="primaryLocationCode" required></select>
                </label>
                <div class="employee-location-options-wrap">
                    <div class="employee-location-options-label">Inzetbaar op</div>
                    <div class="employee-location-options" id="employee-location-options"></div>
                    <p class="employee-location-copy" id="employee-location-effective-copy">Wijzigingen gelden vanaf vandaag.</p>
                </div>
                <div class="employee-location-actions">
                    <button type="submit" class="sso-button sso-button--primary">Locaties opslaan</button>
                    <p id="employee-location-message" class="employee-location-message" aria-live="polite"></p>
                </div>
            </form>`;
        anchor.insertAdjacentElement('afterend', section);
        return section;
    }

    ensureStylesheet();
    const section = ensureUi();
    if (!section) return;

    const form = document.getElementById('employee-location-form');
    const primarySelect = document.getElementById('employee-primary-location');
    const options = document.getElementById('employee-location-options');
    const message = document.getElementById('employee-location-message');
    const effectiveCopy = document.getElementById('employee-location-effective-copy');
    const summaryLocations = document.getElementById('employee-profile-locations');

    let settings = null;

    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    function employeeIdFromUrl() {
        const value = Number(new URLSearchParams(window.location.search).get('id'));
        return Number.isInteger(value) && value > 0 ? value : null;
    }

    async function requestJson(url, requestOptions = {}) {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) },
            ...requestOptions
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.message || 'De aanvraag is mislukt.');
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function setMessage(text, type = '') {
        message.textContent = text;
        message.className = `employee-location-message${type ? ` is-${type}` : ''}`;
    }

    function selectedEligibleCodes() {
        return [...options.querySelectorAll('input[name="eligibleLocationCodes"]:checked')]
            .map((input) => input.value);
    }

    function ensurePrimaryIsEligible() {
        const selected = primarySelect.value;
        const checkbox = options.querySelector(`input[value="${CSS.escape(selected)}"]`);
        if (checkbox) checkbox.checked = true;
    }

    function updateSummary() {
        if (!settings || !summaryLocations) return;
        const namesByCode = new Map(settings.locations.map((location) => [location.code, location.name]));
        const names = settings.eligibleLocationCodes
            .map((code) => namesByCode.get(code))
            .filter(Boolean);
        summaryLocations.textContent = names.length ? names.join(' · ') : 'Geen inzetbare locaties';
    }

    function render() {
        if (!settings) return;
        const eligible = new Set(settings.eligibleLocationCodes || []);
        primarySelect.innerHTML = settings.locations.map((location) =>
            `<option value="${escapeHtml(location.code)}">${escapeHtml(location.name)}</option>`).join('');
        primarySelect.value = settings.primaryLocationCode || settings.locations[0]?.code || '';

        options.innerHTML = settings.locations.map((location) => `
            <label class="sso-checkbox employee-location-choice">
                <input type="checkbox" name="eligibleLocationCodes" value="${escapeHtml(location.code)}" ${eligible.has(location.code) ? 'checked' : ''}>
                <span>${escapeHtml(location.name)}</span>
            </label>`).join('');

        ensurePrimaryIsEligible();
        options.querySelectorAll('input[name="eligibleLocationCodes"]').forEach((input) => {
            input.addEventListener('change', () => {
                if (input.value === primarySelect.value && !input.checked) {
                    input.checked = true;
                    setMessage('De primaire locatie moet ook inzetbaar blijven.', 'warning');
                }
            });
        });
        effectiveCopy.textContent = `Wijzigingen gelden vanaf ${new Intl.DateTimeFormat('nl-NL', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        }).format(new Date(`${settings.effectiveDate}T12:00:00`))}.`;
        section.hidden = false;
        updateSummary();
    }

    async function load() {
        const employeeId = employeeIdFromUrl();
        if (!employeeId) return;
        try {
            settings = await requestJson(`/api/employee-locations/${employeeId}`);
            render();
        } catch (error) {
            if (error.status === 404) return;
            setMessage(error.message, 'error');
            section.hidden = false;
        }
    }

    async function save(event) {
        event.preventDefault();
        const employeeId = employeeIdFromUrl();
        if (!employeeId) return;
        ensurePrimaryIsEligible();
        const eligibleLocationCodes = selectedEligibleCodes();
        if (!eligibleLocationCodes.length) {
            setMessage('Kies minimaal één inzetbare locatie.', 'error');
            return;
        }

        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        setMessage('Locaties opslaan...');
        try {
            settings = await requestJson(`/api/employee-locations/${employeeId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    primaryLocationCode: primarySelect.value,
                    eligibleLocationCodes
                })
            });
            render();
            setMessage('Locaties opgeslagen.', 'success');
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            submit.disabled = false;
        }
    }

    primarySelect.addEventListener('change', () => {
        ensurePrimaryIsEligible();
        setMessage('');
    });
    form.addEventListener('submit', save);

    const authState = window.currentAuthState;
    if (authState?.authenticated && authState.role === 'admin') {
        load();
    } else {
        document.addEventListener('authready', (event) => {
            if (event.detail.authenticated && event.detail.role === 'admin') load();
        }, { once: true });
    }
})();
