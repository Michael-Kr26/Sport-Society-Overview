let currentAuthState = {
    authenticated: false,
    role: 'guest',
    user: null
};

async function fetchAuthState() {
    try {
        const response = await fetch('/api/auth/me');

        if (!response.ok) {
            throw new Error('Sessie kon niet worden opgehaald.');
        }

        currentAuthState = await response.json();
    } catch (error) {
        console.error(error);
        currentAuthState = {
            authenticated: false,
            role: 'guest',
            user: null
        };
    }

    if (currentAuthState.authenticated) {
        localStorage.setItem('demoRole', currentAuthState.role);
    } else {
        localStorage.removeItem('demoRole');
    }

    window.currentAuthState = currentAuthState;
    return currentAuthState;
}

function createLogoutLink(navLinks) {
    if (navLinks.querySelector('[data-auth-logout]')) {
        return;
    }

    const logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.textContent = 'Uitloggen';
    logoutLink.dataset.authLogout = '';

    logoutLink.addEventListener('click', async (event) => {
        event.preventDefault();

        try {
            await fetch('/api/auth/logout', {
                method: 'POST'
            });
        } finally {
            localStorage.removeItem('demoRole');
            window.location.href = 'login.html';
        }
    });

    navLinks.appendChild(logoutLink);
}

function updateAuthNavigation(authState) {
    document.querySelectorAll('[data-auth-entry]').forEach((link) => {
        if (!authState.authenticated) {
            link.href = 'login.html';
            link.textContent = 'Inloggen';
            link.setAttribute('aria-label', 'Inloggen');
            return;
        }

        if (authState.role === 'admin') {
            link.href = 'cf.html';
            link.textContent = 'ChangeForm';
            link.setAttribute('aria-label', 'Open het wijzigingsformulier');
            return;
        }

        link.href = '#';
        link.textContent = authState.user?.displayName || authState.user?.username || 'Account';
        link.setAttribute('aria-label', 'Ingelogd account');
        link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    });

    document.querySelectorAll('.nav-links').forEach((navLinks) => {
        if (authState.authenticated) {
            createLogoutLink(navLinks);
        }
    });

    document.querySelectorAll('[data-admin-only]').forEach((element) => {
        element.hidden = authState.role !== 'admin';
    });

    document.querySelectorAll('[data-admin-content]').forEach((element) => {
        element.hidden = authState.role !== 'admin';
    });

    document.querySelectorAll('[data-manager-only]').forEach((element) => {
        element.hidden = !['manager', 'admin'].includes(authState.role);
    });
}

function protectAdminPage(authState) {
    if (!document.body.hasAttribute('data-admin-page') || authState.role === 'admin') {
        return;
    }

    const nextPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'cf.html');
    window.location.replace(`login.html?next=${nextPage}`);
}

document.addEventListener('DOMContentLoaded', async () => {
    const authState = await fetchAuthState();
    updateAuthNavigation(authState);
    protectAdminPage(authState);

    document.dispatchEvent(new CustomEvent('authready', {
        detail: authState
    }));
});
