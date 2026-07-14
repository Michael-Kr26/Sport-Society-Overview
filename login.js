const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const nextPage = new URLSearchParams(window.location.search).get('next');

function getSafeNextPage(userRole) {
    const allowedNextPages = ['index.html', 'roster.html', 'cml.html', 'dashboard.html', 'cf.html', 'create.html'];

    if (nextPage && allowedNextPages.includes(nextPage)) {
        return nextPage;
    }

    return userRole === 'admin' ? 'cf.html' : 'index.html';
}

loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = loginForm.querySelector('button[type="submit"]');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    submitButton.disabled = true;
    loginStatus.textContent = 'Inloggen...';

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Inloggen is niet gelukt.');
        }

        localStorage.setItem('demoRole', result.user.role);
        loginStatus.textContent = `Ingelogd als ${result.user.displayName}.`;
        window.location.href = getSafeNextPage(result.user.role);
    } catch (error) {
        console.error(error);
        loginStatus.textContent = error.message || 'Inloggen is niet gelukt.';
        submitButton.disabled = false;
    }
});
