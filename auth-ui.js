let currentAuthState = {
    authenticated: false,
    role: 'guest',
    user: null
};

function ensureNavigationStyles() {
    if (document.querySelector('link[href="navigation.css"]')) {
        return;
    }

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'navigation.css';
    document.head.appendChild(stylesheet);
}

function getCurrentPage() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

function markCurrentNavigationItem(navLinks) {
    const currentPage = getCurrentPage();

    navLinks.querySelectorAll('a[href]').forEach((link) => {
        if (link.getAttribute('href') === currentPage) {
            link.setAttribute('aria-current', 'page');
            link.closest('.nav-dropdown')?.classList.add('is-current');
        }
    });
}

function buildNavigation() {
    ensureNavigationStyles();

    document.querySelectorAll('.nav-links').forEach((navLinks) => {
        navLinks.innerHTML = `
            <a class="nav-item" href="index.html">Home</a>
            <a class="nav-item" href="roster.html">Rooster</a>

            <details class="nav-dropdown">
                <summary>Operationeel</summary>
                <div class="nav-dropdown-menu">
                    <a href="staffing.html">Bezettingsanalyse</a>
                    <a href="staffing-standards.html">Bezettingsstandaarden</a>
                    <a href="hours.html" data-manager-only hidden>Urenanalyse &amp; urenbank</a>
                    <a href="cml.html">Roosterwijzigingen</a>
                    <a href="cf.html" data-admin-only hidden>Wijziging registreren</a>
                </div>
            </details>

            <a class="nav-item" href="dashboard.html">Dashboard</a>
            <a class="nav-item nav-account-name" href="login.html" data-auth-entry>Inloggen</a>
        `;

        markCurrentNavigationItem(navLinks);
    });
}

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
    logoutLink.className = 'nav-item';
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

function protectManagerPage(authState) {
    if (!document.body.hasAttribute('data-manager-page') || ['manager', 'admin'].includes(authState.role)) {
        return;
    }

    if (!authState.authenticated) {
        const nextPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'hours.html');
        window.location.replace(`login.html?next=${nextPage}`);
        return;
    }

    window.location.replace('dashboard.html');
}

document.addEventListener('DOMContentLoaded', async () => {
    buildNavigation();

    const authState = await fetchAuthState();
    updateAuthNavigation(authState);
    protectAdminPage(authState);
    protectManagerPage(authState);

    document.dispatchEvent(new CustomEvent('authready', {
        detail: authState
    }));
});
