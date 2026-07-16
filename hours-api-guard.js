async function requestJson(url, options = {}) {
    let response;

    try {
        response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
    } catch (error) {
        const networkError = new Error(
            'De server is niet bereikbaar. Start de applicatie met npm start en open http://localhost:3000/hours.html.'
        );
        networkError.status = 0;
        throw networkError;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : {};

    if (!response.ok) {
        let fallbackMessage = 'De aanvraag is mislukt.';

        if (response.status === 404 && String(url).startsWith('/api/hours/')) {
            fallbackMessage = [
                'De uren-API is niet actief.',
                'Stop de huidige server, start opnieuw met npm start en open de pagina via http://localhost:3000/hours.html.'
            ].join(' ');
        }

        const error = new Error(payload.message || fallbackMessage);
        error.status = response.status;
        throw error;
    }

    return payload;
}

function ensureEmployeeRemovalStyles() {
    if (document.getElementById('employee-removal-styles')) return;

    const style = document.createElement('style');
    style.id = 'employee-removal-styles';
    style.textContent = `
        .employee-setting-actions {
            display: grid;
            gap: 7px;
            align-self: end;
        }

        .employee-setting-actions .hours-delete-button {
            min-height: 42px;
        }

        .removed-employees-panel {
            margin-top: 10px;
            padding: 14px;
            border: 1px solid rgba(255, 255, 255, .08);
            border-radius: 12px;
            background: rgba(255, 255, 255, .025);
        }

        .removed-employees-panel > summary {
            color: #b7c0c9;
            cursor: pointer;
            font-weight: 800;
        }

        .removed-employees-list {
            display: grid;
            gap: 9px;
            margin-top: 12px;
        }

        .employee-setting-row.employee-setting-row-removed {
            grid-template-columns: minmax(220px, 1fr) auto;
            opacity: .82;
        }

        @media (max-width: 768px) {
            .employee-setting-row.employee-setting-row-removed {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

function getEmployeeForRemoval(employeeName) {
    return employeeData.find((employee) => employee.employeeName === employeeName) || null;
}

function buildEmployeeActivePayload(employee, isActive) {
    const latestPeriod = [...(employee.contractPeriods || [])]
        .sort((a, b) => String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || '')))[0];

    return {
        contractType: employee.contractType,
        weeklyContractHours: Number(employee.weeklyContractHours || 0),
        effectiveFrom: latestPeriod?.effectiveFrom || monthFirstDay(analysis.month),
        openingBankHours: Number(employee.openingBankHours || 0),
        openingBankMonth: employee.openingBankMonth || analysis.month,
        isActive
    };
}

async function changeEmployeeActiveState(employeeName, isActive) {
    const employee = getEmployeeForRemoval(employeeName);
    if (!employee) {
        setMessage('Medewerker kon niet worden gevonden.', 'error');
        return;
    }

    try {
        await requestJson(`/api/hours/employees/${encodeURIComponent(employeeName)}`, {
            method: 'PUT',
            body: JSON.stringify(buildEmployeeActivePayload(employee, isActive))
        });
        setMessage(
            isActive
                ? `${employeeName} is hersteld in de urenbank.`
                : `${employeeName} is verwijderd uit de actieve urenbank.`,
            'success'
        );
        await refreshAll();
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

async function removeEmployeeFromHours(event) {
    const employeeName = event.currentTarget.dataset.removeEmployee;
    const confirmed = window.confirm(
        `${employeeName} verwijderen uit de actieve urenbank? Historische uren, contractperiodes en correcties blijven bewaard.`
    );
    if (!confirmed) return;

    await changeEmployeeActiveState(employeeName, false);
}

async function restoreEmployeeToHours(event) {
    await changeEmployeeActiveState(event.currentTarget.dataset.restoreEmployee, true);
}

function renderActiveEmployeeSetting(employee) {
    const currentHours = Number(employee.weeklyContractHours || 0);
    return `
        <form class="employee-setting-row" data-employee-form data-employee-name="${escapeHtml(employee.employeeName)}">
            <div class="employee-setting-name">
                <strong>${escapeHtml(employee.employeeName)}</strong>
                <span>${escapeHtml(renderPeriodSummary(employee.contractPeriods || []))}</span>
            </div>
            <label>Type
                <select name="contractType">
                    <option value="flex" ${employee.contractType === 'flex' ? 'selected' : ''}>Flex</option>
                    <option value="contract" ${employee.contractType === 'contract' ? 'selected' : ''}>Contract</option>
                </select>
            </label>
            <label>Uren/week
                <input name="weeklyContractHours" type="number" min="0" max="60" step="0.25" value="${currentHours}">
            </label>
            <label>Ingangsdatum
                <input name="effectiveFrom" type="date" value="${monthFirstDay(analysis.month)}">
            </label>
            <label>Startstand bank
                <input name="openingBankHours" type="number" min="-1000" max="1000" step="0.25" value="${Number(employee.openingBankHours || 0)}">
            </label>
            <label>Startmaand bank
                <input name="openingBankMonth" type="month" value="${escapeHtml(employee.openingBankMonth || analysis.month)}">
            </label>
            <label class="employee-active"><input name="isActive" type="checkbox" checked> Actief</label>
            <div class="employee-setting-actions">
                <button type="submit" class="hours-small-button">Opslaan</button>
                <button type="button" class="hours-delete-button" data-remove-employee="${escapeHtml(employee.employeeName)}">Verwijderen</button>
            </div>
        </form>
    `;
}

function renderRemovedEmployeeSetting(employee) {
    return `
        <article class="employee-setting-row employee-setting-row-removed">
            <div class="employee-setting-name">
                <strong>${escapeHtml(employee.employeeName)}</strong>
                <span>Niet actief in de urenbank; historische gegevens zijn bewaard.</span>
            </div>
            <button type="button" class="hours-small-button" data-restore-employee="${escapeHtml(employee.employeeName)}">Herstellen</button>
        </article>
    `;
}

renderEmployeeSettings = function renderEmployeeSettingsWithRemoval() {
    if (!canEdit) return;

    ensureEmployeeRemovalStyles();

    const activeEmployees = employeeData
        .filter((employee) => Boolean(employee.isActive))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'));
    const removedEmployees = employeeData
        .filter((employee) => !employee.isActive)
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'nl'));

    employeeSettings.innerHTML = `
        ${activeEmployees.length
            ? activeEmployees.map(renderActiveEmployeeSetting).join('')
            : '<p class="empty-state">Geen actieve medewerkers ingesteld.</p>'}
        ${removedEmployees.length ? `
            <details class="removed-employees-panel">
                <summary>Verwijderde medewerkers (${removedEmployees.length})</summary>
                <div class="removed-employees-list">
                    ${removedEmployees.map(renderRemovedEmployeeSetting).join('')}
                </div>
            </details>
        ` : ''}
    `;

    employeeSettings.querySelectorAll('[data-employee-form]').forEach((form) => {
        form.addEventListener('submit', saveEmployeeSettings);
    });
    employeeSettings.querySelectorAll('[data-remove-employee]').forEach((button) => {
        button.addEventListener('click', removeEmployeeFromHours);
    });
    employeeSettings.querySelectorAll('[data-restore-employee]').forEach((button) => {
        button.addEventListener('click', restoreEmployeeToHours);
    });
};
