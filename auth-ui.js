const originalWindowFetch = window.fetch.bind(window);

window.fetch = (input, options) => {
    const requestUrl = typeof input === 'string' ? input : input?.url;

    if (typeof requestUrl === 'string' && /^\/api\/roster(?:\?|$)/.test(requestUrl)) {
        const effectiveUrl = requestUrl.replace(/^\/api\/roster/, '/api/roster-effective');

        if (typeof input === 'string') {
            return originalWindowFetch(effectiveUrl, options);
        }

        return originalWindowFetch(new Request(effectiveUrl, input), options);
    }

    return originalWindowFetch(input, options);
};

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
        }
    });
}

function closeMobileNavigation(nav) {
    const toggle = nav.querySelector('#nav-toggle');
    if (toggle) {
        toggle.checked = false;
    }
}

function buildNavigation() {
    ensureNavigationStyles();

    const navigationElements = document.querySelectorAll('nav');
    if (!navigationElements.length) {
        return;
    }

    document.body.classList.add('has-sidebar-navigation');

    navigationElements.forEach((nav) => {
        nav.setAttribute('aria-label', 'Hoofdnavigatie');
        const navLinks = nav.querySelector('.nav-links');

        if (!navLinks) {
            return;
        }

        navLinks.innerHTML = `
            <div class="nav-brand" aria-label="Sport Society Overview">
                <span class="nav-brand-kicker">Sport Society</span>
                <strong>Overview</strong>
            </div>

            <p class="nav-section-label">Algemeen</p>
            <a class="nav-item" href="index.html">Home</a>
            <a class="nav-item" href="roster.html">Rooster</a>

            <p class="nav-section-label">Operationeel</p>
            <a class="nav-item" href="staffing.html">Bezettingsanalyse</a>
            <a class="nav-item" href="staffing-standards.html">Bezettingsstandaarden</a>
            <a class="nav-item" href="cml.html">Roosterwijzigingen</a>

            <p class="nav-section-label" data-manager-only hidden>Management</p>
            <a class="nav-item" href="hours.html" data-manager-only hidden>Urenanalyse &amp; urenbank</a>

            <p class="nav-section-label" data-admin-only hidden>Admin</p>
            <a class="nav-item" href="cf.html" data-admin-only hidden>Wijziging registreren</a>
            <a class="nav-item" href="dashboard.html" data-admin-only hidden>Preview &amp; integratiestatus</a>

            <div class="nav-spacer" aria-hidden="true"></div>
            <a class="nav-item nav-account-name" href="login.html" data-auth-entry>Inloggen</a>
        `;

        markCurrentNavigationItem(navLinks);

        navLinks.querySelectorAll('a[href]').forEach((link) => {
            link.addEventListener('click', () => closeMobileNavigation(nav));
        });
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
    logoutLink.className = 'nav-item nav-logout-link';
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

    if (!authState.authenticated) {
        const nextPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'cf.html');
        window.location.replace(`login.html?next=${nextPage}`);
        return;
    }

    window.location.replace('index.html');
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

    window.location.replace('index.html');
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
