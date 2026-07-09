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

const allowedStatuses = ['Open', 'In behandeling', 'Afgerond', 'Archived'];

const searchForm = document.getElementById('cml-search-form');
const tableBody = document.getElementById('changes-table-body');
const paginationContainer = document.getElementById('cml-pagination');
const weekFilter = document.getElementById('search-week');

let currentPage = 1;

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

function parseIsoDate(dateString) {
    if (!dateString) {
        return null;
    }

    const parts = dateString.split('-').map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return null;
    }

    const [year, month, day] = parts;

    return new Date(year, month - 1, day);
}

function getIsoWeekStart(date) {
    const weekStart = new Date(date.getTime());
    const dayNumber = (weekStart.getDay() + 6) % 7;

    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - dayNumber);

    return weekStart;
}

function addDays(date, days) {
    const nextDate = new Date(date.getTime());

    nextDate.setDate(nextDate.getDate() + days);

    return nextDate;
}

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getIsoWeekNumber(dateString) {
    const date = typeof dateString === 'string' ? parseIsoDate(dateString) : dateString;

    if (!date) {
        return null;
    }

    const normalizedDate = new Date(date.getTime());
    const dayNumber = (normalizedDate.getDay() + 6) % 7;

    normalizedDate.setDate(normalizedDate.getDate() - dayNumber + 3);

    const firstThursday = new Date(normalizedDate.getFullYear(), 0, 4);
    const firstThursdayDayNumber = (firstThursday.getDay() + 6) % 7;

    firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNumber + 3);

    return 1 + Math.round((normalizedDate - firstThursday) / (7 * 24 * 60 * 60 * 1000));
}

function populateWeekFilter() {
    if (!weekFilter) {
        return;
    }

    const previousValue = weekFilter.value;
    const currentWeekStart = getIsoWeekStart(new Date());
    const weekOptions = [
        {
            offset: -1,
            prefix: 'Vorige week'
        },
        {
            offset: 0,
            prefix: 'Huidige week'
        },
        {
            offset: 1,
            prefix: 'Volgende week'
        }
    ];

    const optionsHtml = weekOptions.map(({ offset, prefix }) => {
        const weekStartDate = addDays(currentWeekStart, offset * 7);
        const weekEndDate = addDays(weekStartDate, 6);
        const weekStart = toIsoDate(weekStartDate);
        const weekEnd = toIsoDate(weekEndDate);
        const weekNumber = getIsoWeekNumber(weekStartDate);

        return `
            <option value="${weekStart}">
                ${prefix} - week ${weekNumber} (${formatDate(weekStart)} t/m ${formatDate(weekEnd)})
            </option>
        `;
    }).join('');

    weekFilter.innerHTML = `
        <option value="">Alle weken</option>
        ${optionsHtml}
    `;

    if ([...weekFilter.options].some((option) => option.value === previousValue)) {
        weekFilter.value = previousValue;
    }
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

    if (status === 'Archived') {
        return 'status-archived';
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
                <td colspan="8" class="empty-state">
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
                <td>${renderLocationCell(change.location)}</td>
                <td>${escapeHtml(change.employee)}</td>
                <td>${change.employee2 ? escapeHtml(change.employee2) : '-'}</td>
                <td>${escapeHtml(change.type)}</td>
                <td>${renderStatusCell(change)}</td>
                <td>${escapeHtml(change.createdBy)}</td>
                <td class="cml-action-cell">${renderActionCell(change)}</td>
            </tr>
            <tr class="cml-details-row" data-details-row="${change.id}" hidden>
                <td colspan="8">
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

function getVisiblePaginationItems(page, totalPages) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    if (page <= 3) {
        return [1, 2, 3, 4, 5, 'ellipsis-end', totalPages];
    }

    if (page >= totalPages - 2) {
        return [1, 'ellipsis-start', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, 'ellipsis-start', page - 1, page, page + 1, 'ellipsis-end', totalPages];
}

function renderPaginationButton(label, page, options = {}) {
    const isActive = options.isActive ? ' is-active' : '';
    const disabled = options.disabled ? ' disabled' : '';
    const ariaCurrent = options.isActive ? ' aria-current="page"' : '';

    return `
        <button
            type="button"
            class="cml-pagination-button${isActive}"
            data-page="${page}"
            ${disabled}
            ${ariaCurrent}
        >
            ${label}
        </button>
    `;
}

function renderPagination(pagination) {
    if (!paginationContainer) {
        return;
    }

    if (!pagination || pagination.totalItems === 0 || !pagination.weekStart) {
        paginationContainer.hidden = true;
        paginationContainer.innerHTML = '';
        return;
    }

    const { page, totalPages, totalItems, weekStart, weekEnd } = pagination;
    const weekNumber = getIsoWeekNumber(weekStart);
    const weekLabel = weekNumber ? `Week ${weekNumber}` : 'Week';
    const paginationItems = getVisiblePaginationItems(page, totalPages);

    const pageButtons = paginationItems.map((item) => {
        if (typeof item === 'string') {
            return '<span class="cml-pagination-ellipsis">...</span>';
        }

        return renderPaginationButton(String(item), item, {
            isActive: item === page
        });
    }).join('');

    paginationContainer.hidden = false;
    paginationContainer.innerHTML = `
        <p class="cml-pagination-summary">
            ${weekLabel} — ${formatDate(weekStart)} t/m ${formatDate(weekEnd)} • ${totalItems} wijziging${totalItems === 1 ? '' : 'en'}
        </p>
        <div class="cml-pagination-controls">
            ${renderPaginationButton('Vorige', page - 1, {
                disabled: page <= 1
            })}
            ${pageButtons}
            ${renderPaginationButton('Volgende', page + 1, {
                disabled: page >= totalPages
            })}
        </div>
    `;

    paginationContainer.querySelectorAll('.cml-pagination-button').forEach((button) => {
        button.addEventListener('click', handlePaginationClick);
    });
}

function buildQueryString() {
    const params = new URLSearchParams();

    const name = document.getElementById('search-name').value.trim();
    const weekStart = weekFilter ? weekFilter.value : '';
    const month = document.getElementById('search-month').value;
    const location = document.getElementById('search-location').value;
    const type = document.getElementById('search-type').value;
    const status = document.getElementById('search-status').value;

    if (name) {
        params.append('name', name);
    }

    if (weekStart) {
        params.append('weekStart', weekStart);
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

    params.append('page', String(currentPage));

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

function handlePaginationClick(event) {
    const button = event.target.closest('.cml-pagination-button');

    if (!button || button.disabled) {
        return;
    }

    const nextPage = Number(button.dataset.page);

    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage === currentPage) {
        return;
    }

    currentPage = nextPage;
    loadChanges();

    document.querySelector('.cml-results-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

async function loadChanges() {
    if (!permissions.canViewCml) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    Je hebt geen toegang tot het roosterwijzigingenoverzicht.
                </td>
            </tr>
        `;
        renderPagination(null);
        return;
    }

    try {
        const queryString = buildQueryString();
        const response = await fetch(`/api/changes?${queryString}`);

        if (!response.ok) {
            throw new Error('Roosterwijzigingen konden niet worden opgehaald.');
        }

        const responseData = await response.json();
        const changes = Array.isArray(responseData) ? responseData : responseData.items;
        const pagination = Array.isArray(responseData) ? null : responseData.pagination;

        if (pagination && pagination.page !== currentPage) {
            currentPage = pagination.page;
        }

        renderChanges(changes);
        renderPagination(pagination);
    } catch (error) {
        console.error(error);

        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    Er ging iets mis bij het laden van de roosterwijzigingen.
                </td>
            </tr>
        `;
        renderPagination(null);
    }
}

searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    currentPage = 1;
    loadChanges();
});

document.addEventListener('DOMContentLoaded', () => {
    populateWeekFilter();
    loadChanges();
});
