(() => {
    const section = document.getElementById('employee-location-section');
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
        if (!message) return;
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
        if (!settings || !section || !form) return;
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
        if (submit) submit.disabled = true;
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
            if (submit) submit.disabled = false;
        }
    }

    primarySelect?.addEventListener('change', () => {
        ensurePrimaryIsEligible();
        setMessage('');
    });
    form?.addEventListener('submit', save);

    document.addEventListener('authready', (event) => {
        if (event.detail.authenticated && event.detail.role === 'admin') load();
    }, { once: true });
})();
