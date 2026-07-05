const latestChange = {
    who: 'Leroy geruild met Denise',
    date: '04-07-2026',
    reason: 'Evenement met zoon',
    location: 'Sport Society Achterveld',
    status: 'Open'
};

function renderLatestChange(change) {
    const container = document.getElementById('latest-change-content');

    if (!container) {
        return;
    }

    if (!change) {
        container.innerHTML = '<p class="empty-state">Geen recente wijzigingen beschikbaar.</p>';
        return;
    }

    container.innerHTML = `
        <p><span class="field-label">Wie:</span> ${change.who}</p>
        <p><span class="field-label">Datum:</span> ${change.date}</p>
        <p><span class="field-label">Waarom:</span> ${change.reason}</p>
        <p><span class="field-label">Locatie:</span> ${change.location}</p>
        <p><span class="field-label">Status:</span> <span class="status-pill">${change.status}</span></p>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    renderLatestChange(latestChange);
});

/*
Toekomstige API-koppeling:

async function loadLatestChange() {
    try {
        const response = await fetch('/api/roosterwijzigingen/latest');

        if (!response.ok) {
            throw new Error('Laatste roosterwijziging kon niet worden opgehaald.');
        }

        const latestChangeFromDatabase = await response.json();
        renderLatestChange(latestChangeFromDatabase);
    } catch (error) {
        console.error(error);
        renderLatestChange(null);
    }
}

document.addEventListener('DOMContentLoaded', loadLatestChange);
*/
