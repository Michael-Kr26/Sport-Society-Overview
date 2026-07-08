const currentUserRole = localStorage.getItem('demoRole') || 'employee';

const rolePermissions = {
    employee: {
        canViewCml: false,
        canUpdateChangeStatus: false,
        canDeleteChange: false
    },
    manager: {
        canViewCml: true,
        canUpdateChangeStatus: false,
        canDeleteChange: false
    },
    admin: {
        canViewCml: true,
        canUpdateChangeStatus: true,
        canDeleteChange: true
    }
};

const permissions = rolePermissions[currentUserRole] || rolePermissions.employee;

const allowedStatuses = ['Open', 'In behandeling', 'Afgerond'];

const searchForm = document.getElementById('cml-search-form');
const tableBody = document.getElementById('changes-table-body');

function userCanUpdateStatus() {
    return permissions.canUpdateChangeStatus;
}

function userCanDeleteChange() {
    return permissions.canDeleteChange;
}

function formatDate(dateString) {
    if (!dateString) {
        return '-';
    }

    const parts = dateString.split('-');

    if (parts.length !== 3) {
        return dateString;
    }

    const [year, month, day] = parts;

    return `${day}-${month}-${year}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getStatusClass(status) {
    if (status === 'Open') {
        return 'status-open';
    }

    if (status === 'In behandeling') {
        return 'status-progress';
    }

    if (status === 'Afgerond') {
        return 'status-done';
    }

    return '';
}

function getLocationClass(location) {
    if (location === 'Achterveld') {
        return 'location-achterveld';
    }

    if (location === 'Voorthuizen') {
        return 'location-voorthuizen';
    }

    if (location === 'Wekerom') {
        return 'location-wekerom';
    }

    if (location === 'Harskamp') {
        return 'location-harskamp';
    }

    if (location === 'Barneveld') {
        return 'location-barneveld';
    }

    return 'location-unknown';
}

function renderLocationCell(location) {
    const label = location || '-';

    return `
        <span class="cml-location-pill ${getLocationClass(location)}">
            ${escapeHtml(label)}
        </span>
    `;
}

function renderStatusCell(change) {
    const statusClass = getStatusClass(change.status);

    if (!userCanUpdateStatus()) {
        return `
            <span class="status-pill ${statusClass}">
                ${escapeHtml(change.status)}
            </span>
        `;
    }

    const statusOptions = allowedStatuses.map((status) => `
        <option value="${escapeHtml(status)}" ${status === change.status ? 'selected' : ''}>
            ${escapeHtml(status)}
        </option>
    `).join('');

    return `
        <select
            class="status-select ${statusClass}"
            data-change-id="${change.id}"
            data-previous-status="${escapeHtml(change.status)}"
            aria-label="Status aanpassen"
        >
            ${statusOptions}
        </select>
    `;
}

function renderActionCell(change) {
    const deleteButton = userCanDeleteChange() ? `
        <button
            type="button"
            class="delete-change-button"
            data-change-id="${change.id}"
            aria-label="Wijziging verwijderen"
            title="Wijziging verwijderen"
        >
            &#128465;
        </button>
    ` : '';

    return `
        <div class="cml-action-buttons">
            <button
                type="button"
                class="details-toggle-button"
                data-change-id="${change.id}"
                aria-expanded="false"
                aria-label="Beschrijving tonen"
                title="Beschrijving tonen"
            >
                i
            </button>
            ${deleteButton}
        </div>
    `;
}

function attachTableActionListeners() {
    const statusSelects = document.querySelectorAll('.status-select');
    const deleteButtons = document.querySelectorAll('.delete-change-button');
    const detailsButtons = document.querySelectorAll('.details-toggle-button');

    statusSelects.forEach((select) => {
        select.addEventListener('change', handleStatusChange);
    });

    deleteButtons.forEach((button) => {
        button.addEventListener('click', handleDeleteChange);
    });

    detailsButtons.forEach((button) => {
        button.addEventListener('click', handleDetailsToggle);
    });
}

function renderChanges(changes) {
    if (!tableBody) {
        return;
    }

    if (!changes || changes.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    Geen roosterwijzigingen gevonden.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = changes.map((change) => {
        const reason = change.reason ? escapeHtml(change.reason) : 'Geen beschrijving ingevuld.';

        return `
            <tr>
                <td>${formatDate(change.date)}</td>
                <td>${formatDate(change.reportedDate)}</td>
                <td>${renderLocationCell(change.location)}</td>
                <td>${escapeHtml(change.employee)}</td>
                <td>${change.employee2 ? escapeHtml(change.employee2) : '-'}</td>
                <td>${escapeHtml(change.type)}</td>
                <td>${renderStatusCell(change)}</td>
                <td>${escapeHtml(change.createdBy)}</td>
                <td class="cml-action-cell">${renderActionCell(change)}</td>
            </tr>
            <tr class="cml-details-row" data-details-row="${change.id}" hidden>
                <td colspan="9">
                    <div class="cml-details-content">
                        <strong>Beschrijving / reden</strong>
                        <p>${reason}</p>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    attachTableActionListeners();
}

function buildQueryString() {
    const params = new URLSearchParams();

    const name = document.getElementById('search-name').value.trim();
    const month = document.getElementById('search-month').value;
    const location = document.getElementById('search-location').value;
    const type = document.getElementById('search-type').value;
    const status = document.getElementById('search-status').value;

    if (name) {
        params.append('name', name);
    }

    if (month) {
        params.append('month', month);
    }

    if (location) {
        params.append('location', location);
    }

    if (type) {
        params.append('type', type);
    }

    if (status) {
        params.append('status', status);
    }

    return params.toString();
}

async function updateChangeStatus(changeId, status) {
    const response = await fetch(`/api/changes/${changeId}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Demo-Role': currentUserRole
        },
        body: JSON.stringify({ status })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({
            message: 'Status kon niet worden aangepast.'
        }));

        throw new Error(errorData.message || 'Status kon niet worden aangepast.');
    }

    return response.json();
}

async function deleteChange(changeId) {
    const response = await fetch(`/api/changes/${changeId}`, {
        method: 'DELETE',
        headers: {
            'X-Demo-Role': currentUserRole
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({
            message: 'Wijziging kon niet worden verwijderd.'
        }));

        throw new Error(errorData.message || 'Wijziging kon niet worden verwijderd.');
    }

    return response.json();
}

async function handleStatusChange(event) {
    const select = event.target;
    const changeId = select.dataset.changeId;
    const previousStatus = select.dataset.previousStatus;
    const newStatus = select.value;

    select.disabled = true;

    try {
        await updateChangeStatus(changeId, newStatus);
        await loadChanges();
    } catch (error) {
        console.error(error);

        select.value = previousStatus;
        select.disabled = false;

        alert(error.message);
    }
}

async function handleDeleteChange(event) {
    const button = event.target.closest('.delete-change-button');

    if (!button) {
        return;
    }

    const changeId = button.dataset.changeId;

    const confirmed = confirm('Weet je zeker dat je deze roosterwijziging definitief wilt verwijderen?');

    if (!confirmed) {
        return;
    }

    button.disabled = true;

    try {
        await deleteChange(changeId);
        await loadChanges();
    } catch (error) {
        console.error(error);

        button.disabled = false;
        alert(error.message);
    }
}

function handleDetailsToggle(event) {
    const button = event.target.closest('.details-toggle-button');

    if (!button) {
        return;
    }

    const changeId = button.dataset.changeId;
    const detailsRow = document.querySelector(`[data-details-row="${changeId}"]`);

    if (!detailsRow) {
        return;
    }

    const isHidden = detailsRow.hidden;

    detailsRow.hidden = !isHidden;
    button.setAttribute('aria-expanded', String(isHidden));
    button.classList.toggle('is-active', isHidden);
    button.title = isHidden ? 'Beschrijving verbergen' : 'Beschrijving tonen';
    button.setAttribute(
        'aria-label',
        isHidden ? 'Beschrijving verbergen' : 'Beschrijving tonen'
    );
}

async function loadChanges() {
    if (!permissions.canViewCml) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    Je hebt geen toegang tot het roosterwijzigingenoverzicht.
                </td>
            </tr>
        `;

        return;
    }

    try {
        const queryString = buildQueryString();
        const url = queryString ? `/api/changes?${queryString}` : '/api/changes';

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Roosterwijzigingen konden niet worden opgehaald.');
        }

        const changes = await response.json();

        renderChanges(changes);
    } catch (error) {
        console.error(error);

        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    Er ging iets mis bij het laden van de roosterwijzigingen.
                </td>
            </tr>
        `;
    }
}

searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    loadChanges();
});

document.addEventListener('DOMContentLoaded', loadChanges);