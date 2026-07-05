function renderLatestChange(change) {
    const container = document.getElementById('latest-change-content');

    if (!container) {
        return;
    }

    if (!change) {
        container.innerHTML = '<p class="empty-state">Geen recente wijzigingen beschikbaar.</p>';
        return;
    }

    const employeeText = change.employee2
        ? `${change.employee} / ${change.employee2}`
        : change.employee;

    container.innerHTML = `
        <p><span class="field-label">Wie:</span> ${employeeText}</p>
        <p><span class="field-label">Datum wijziging:</span> ${change.date}</p>
        <p><span class="field-label">Datum doorgegeven:</span> ${change.reportedDate}</p>
        <p><span class="field-label">Type:</span> ${change.type}</p>
        <p><span class="field-label">Waarom:</span> ${change.reason}</p>
        <p><span class="field-label">Locatie:</span> ${change.location}</p>
        <p><span class="field-label">Status:</span> <span class="status-pill">${change.status}</span></p>
    `;
}

async function loadLatestChange() {
    try {
        const response = await fetch('/api/changes/latest');

        if (response.status === 404) {
            renderLatestChange(null);
            return;
        }

        if (!response.ok) {
            throw new Error('Laatste wijziging kon niet worden opgehaald.');
        }

        const latestChange = await response.json();
        renderLatestChange(latestChange);
    } catch (error) {
        console.error(error);
        renderLatestChange(null);
    }
}

document.addEventListener('DOMContentLoaded', loadLatestChange);