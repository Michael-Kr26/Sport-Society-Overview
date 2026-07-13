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
const allowedLocations = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];

const searchForm = document.getElementById('cml-search-form');
const tableBody = document.getElementById('changes-table-body');
const paginationContainer = document.getElementById('cml-pagination');

let currentPage = 1;
let focusWeekStart = '';
let shouldFocusSelectedWeek = true;
let activeEditChangeId = null;
let visibleChanges = [];

function userCanUpdateStatus() {
    return permissions.canUpdateChangeStatus;
}

function userCanDeleteChange() {
    return permissions.canDeleteChange;
}

function getTableColumnCount() {
    return userCanDeleteChange() ? 8 : 7;
}

function applyRoleLayout() {
    if (!userCanDeleteChange()) {
        document.querySelector('.cml-actions-header')?.remove();
    }
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

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getCurrentWeekStartValue() {
    return toIsoDate(getIsoWeekStart(new Date()));
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

function renderLocationOptions(selectedLocation) {
    return allowedLocations.map((location) => `
        <option value="${escapeHtml(location)}" ${location === selectedLocation ? 'selected' : ''}>
            ${escapeHtml(location)}
        </option>
    `).join('');
}

function renderEditRow(change, columnCount) {
    return `
        <tr class="cml-details-row cml-edit-row" data-edit-row="${change.id}">
            <td colspan="${columnCount}">
                <form class="cml-edit-form" data-change-id="${change.id}">
                    <strong>Wijziging aanpassen</strong>

                    <div class="cml-edit-grid">
                        <label>
                            Datum wijziging
                            <input type="date" name="date" value="${escapeHtml(change.date)}" required>
                        </label>

                        <label>
                            Locatie
                            <select name="location" required>
                                ${renderLocationOptions(change.location)}
                            </select>
                        </label>

                        <label>
                            Medewerker 1
                            <input type="text" name="employee" value="${escapeHtml(change.employee)}" required>
                        </label>

                        <label>
                            Medewerker 2
                            <input type="text" name="employee2" value="${escapeHtml(change.employee2 || '')}">
                        </label>

                        <label class="cml-edit-full">
                            Reden / informatie
                            <textarea name="reason" rows="3">${escapeHtml(change.reason || '')}</textarea>
                        </label>
                    </div>

                    <div class="cml-edit-actions">
                        <button type="submit" class="admin-button cml-save-button">
                            Bevestigen
                        </button>
                        <button type="button" class="cml-secondary-button cancel-edit-button" data-change-id="${change.id}">
                            Annuleren
                        </button>
                    </div>
                </form>
            </td>
        </tr>
    `;
}

function renderActionCell(change) {
    return `
        <div class="cml-action-buttons">
            <button
                type="button"
                class="edit-change-button"
                data-change-id="${change.id}"
                aria-label="Wijziging aanpassen"
                title="Wijziging aanpassen"
            >
                &#9998;
            </button>
            <button
                type="button"
                class="delete-change-button"
                data-change-id="${change.id}"
                aria-label="Wijziging verwijderen"
                title="Wijziging verwijderen"
            >
                &#128465;
            </button>
        </div>
    `;
}

function attachTableActionListeners() {
    const statusSelects = document.querySelectorAll('.status-select');
    const editButtons = document.querySelectorAll('.edit-change-button');
    const deleteButtons = document.querySelectorAll('.delete-change-button');
    const editForms = document.querySelectorAll('.cml-edit-form');
    const cancelEditButtons = document.querySelectorAll('.cancel-edit-button');

    statusSelects.forEach((select) => {
        select.addEventListener('change', handleStatusChange);
    });

    editButtons.forEach((button) => {
        button.addEventListener('click', handleEditChange);
    });

    deleteButtons.forEach((button) => {
        button.addEventListener('click', handleDeleteChange);
    });

    editForms.forEach((form) => {
        form.addEventListener('submit', handleEditSubmit);
    });

    cancelEditButtons.forEach((button) => {
        button.addEventListener('click', handleCancelEdit);
    });
}

function renderChanges(changes) {
    if (!tableBody) {
        return;
    }

    const columnCount = getTableColumnCount();
    visibleChanges = Array.isArray(changes) ? changes : [];

    if (!changes || changes.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="${columnCount}" class="empty-state">
                    Geen roosterwijzigingen gevonden.
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = changes.map((change) => {
        const reason = String(change.reason || '').trim();
        const employee2 = String(change.employee2 || '').trim();
        const employee2CellClass = employee2 ? '' : ' class="cml-mobile-hide-empty"';
        const isEditing = activeEditChangeId === Number(change.id);
        const actionCell = userCanDeleteChange()
            ? `<td class="cml-action-cell">${renderActionCell(change)}</td>`
            : '';
        const detailsRow = isEditing
            ? renderEditRow(change, columnCount)
            : reason ? `
                <tr class="cml-details-row" data-details-row="${change.id}">
                    <td colspan="${columnCount}">
                        <div class="cml-details-content">
                            <strong>Informatie</strong>
                            <p>${escapeHtml(reason)}</p>
                        </div>
                    </td>
                </tr>
            ` : '';

        return `
            <tr>
                <td>${formatDate(change.date)}</td>
                <td>${renderLocationCell(change.location)}</td>
                <td>${escapeHtml(change.employee)}</td>
                <td${employee2CellClass}>${employee2 ? escapeHtml(employee2) : '-'}</td>
                <td>${escapeHtml(change.type)}</td>
                <td>${renderStatusCell(change)}</td>
                <td>${escapeHtml(change.createdBy)}</td>
                ${actionCell}
            </tr>
            ${detailsRow}
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

function renderPaginationControls(page, totalPages) {
    const paginationItems = getVisiblePaginationItems(page, totalPages);
    const pageButtons = paginationItems.map((item) => {
        if (typeof item === 'string') {
            return '<span class="cml-pagination-ellipsis">...</span>';
        }

        return renderPaginationButton(String(item), item, {
            isActive: item === page
        });
    }).join('');

    return `
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
}

function renderPagination(pagination) {
    if (!paginationContainer) {
        return;
    }

    if (!pagination) {
        paginationContainer.hidden = true;
        paginationContainer.innerHTML = '';
        return;
    }

    const { page, totalPages, totalItems, weekStart, weekEnd, mode } = pagination;

    if (mode === 'archive') {
        if (totalItems === 0) {
            paginationContainer.hidden = true;
            paginationContainer.innerHTML = '';
            return;
        }

        paginationContainer.hidden = false;
        paginationContainer.innerHTML = `
            <p class="cml-pagination-summary">
                Archived — ${totalItems} wijziging${totalItems === 1 ? '' : 'en'} • pagina ${page} van ${totalPages}
            </p>
            ${renderPaginationControls(page, totalPages)}
        `;

        paginationContainer.querySelectorAll('.cml-pagination-button').forEach((button) => {
            button.addEventListener('click', handlePaginationClick);
        });

        return;
    }

    if (!weekStart) {
        paginationContainer.hidden = true;
        paginationContainer.innerHTML = '';
        return;
    }

    const weekNumber = getIsoWeekNumber(weekStart);
    const weekLabel = weekNumber ? `Week ${weekNumber}` : 'Week';

    paginationContainer.hidden = false;
    paginationContainer.innerHTML = `
        <p class="cml-pagination-summary">
            ${weekLabel} — ${formatDate(weekStart)} t/m ${formatDate(weekEnd)} • ${totalItems} wijziging${totalItems === 1 ? '' : 'en'}
        </p>
        ${renderPaginationControls(page, totalPages)}
    `;

    paginationContainer.querySelectorAll('.cml-pagination-button').forEach((button) => {
        button.addEventListener('click', handlePaginationClick);
    });
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

    if (focusWeekStart && shouldFocusSelectedWeek && status !== 'Archived') {
        params.append('focusWeekStart', focusWeekStart);
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

async function updateChangeDetails(changeId, updates) {
    const response = await fetch(`/api/changes/${changeId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Demo-Role': currentUserRole
        },
        body: JSON.stringify(updates)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({
            message: 'Wijziging kon niet worden aangepast.'
        }));

        throw new Error(errorData.message || 'Wijziging kon niet worden aangepast.');
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
        activeEditChangeId = null;
        await updateChangeStatus(changeId, newStatus);
        await loadChanges();
    } catch (error) {
        console.error(error);

        select.value = previousStatus;
        select.disabled = false;

        alert(error.message);
    }
}

function handleEditChange(event) {
    const button = event.target.closest('.edit-change-button');

    if (!button) {
        return;
    }

    activeEditChangeId = Number(button.dataset.changeId);
    renderChanges(visibleChanges);
}

function handleCancelEdit(event) {
    const button = event.target.closest('.cancel-edit-button');

    if (!button) {
        return;
    }

    activeEditChangeId = null;
    renderChanges(visibleChanges);
}

async function handleEditSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const changeId = Number(form.dataset.changeId);
    const formData = new FormData(form);
    const submitButton = form.querySelector('button[type="submit"]');

    const updates = {
        date: String(formData.get('date') || '').trim(),
        location: String(formData.get('location') || '').trim(),
        employee: String(formData.get('employee') || '').trim(),
        employee2: String(formData.get('employee2') || '').trim(),
        reason: String(formData.get('reason') || '').trim()
    };

    if (!updates.date || !updates.location || !updates.employee) {
        alert('Datum, locatie en medewerker 1 zijn verplicht.');
        return;
    }

    submitButton.disabled = true;

    try {
        await updateChangeDetails(changeId, updates);
        activeEditChangeId = null;
        await loadChanges();
    } catch (error) {
        console.error(error);
        submitButton.disabled = false;
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
        activeEditChangeId = null;
        await deleteChange(changeId);
        await loadChanges();
    } catch (error) {
        console.error(error);

        button.disabled = false;
        alert(error.message);
    }
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
    shouldFocusSelectedWeek = false;
    focusWeekStart = '';
    activeEditChangeId = null;

    loadChanges();

    document.querySelector('.cml-results-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

async function loadChanges() {
    const columnCount = getTableColumnCount();

    if (!permissions.canViewCml) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="${columnCount}" class="empty-state">
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
                <td colspan="${columnCount}" class="empty-state">
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
    activeEditChangeId = null;

    const status = document.getElementById('search-status').value;

    if (status === 'Archived') {
        focusWeekStart = '';
        shouldFocusSelectedWeek = false;
    } else {
        focusWeekStart = getCurrentWeekStartValue();
        shouldFocusSelectedWeek = true;
    }

    loadChanges();
});

document.addEventListener('DOMContentLoaded', () => {
    applyRoleLayout();
    focusWeekStart = getCurrentWeekStartValue();
    shouldFocusSelectedWeek = true;
    loadChanges();
});
