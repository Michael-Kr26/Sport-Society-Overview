const form = document.getElementById('change-form');
const formMessage = document.getElementById('form-message');

form.addEventListener('submit', (event) => {
    event.preventDefault();

    const newChange = {
        id: Date.now(),
        date: document.getElementById('change-date').value,
        week: document.getElementById('change-week').value,
        location: document.getElementById('change-location').value,
        employee: document.getElementById('change-employee').value,
        employee2: document.getElementById('change-employee2').value,
        type: document.getElementById('change-type').value,
        reason: document.getElementById('change-reason').value,
        status: document.getElementById('change-status').value,
        createdBy: document.getElementById('change-created-by').value,
        createdAt: new Date().toISOString()
    };

    const existingChanges = JSON.parse(localStorage.getItem('sportSocietyChanges')) || [];

    existingChanges.push(newChange);

    localStorage.setItem('sportSocietyChanges', JSON.stringify(existingChanges));

    form.reset();

    formMessage.textContent = 'Wijziging opgeslagen. Ga terug naar Home om het dashboard te controleren.';
});