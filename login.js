const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const nextPage = new URLSearchParams(window.location.search).get('next');
const ROLE_LEVEL = { guest: 0, employee: 1, manager: 2, admin: 3 };
const PAGE_ACCESS = {
    'index.html': 'guest', 'roster.html': 'guest', 'login.html': 'guest',
    'staffing.html': 'manager', 'staffing-standards.html': 'manager', 'cml.html': 'manager', 'hours.html': 'manager',
    'employee-settings.html': 'admin', 'cf.html': 'admin', 'dashboard.html': 'admin', 'create.html': 'admin'
};

function getSafeNextPage(userRole) {
    const minimumRole = PAGE_ACCESS[nextPage];
    if (nextPage && minimumRole && ROLE_LEVEL[userRole] >= ROLE_LEVEL[minimumRole]) return nextPage;
    return 'index.html';
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
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Inloggen is niet gelukt.');
        localStorage.setItem('demoRole', result.user.role);
        loginStatus.textContent = `Ingelogd als ${result.user.displayName}.`;
        window.location.href = getSafeNextPage(result.user.role);
    } catch (error) {
        console.error(error);
        loginStatus.textContent = error.message || 'Inloggen is niet gelukt.';
        submitButton.disabled = false;
    }
});
