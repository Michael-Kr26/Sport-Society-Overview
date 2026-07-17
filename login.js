(() => {
    const loginForm = document.getElementById('login-form');
    const loginStatus = document.getElementById('login-status');
    const loginTitle = document.getElementById('login-title');
    const loginIntro = document.getElementById('login-intro');
    const currentAccount = document.getElementById('current-account');
    const accountLogout = document.getElementById('account-logout');
    const nextPage = new URLSearchParams(window.location.search).get('next');
    const roleLevel = { guest: 0, employee: 1, manager: 2, admin: 3 };
    const pageAccess = {
        'index.html': 'guest',
        'roster.html': 'guest',
        'login.html': 'guest',
        'staffing.html': 'manager',
        'staffing-standards.html': 'manager',
        'cml.html': 'manager',
        'hours.html': 'manager',
        'employee-settings.html': 'admin',
        'cf.html': 'admin',
        'dashboard.html': 'admin',
        'create.html': 'admin'
    };

    function setStatus(text, type = '') {
        if (!loginStatus) return;
        loginStatus.textContent = text;
        loginStatus.className = `login-status${type ? ` is-${type}` : ''}`;
    }

    function getSafeNextPage(userRole) {
        const minimumRole = pageAccess[nextPage];
        if (nextPage && minimumRole && (roleLevel[userRole] || 0) >= roleLevel[minimumRole]) return nextPage;
        return 'index.html';
    }

    function showAccount(authState) {
        if (!authState?.authenticated) return;
        const user = authState.user || {};
        loginTitle.textContent = 'Mijn account';
        loginIntro.textContent = 'Je bent ingelogd. Rollen en vestigingskoppelingen kunnen alleen door een admin worden aangepast.';
        loginForm.hidden = true;
        currentAccount.hidden = false;
        document.getElementById('account-display-name').textContent = user.displayName || '-';
        document.getElementById('account-username').textContent = user.username ? `@${user.username}` : '-';
        document.getElementById('account-role').textContent = user.role ? user.role[0].toUpperCase() + user.role.slice(1) : '-';
        document.getElementById('account-location').textContent = user.location || 'Geen vaste vestiging';
    }

    document.addEventListener('authready', (event) => showAccount(event.detail), { once: true });

    accountLogout?.addEventListener('click', async () => {
        accountLogout.disabled = true;
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
            localStorage.removeItem('demoRole');
            window.location.reload();
        }
    });

    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        submitButton.disabled = true;
        setStatus('Inloggen...');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.message || 'Inloggen is niet gelukt.');
            localStorage.setItem('demoRole', result.user.role);
            setStatus(`Ingelogd als ${result.user.displayName}.`, 'success');
            window.location.assign(getSafeNextPage(result.user.role));
        } catch (error) {
            console.error(error);
            setStatus(error.message || 'Inloggen is niet gelukt.', 'error');
            submitButton.disabled = false;
        }
    });
})();
