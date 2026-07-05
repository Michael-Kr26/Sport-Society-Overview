const searchForm = document.getElementById('cml-search-form');
const tableBody = document.getElementById('changes-table-body');

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

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
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
        const statusClass = getStatusClass(change.status);

        return `
            <tr>
                <td>${formatDate(change.date)}</td>
                <td>${formatDate(change.reportedDate)}</td>
                <td>${escapeHtml(change.location)}</td>
                <td>${escapeHtml(change.employee)}</td>
                <td>${change.employee2 ? escapeHtml(change.employee2) : '-'}</td>
                <td>${escapeHtml(change.type)}</td>
                <td>
                    <span class="status-pill ${statusClass}">
                        ${escapeHtml(change.status)}
                    </span>
                </td>
                <td>${escapeHtml(change.createdBy)}</td>
            </tr>
        `;
    }).join('');
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

async function loadChanges() {
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
                <td colspan="8" class="empty-state">
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