(() => {
    const list = document.getElementById('employee-list');
    const message = document.getElementById('employee-message');
    const statusByEmployee = new Map();
    let observer = null;
    let decorateScheduled = false;

    const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

    function formatDate(value) {
        if (!value) return '';
        return new Intl.DateTimeFormat('nl-NL', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        }).format(new Date(`${value}T00:00:00`));
    }

    function setMessage(text, type = '') {
        if (!message) return;
        message.textContent = text;
        message.className = `employee-message${type ? ` is-${type}` : ''}`;
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'De aanvraag is mislukt.');
        return payload;
    }

    function statusFor(name) {
        return statusByEmployee.get(employeeKey(name)) || null;
    }

    function setTextIfChanged(element, text) {
        if (element && element.textContent !== text) element.textContent = text;
    }

    function decorateCard(card) {
        const form = card.querySelector('[data-profile-form]');
        const name = form?.dataset.employeeName;
        if (!form || !name) return;
        const status = statusFor(name);

        let field = form.querySelector('[data-employment-end-field]');
        if (!field) {
            field = document.createElement('label');
            field.dataset.employmentEndField = '';
            field.className = 'employee-end-date';
            field.innerHTML = 'Laatste werkdag<input type="date" data-employment-end-input>';
            const activeField = form.querySelector('.employee-active');
            form.insertBefore(field, activeField || form.querySelector('button'));

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'employee-action-button';
            button.dataset.saveEmploymentEnd = '';
            button.textContent = 'Laatste werkdag opslaan';
            button.addEventListener('click', () => saveEmploymentEnd(name, form));
            field.insertAdjacentElement('afterend', button);
        }

        const input = field.querySelector('[data-employment-end-input]');
        const nextValue = status?.activeUntil || '';
        if (input && document.activeElement !== input && input.value !== nextValue) input.value = nextValue;

        const title = card.querySelector('.employee-item-title');
        let badge = title?.querySelector('[data-employment-end-badge]');
        if (status?.activeUntil) {
            if (!badge) {
                badge = document.createElement('span');
                badge.dataset.employmentEndBadge = '';
                badge.className = 'employee-badge is-inactive';
                title?.appendChild(badge);
            }
            setTextIfChanged(badge, `Laatste werkdag ${formatDate(status.activeUntil)}`);
        } else {
            badge?.remove();
        }

        const meta = card.querySelector('.employee-meta');
        if (meta) {
            const existing = meta.querySelector('[data-employment-end-meta]');
            if (status?.activeUntil) {
                const suffix = existing || document.createElement('span');
                suffix.dataset.employmentEndMeta = '';
                setTextIfChanged(suffix, ` · zichtbaar t/m maandpagina ${status.activeUntil.slice(0, 7)}`);
                if (!existing) meta.appendChild(suffix);
            } else {
                existing?.remove();
            }
        }
    }

    function decorateAllCards() {
        list?.querySelectorAll('[data-employee-card]').forEach(decorateCard);
    }

    function scheduleDecoration() {
        if (decorateScheduled) return;
        decorateScheduled = true;
        window.requestAnimationFrame(() => {
            decorateScheduled = false;
            decorateAllCards();
        });
    }

    async function loadStatuses() {
        try {
            const payload = await requestJson('/api/hours/employment-status');
            statusByEmployee.clear();
            for (const employee of payload.employees || []) {
                statusByEmployee.set(employeeKey(employee.employeeName), employee);
            }
            scheduleDecoration();
        } catch (error) {
            console.error(error);
            setMessage(error.message, 'error');
        }
    }

    async function saveEmploymentEnd(name, form) {
        const input = form.querySelector('[data-employment-end-input]');
        const activeUntil = input?.value || '';
        try {
            const payload = await requestJson(`/api/hours/employment-status/${encodeURIComponent(name)}`, {
                method: 'PUT',
                body: JSON.stringify({ activeUntil })
            });
            const current = statusFor(name) || { employeeName: name };
            statusByEmployee.set(employeeKey(name), { ...current, activeUntil: activeUntil || null });
            decorateCard(form.closest('[data-employee-card]'));
            setMessage(payload.message, 'success');
        } catch (error) {
            setMessage(error.message, 'error');
        }
    }

    function startObserver() {
        if (!list || observer) return;
        observer = new MutationObserver(scheduleDecoration);
        // Alleen het vervangen/toevoegen van medewerkerkaarten volgen.
        // Wijzigingen binnen een kaart worden bewust genegeerd om een renderlus te voorkomen.
        observer.observe(list, { childList: true });
    }

    document.addEventListener('authready', (event) => {
        if (event.detail.role !== 'admin') return;
        startObserver();
        loadStatuses();
    }, { once: true });
})();
