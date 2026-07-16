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

const SIDEBAR_STORAGE_KEY = 'sso_sidebar_collapsed';
const desktopSidebarQuery = window.matchMedia('(min-width: 901px)');

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

function getStoredSidebarState() {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
}

function updateCollapseButton(button, isCollapsed) {
    if (!button) return;

    button.setAttribute('aria-expanded', String(!isCollapsed));
    button.setAttribute('aria-label', isCollapsed ? 'Navigatie uitklappen' : 'Navigatie inklappen');
    button.title = isCollapsed ? 'Navigatie uitklappen' : 'Navigatie inklappen';

    const icon = button.querySelector('[data-collapse-icon]');
    if (icon) {
        icon.textContent = isCollapsed ? '›' : '‹';
    }
}

function applySidebarState(requestedCollapsed = getStoredSidebarState()) {
    const isCollapsed = desktopSidebarQuery.matches && requestedCollapsed;
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);

    document.querySelectorAll('[data-sidebar-collapse]').forEach((button) => {
        updateCollapseButton(button, isCollapsed);
    });
}

function toggleDesktopSidebar() {
    const nextState = !document.body.classList.contains('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextState));
    applySidebarState(nextState);
}

function navigationItem(href, icon, label, attributes = '') {
    return `
        <a class="nav-item" href="${href}" title="${label}" ${attributes}>
            <span class="nav-item-icon" aria-hidden="true">${icon}</span>
            <span class="nav-item-label">${label}</span>
        </a>
    `;
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

        const mobileToggleLabel = nav.querySelector('.nav-toggle-label');
        if (mobileToggleLabel) {
            mobileToggleLabel.setAttribute('aria-label', 'Navigatie openen of sluiten');
            mobileToggleLabel.title = 'Navigatie openen of sluiten';
        }

        const navLinks = nav.querySelector('.nav-links');
        if (!navLinks) {
            return;
        }

        navLinks.innerHTML = `
            <div class="nav-sidebar-head">
                <div class="nav-brand" aria-label="Sport Society Overview">
                    <span class="nav-brand-kicker">Sport Society</span>
                    <strong class="nav-brand-name">Overview</strong>
                    <strong class="nav-brand-short" aria-hidden="true">SSO</strong>
                </div>
                <button type="button" class="nav-collapse-button" data-sidebar-collapse aria-expanded="true">
                    <span data-collapse-icon aria-hidden="true">‹</span>
                </button>
            </div>

            <p class="nav-section-label">Algemeen</p>
            ${navigationItem('index.html', '⌂', 'Home')}
            ${navigationItem('roster.html', '▦', 'Rooster')}

            <p class="nav-section-label">Operationeel</p>
            ${navigationItem('staffing.html', '◫', 'Bezettingsanalyse')}
            ${navigationItem('staffing-standards.html', '⚙', 'Bezettingsstandaarden')}
            ${navigationItem('cml.html', '↔', 'Roosterwijzigingen')}

            <p class="nav-section-label" data-manager-only hidden>Management</p>
            ${navigationItem('hours.html', '◷', 'Urenanalyse &amp; urenbank', 'data-manager-only hidden')}

            <p class="nav-section-label" data-admin-only hidden>Admin</p>
            ${navigationItem('cf.html', '＋', 'Wijziging registreren', 'data-admin-only hidden')}
            ${navigationItem('dashboard.html', '◇', 'Preview &amp; integratiestatus', 'data-admin-only hidden')}

            <div class="nav-spacer" aria-hidden="true"></div>
            <a class="nav-item nav-account-name" href="login.html" title="Inloggen" data-auth-entry>
                <span class="nav-item-icon" aria-hidden="true">●</span>
                <span class="nav-item-label">Inloggen</span>
            </a>
        `;

        markCurrentNavigationItem(navLinks);

        navLinks.querySelector('[data-sidebar-collapse]')?.addEventListener('click', toggleDesktopSidebar);

        navLinks.querySelectorAll('a[href]').forEach((link) => {
            link.addEventListener('click', () => closeMobileNavigation(nav));
        });
    });

    applySidebarState();
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

function setNavigationLinkLabel(link, label) {
    const labelElement = link.querySelector('.nav-item-label');
    if (labelElement) {
        labelElement.textContent = label;
    } else {
        link.textContent = label;
    }
    link.title = label;
}

function createLogoutLink(navLinks) {
    if (navLinks.querySelector('[data-auth-logout]')) {
        return;
    }

    const logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.className = 'nav-item nav-logout-link';
    logoutLink.title = 'Uitloggen';
    logoutLink.dataset.authLogout = '';
    logoutLink.innerHTML = `
        <span class="nav-item-icon" aria-hidden="true">↪</span>
        <span class="nav-item-label">Uitloggen</span>
    `;

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
            setNavigationLinkLabel(link, 'Inloggen');
            link.setAttribute('aria-label', 'Inloggen');
            return;
        }

        const accountLabel = authState.user?.displayName || authState.user?.username || 'Account';
        link.href = '#';
        setNavigationLinkLabel(link, accountLabel);
        link.setAttribute('aria-label', `Ingelogd als ${accountLabel}`);
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

desktopSidebarQuery.addEventListener?.('change', () => applySidebarState());

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('nav').forEach(closeMobileNavigation);
});

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
