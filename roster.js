const filterForm = document.getElementById('roster-filter-form');
const employeeFilter = document.getElementById('employee-filter');
const typeFilter = document.getElementById('type-filter');
const locationFilter = document.getElementById('location-filter');
const statusFilter = document.getElementById('status-filter');
const resetButton = document.getElementById('reset-roster-filters');
const summaryContainer = document.getElementById('roster-summary');
const resultsContainer = document.getElementById('roster-results');
const resultCount = document.getElementById('roster-result-count');

let rosterItems = [];

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
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

function getTodayDateString() {
    const today = new Date();

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getRosterItemKey(item) {
    return [
        item.sourceSheet || '',
        item.sourceCell || '',
        item.rosterDate || '',
        item.employeeName || '',
        item.startTime || '',
        item.endTime || ''
    ].join('|');
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

    return 'location-barneveld';
}

function getStatusClass(status) {
    if (status === 'Ziek') {
        return 'status-sick';
    }

    if (status === 'Feestdag') {
        return 'status-special';
    }

    if (status === 'Tijd voor tijd') {
        return 'status-tvt';
    }

    if (status === 'Betaald verlof / vakantie') {
        return 'status-absence';
    }

    return '';
}

function getPrimaryPill(item) {
    if (item.itemType === 'shift') {
        return `
            <span class="roster-pill ${getLocationClass(item.location)}">
                ${escapeHtml(item.location)}
            </span>
        `;
    }

    return `
        <span class="roster-pill ${getStatusClass(item.status)}">
            ${escapeHtml(item.status)}
        </span>
    `;
}

function getTimeText(item) {
    if (item.startTime && item.endTime) {
        return `${item.startTime} - ${item.endTime}`;
    }

    return item.itemType === 'shift' ? 'Tijd onbekend' : 'Hele dag';
}

function isCurrentOrFutureItem(item) {
    return String(item.rosterDate || '') >= getTodayDateString();
}

function sortRosterItems(items) {
    return [...items].sort((a, b) => {
        const aDate = String(a.rosterDate || '');
        const bDate = String(b.rosterDate || '');

        const aIsCurrentOrFuture = isCurrentOrFutureItem(a);
        const bIsCurrentOrFuture = isCurrentOrFutureItem(b);

        if (aIsCurrentOrFuture !== bIsCurrentOrFuture) {
            return aIsCurrentOrFuture ? -1 : 1;
        }

        const dateCompare = aIsCurrentOrFuture
            ? aDate.localeCompare(bDate)
            : bDate.localeCompare(aDate);

        if (dateCompare !== 0) {
            return dateCompare;
        }

        return String(a.startTime || '99:99').localeCompare(String(b.startTime || '99:99'));
    });
}

function getFilteredItems() {
    const employeeValue = employeeFilter.value.trim().toLowerCase();
    const typeValue = typeFilter.value;
    const locationValue = locationFilter.value;
    const statusValue = statusFilter.value;

    return rosterItems.filter((item) => {
        const employeeName = String(item.employeeName || '').toLowerCase();

        const employeeMatches = !employeeValue
            || employeeName.includes(employeeValue)
            || item.employeeName === 'ALL';

        const typeMatches = !typeValue || item.itemType === typeValue;
        const locationMatches = !locationValue || item.location === locationValue;
        const statusMatches = !statusValue || item.status === statusValue;

        return employeeMatches && typeMatches && locationMatches && statusMatches;
    });
}

function groupItemsByDate(items) {
    const groups = new Map();

    items.forEach((item) => {
        if (!groups.has(item.rosterDate)) {
            groups.set(item.rosterDate, []);
        }

        groups.get(item.rosterDate).push(item);
    });

    return groups;
}

function getNextShift(items) {
    return items.find((item) => (
        item.itemType === 'shift'
        && isCurrentOrFutureItem(item)
    ));
}

function renderSummary(items) {
    const total = items.length;
    const shifts = items.filter((item) => item.itemType === 'shift').length;
    const absences = items.filter((item) => item.itemType === 'absence').length;
    const specials = items.filter((item) => item.itemType === 'special').length;
    const takeovers = items.filter((item) => String(item.note || '').includes('Overgenomen dienst')).length;

    summaryContainer.innerHTML = `
        <article class="roster-summary-card">
            <span class="summary-value">${total}</span>
            <span class="summary-label">Items</span>
        </article>

        <article class="roster-summary-card">
            <span class="summary-value">${shifts}</span>
            <span class="summary-label">Diensten</span>
        </article>

        <article class="roster-summary-card">
            <span class="summary-value">${absences}</span>
            <span class="summary-label">Afwezigheden</span>
        </article>

        <article class="roster-summary-card">
            <span class="summary-value">${specials}</span>
            <span class="summary-label">Bijzonder</span>
        </article>

        <article class="roster-summary-card">
            <span class="summary-value">${takeovers}</span>
            <span class="summary-label">Overgenomen</span>
        </article>
    `;
}

function renderRosterItem(item, nextShiftKey) {
    const isNextShift = getRosterItemKey(item) === nextShiftKey;

    return `
        <div class="roster-item ${isNextShift ? 'is-next-shift' : ''}">
            <div class="roster-time">
                ${escapeHtml(getTimeText(item))}
            </div>

            <div>
                <div class="roster-employee">
                    ${escapeHtml(item.employeeName)}

                    ${isNextShift ? `
                        <span class="next-shift-label">
                            Eerstvolgende dienst
                        </span>
                    ` : ''}
                </div>

                ${item.note ? `
                    <div class="roster-note">
                        ${escapeHtml(item.note)}
                    </div>
                ` : ''}
            </div>

            <div>
                ${getPrimaryPill(item)}
            </div>

            <div class="roster-meta">
                Type: ${escapeHtml(item.itemType)}
                <br>
                Status: ${escapeHtml(item.status)}
            </div>
        </div>
    `;
}

function renderRosterItems(items) {
    const sortedItems = sortRosterItems(items);
    const nextShift = getNextShift(sortedItems);
    const nextShiftKey = nextShift ? getRosterItemKey(nextShift) : null;

    renderSummary(sortedItems);

    resultCount.textContent = `${sortedItems.length} item(s) gevonden`;

    if (sortedItems.length === 0) {
        resultsContainer.innerHTML = `
            <p class="empty-state">
                Geen roosteritems gevonden met deze filters.
            </p>
        `;
        return;
    }

    const groupedItems = groupItemsByDate(sortedItems);

    resultsContainer.innerHTML = Array.from(groupedItems.entries()).map(([date, dayItems]) => {
        const dayName = dayItems[0]?.dayName || '';

        return `
            <article class="roster-day">
                <div class="roster-day-header">
                    <h3>${escapeHtml(dayName)} ${formatDate(date)}</h3>
                    <span>${dayItems.length} item(s)</span>
                </div>

                <div class="roster-items">
                    ${dayItems.map((item) => renderRosterItem(item, nextShiftKey)).join('')}
                </div>
            </article>
        `;
    }).join('');
}

async function loadRosterPreview() {
    try {
        const response = await fetch('/api/roster-preview');

        if (response.status === 404) {
            resultsContainer.innerHTML = `
                <p class="empty-state">
                    Nog geen rooster-preview gevonden. Draai eerst:
                    <br>
                    <strong>npm run import:roster</strong>
                </p>
            `;

            resultCount.textContent = 'Geen preview beschikbaar';
            renderSummary([]);

            return;
        }

        if (!response.ok) {
            throw new Error('Rooster-preview kon niet worden opgehaald.');
        }

        const data = await response.json();

        rosterItems = Array.isArray(data.items) ? data.items : [];

        renderRosterItems(rosterItems);
    } catch (error) {
        console.error(error);

        resultsContainer.innerHTML = `
            <p class="empty-state">
                Er ging iets mis bij het laden van het rooster.
            </p>
        `;

        resultCount.textContent = 'Fout bij laden';
        renderSummary([]);
    }
}

filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderRosterItems(getFilteredItems());
});

resetButton.addEventListener('click', () => {
    employeeFilter.value = '';
    typeFilter.value = '';
    locationFilter.value = '';
    statusFilter.value = '';

    renderRosterItems(rosterItems);
});

document.addEventListener('DOMContentLoaded', loadRosterPreview);