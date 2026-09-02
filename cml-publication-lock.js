(() => {
    const tableBody = document.getElementById('changes-table-body');
    if (!tableBody) return;

    function lockPublicationRows() {
        tableBody.querySelectorAll('tr:not(.cml-details-row)').forEach((row) => {
            const cells = row.querySelectorAll(':scope > td');
            if (cells.length < 7) return;
            const type = cells[4]?.textContent?.trim();
            if (type !== 'Roosterpublicatie') return;
            if (row.dataset.publicationLocked === 'true') return;

            row.dataset.publicationLocked = 'true';
            row.classList.add('cml-publication-row');

            const statusCell = cells[5];
            const statusSelect = statusCell?.querySelector('select');
            if (statusSelect) {
                const status = statusSelect.value || 'Afgerond';
                statusCell.innerHTML = `<span class="status-pill status-done">${status}</span>`;
            }

            const actionCell = row.querySelector('.cml-action-cell');
            if (actionCell) {
                actionCell.innerHTML = '<span class="cml-publication-locked" title="Publicatiehistorie is onveranderlijk">Vastgelegd</span>';
            }
        });
    }

    const observer = new MutationObserver(lockPublicationRows);
    observer.observe(tableBody, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', lockPublicationRows);
    lockPublicationRows();
})();
