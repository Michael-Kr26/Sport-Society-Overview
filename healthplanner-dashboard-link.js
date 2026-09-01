(() => {
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    document.addEventListener('authready', (event) => {
        if (!['manager', 'admin'].includes(event.detail.role)) return;
        const container = document.getElementById('dashboard-actions');
        if (!container || container.querySelector('a[href="healthplanner.html"]')) return;
        container.insertAdjacentHTML('beforeend', `<a class="dashboard-action" href="healthplanner.html">
            <span class="dashboard-action-icon" aria-hidden="true">▤</span>
            <strong>HealthPlanner</strong>
            <span>${escapeHtml('Bekijk verkoop, leads, coaching, bezoek en ledenbehoud per vestiging.')}</span>
        </a>`);
    }, { once: true });
})();
