const form = document.getElementById('change-form');
const formMessage = document.getElementById('form-message');

form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const newChange = {
        date: document.getElementById('change-date').value,
        reportedDate: document.getElementById('change-reported-date').value,
        location: document.getElementById('change-location').value,
        employee: document.getElementById('change-employee').value,
        employee2: document.getElementById('change-employee2').value,
        type: document.getElementById('change-type').value,
        reason: document.getElementById('change-reason').value,
        status: document.getElementById('change-status').value,
        createdBy: document.getElementById('change-created-by').value
    };

    try {
        const response = await fetch('/api/changes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newChange)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Wijziging kon niet worden opgeslagen.');
        }

        form.reset();
        formMessage.textContent = 'Wijziging opgeslagen in de database.';
    } catch (error) {
        console.error(error);
        formMessage.textContent = 'Er ging iets mis bij het opslaan van de wijziging.';
    }
});