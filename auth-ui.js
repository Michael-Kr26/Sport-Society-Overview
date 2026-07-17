(() => {
    const originalWindowFetch = window.fetch.bind(window);

    window.fetch = (input, options) => {
        const requestUrl = typeof input === 'string' ? input : input?.url;
        if (typeof requestUrl === 'string' && /^\/api\/roster(?:\?|$)/.test(requestUrl)) {
            const effectiveUrl = requestUrl.replace(/^\/api\/roster/, '/api/roster-effective');
            return typeof input === 'string'
                ? originalWindowFetch(effectiveUrl, options)
                : originalWindowFetch(new Request(effectiveUrl, input), options);
        }
        return originalWindowFetch(input, options);
    };

    const ROLE_LEVEL = { guest: 0, employee: 1, manager: 2, admin: 3 };
    const PAGE_ACCESS = {
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
    const SIDEBAR_STORAGE_KEY = 'sso_sidebar_collapsed';
    const GROUP_STORAGE_PREFIX = 'sso_nav_group_';
    const desktopSidebarQuery = window.matchMedia('(min-width: 901px)');
    let currentAuthState = { authenticated: false, role: 'guest', user: null };

    const roleAllows = (role, minimumRole) => (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minimumRole] || 0);
    const currentPage = () => window.location.pathname.split('/').pop() || 'index.html';

    function ensureStylesheet(href) {
        if (document.querySelector(`link[href^="${href}"]`)) return;
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = `${href}?v=20260717-navigation-close`;
        document.head.appendChild(stylesheet);
    }

    function setMobileNavigationOpen(nav, open) {
        const toggle = nav?.querySelector('#nav-toggle');
        if (!toggle) return;
        toggle.checked = Boolean(open);
        nav.classList.toggle('is-mobile-open', Boolean(open));
        document.body.classList.toggle('mobile-navigation-open', Boolean(open));
        const label = nav.querySelector('.nav-toggle-label');
        label?.setAttribute('aria-expanded', String(Boolean(open)));
        const closeButton = nav.querySelector('[data-mobile-nav-close]');
        closeButton?.setAttribute('aria-hidden', String(!open));
    }

    function closeMobileNavigation(nav) {
        setMobileNavigationOpen(nav, false);
    }

    function updateCollapseButton(button, collapsed) {
        if (!button) return;
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? 'Navigatie uitklappen' : 'Navigatie inklappen');
        button.title = collapsed ? 'Navigatie uitklappen' : 'Navigatie inklappen';
        const icon = button.querySelector('[data-collapse-icon]');
        if (icon) icon.textContent = collapsed ? '›' : '‹';
    }

    function applySidebarState(requested = localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true') {
        const collapsed = desktopSidebarQuery.matches && requested;
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        document.querySelectorAll('[data-sidebar-collapse]').forEach((button) => updateCollapseButton(button, collapsed));
    }

    function toggleDesktopSidebar() {
        const collapsed = !document.body.classList.contains('sidebar-collapsed');
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
        applySidebarState(collapsed);
    }

    function navigationItem(href, icon, label, minimumRole = 'guest', attributes = '') {
        return `<a class="nav-item" href="${href}" title="${label}" data-min-role="${minimumRole}" ${attributes}>
            <span class="nav-item-icon" aria-hidden="true">${icon}</span><span class="nav-item-label">${label}</span>
        </a>`;
    }

    function navigationGroup(id, label, icon, items, minimumRole = 'guest') {
        return `<section class="nav-group" data-nav-group="${id}" data-min-role="${minimumRole}">
            <button type="button" class="nav-group-toggle" data-nav-group-toggle aria-expanded="true" title="${label}">
                <span class="nav-group-icon" aria-hidden="true">${icon}</span>
                <span class="nav-group-label">${label}</span>
                <span class="nav-group-chevron" aria-hidden="true">⌄</span>
            </button>
            <div class="nav-group-items">${items}</div>
        </section>`;
    }

    function setGroupCollapsed(group, collapsed, persist = true) {
        const id = group.dataset.navGroup;
        const toggle = group.querySelector('[data-nav-group-toggle]');
        group.classList.toggle('is-collapsed', collapsed);
        toggle?.setAttribute('aria-expanded', String(!collapsed));
        if (persist && id) localStorage.setItem(`${GROUP_STORAGE_PREFIX}${id}`, String(collapsed));
    }

    function initializeGroups(navLinks) {
        const page = currentPage();
        navLinks.querySelectorAll('[data-nav-group]').forEach((group) => {
            const containsCurrent = Boolean(group.querySelector(`a[href="${page}"]`));
            const stored = localStorage.getItem(`${GROUP_STORAGE_PREFIX}${group.dataset.navGroup}`) === 'true';
            setGroupCollapsed(group, containsCurrent ? false : stored, false);
            group.querySelector('[data-nav-group-toggle]')?.addEventListener('click', () => {
                setGroupCollapsed(group, !group.classList.contains('is-collapsed'));
            });
        });
    }

    function addMobileBackdrop(nav, navLinks) {
        let backdrop = nav.querySelector('.nav-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('button');
            backdrop.type = 'button';
            backdrop.className = 'nav-backdrop';
            backdrop.setAttribute('aria-label', 'Navigatie sluiten');
            backdrop.addEventListener('click', () => closeMobileNavigation(nav));
            nav.insertBefore(backdrop, navLinks);
        }
    }

    function buildNavigation() {
        ensureStylesheet('navigation.css');
        ensureStylesheet('responsive.css');
        const navigationElements = document.querySelectorAll('nav');
        if (!navigationElements.length) return;
        document.body.classList.add('has-sidebar-navigation');

        navigationElements.forEach((nav) => {
            nav.setAttribute('aria-label', 'Hoofdnavigatie');
            const toggle = nav.querySelector('#nav-toggle');
            const toggleLabel = nav.querySelector('.nav-toggle-label');
            if (toggleLabel) {
                toggleLabel.setAttribute('aria-label', 'Navigatie openen of sluiten');
                toggleLabel.setAttribute('aria-expanded', 'false');
                toggleLabel.title = 'Navigatie openen of sluiten';
            }
            toggle?.addEventListener('change', () => setMobileNavigationOpen(nav, toggle.checked));

            const navLinks = nav.querySelector('.nav-links');
            if (!navLinks) return;
            addMobileBackdrop(nav, navLinks);

            navLinks.innerHTML = `
                <div class="nav-sidebar-head">
                    <div class="nav-brand" aria-label="Sport Society Overview">
                        <span class="nav-brand-kicker">Sport Society</span><strong class="nav-brand-name">Overview</strong><strong class="nav-brand-short" aria-hidden="true">SSO</strong>
                    </div>
                    <button type="button" class="nav-mobile-close" data-mobile-nav-close aria-label="Navigatie sluiten" title="Navigatie sluiten">×</button>
                    <button type="button" class="nav-collapse-button" data-sidebar-collapse aria-expanded="true"><span data-collapse-icon aria-hidden="true">‹</span></button>
                </div>
                ${navigationGroup('general', 'Algemeen', '⌂',
                    navigationItem('index.html', '⌂', 'Home') + navigationItem('roster.html', '▦', 'Rooster'))}
                ${navigationGroup('operational', 'Operationeel', '◫',
                    navigationItem('staffing.html', '◫', 'Bezettingsanalyse', 'manager') +
                    navigationItem('staffing-standards.html', '⚙', 'Bezettingsstandaarden', 'manager') +
                    navigationItem('cml.html', '↔', 'Roosterwijzigingen', 'manager'), 'manager')}
                ${navigationGroup('management', 'Management', '◷',
                    navigationItem('hours.html', '◷', 'Urenanalyse &amp; urenbank', 'manager'), 'manager')}
                ${navigationGroup('admin', 'Admin', '◆',
                    navigationItem('employee-settings.html', '♙', 'Medewerkers', 'admin') +
                    navigationItem('cf.html', '＋', 'Wijziging registreren', 'admin') +
                    navigationItem('dashboard.html', '◇', 'Preview &amp; integratiestatus', 'admin') +
                    navigationItem('create.html', '◎', 'Accounts', 'admin'), 'admin')}
                <div class="nav-spacer" aria-hidden="true"></div>
                ${navigationGroup('account', 'Account', '●',
                    navigationItem('login.html', '●', 'Inloggen', 'guest', 'data-auth-entry'))}
            `;

            const page = currentPage();
            navLinks.querySelector(`a[href="${page}"]`)?.setAttribute('aria-current', 'page');
            navLinks.querySelector('[data-sidebar-collapse]')?.addEventListener('click', toggleDesktopSidebar);
            navLinks.querySelector('[data-mobile-nav-close]')?.addEventListener('click', () => closeMobileNavigation(nav));
            navLinks.querySelectorAll('a[href]').forEach((link) => link.addEventListener('click', () => closeMobileNavigation(nav)));
            initializeGroups(navLinks);
            closeMobileNavigation(nav);
        });
        applySidebarState();
    }

    async function fetchAuthState() {
        try {
            const response = await fetch('/api/access/me');
            if (!response.ok) throw new Error('Sessie kon niet worden opgehaald.');
            currentAuthState = await response.json();
        } catch (error) {
            console.error(error);
            currentAuthState = { authenticated: false, role: 'guest', user: null };
        }
        if (currentAuthState.authenticated) localStorage.setItem('demoRole', currentAuthState.role);
        else localStorage.removeItem('demoRole');
        window.currentAuthState = currentAuthState;
        return currentAuthState;
    }

    function setNavigationLinkLabel(link, label) {
        const element = link.querySelector('.nav-item-label');
        if (element) element.textContent = label;
        link.title = label;
    }

    function createLogoutLink(navLinks) {
        const container = navLinks.querySelector('[data-nav-group="account"] .nav-group-items');
        if (!container || container.querySelector('[data-auth-logout]')) return;
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'nav-item nav-logout-link';
        link.dataset.authLogout = '';
        link.innerHTML = '<span class="nav-item-icon" aria-hidden="true">↪</span><span class="nav-item-label">Uitloggen</span>';
        link.addEventListener('click', async (event) => {
            event.preventDefault();
            try { await fetch('/api/auth/logout', { method: 'POST' }); }
            finally {
                localStorage.removeItem('demoRole');
                window.location.href = 'login.html';
            }
        });
        container.appendChild(link);
    }

    function applyRoleVisibility(authState) {
        document.querySelectorAll('[data-min-role]').forEach((element) => {
            element.hidden = !roleAllows(authState.role, element.dataset.minRole);
        });
        document.querySelectorAll('[data-admin-only], [data-admin-content]').forEach((element) => {
            element.hidden = authState.role !== 'admin';
        });
        document.querySelectorAll('[data-manager-only]').forEach((element) => {
            element.hidden = !roleAllows(authState.role, 'manager');
        });
        document.querySelectorAll('[data-nav-group]').forEach((group) => {
            const visibleItems = [...group.querySelectorAll('.nav-item')].some((item) => !item.hidden);
            group.hidden = !roleAllows(authState.role, group.dataset.minRole || 'guest') || !visibleItems;
        });
    }

    function updateAuthNavigation(authState) {
        document.querySelectorAll('[data-auth-entry]').forEach((link) => {
            link.href = 'login.html';
            const label = authState.authenticated
                ? (authState.user?.displayName || authState.user?.username || 'Account')
                : 'Inloggen';
            setNavigationLinkLabel(link, label);
            link.setAttribute('aria-label', authState.authenticated ? `Account van ${label}` : 'Inloggen');
        });
        document.querySelectorAll('.nav-links').forEach((navLinks) => {
            if (authState.authenticated) createLogoutLink(navLinks);
        });
        applyRoleVisibility(authState);
    }

    async function createPageIsBootstrap() {
        if (currentPage() !== 'create.html') return false;
        try {
            const response = await fetch('/api/auth/setup-status');
            const payload = await response.json();
            return Boolean(payload.needsBootstrap);
        } catch {
            return false;
        }
    }

    async function protectCurrentPage(authState) {
        const page = currentPage();
        const minimumRole = PAGE_ACCESS[page] || 'guest';
        if (minimumRole === 'guest' || roleAllows(authState.role, minimumRole)) return true;
        if (page === 'create.html' && await createPageIsBootstrap()) return true;
        if (!authState.authenticated) {
            window.location.replace(`login.html?next=${encodeURIComponent(page)}`);
        } else {
            window.location.replace('index.html');
        }
        return false;
    }

    desktopSidebarQuery.addEventListener?.('change', () => {
        applySidebarState();
        if (desktopSidebarQuery.matches) document.querySelectorAll('nav').forEach(closeMobileNavigation);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') document.querySelectorAll('nav').forEach(closeMobileNavigation);
    });

    document.addEventListener('DOMContentLoaded', async () => {
        buildNavigation();
        const authState = await fetchAuthState();
        updateAuthNavigation(authState);
        const accessible = await protectCurrentPage(authState);
        if (!accessible) return;
        document.dispatchEvent(new CustomEvent('authready', { detail: authState }));
    });
})();
