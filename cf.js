const form = document.getElementById('change-form');
const formMessage = document.getElementById('form-message');
const currentUserRole = localStorage.getItem('demoRole') || 'guest';

if (currentUserRole !== 'admin') {
    const nextPage = encodeURIComponent('cf.html');
    window.location.replace(`login.html?next=${nextPage}`);
}

form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    const newChange = {
        date: document.getElementById('change-date').value,
        reportedDate: document.getElementById('change-reported-date').value,
        location: document.getElementById('change-location').value,
        employee: document.getElementById('change-employee').value.trim(),
        employee2: document.getElementById('change-employee2').value.trim(),
        type: document.getElementById('change-type').value,
        reason: document.getElementById('change-reason').value.trim(),
        status: document.getElementById('change-status').value,
        createdBy: document.getElementById('change-created-by').value
    };

    submitButton.disabled = true;
    formMessage.textContent = 'Wijziging opslaan...';

    try {
        const response = await fetch('/api/changes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Demo-Role': currentUserRole
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
        formMessage.textContent = error.message || 'Er ging iets mis bij het opslaan van de wijziging.';
    } finally {
        submitButton.disabled = false;
    }
});
