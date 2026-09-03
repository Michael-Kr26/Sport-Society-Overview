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
    const ROLE_LABEL = { guest: 'Gast', employee: 'Medewerker', manager: 'Manager', admin: 'Admin' };
    const PAGE_ACCESS = {
        'index.html': 'guest',
        'roster.html': 'employee',
        'planner.html': 'admin',
        'help.html': 'guest',
        'changelog.html': 'guest',
        'login.html': 'guest',
        'staffing.html': 'manager',
        'staffing-standards.html': 'manager',
        'cml.html': 'manager',
        'hours.html': 'manager',
        'visitors.html': 'manager',
        'healthplanner.html': 'manager',
        'employee-settings.html': 'admin',
        'employee.html': 'admin',
        'cf.html': 'admin',
        'dashboard.html': 'admin',
        'create.html': 'admin'
    };
    const PAGE_META = {
        'index.html': { title: 'Home', crumbs: ['Algemeen', 'Home'] },
        'roster.html': { title: 'Rooster', crumbs: ['Algemeen', 'Rooster'] },
        'planner.html': { title: 'Planner', crumbs: ['Operationeel', 'Planner'] },
        'changelog.html': { title: 'Changelog', crumbs: ['Algemeen', 'Changelog'] },
        'help.html': { title: 'Handleiding', crumbs: ['Algemeen', 'Handleiding'] },
        'staffing.html': { title: 'Bezettingsanalyse', crumbs: ['Operationeel', 'Bezettingsanalyse'] },
        'staffing-standards.html': { title: 'Bezettingsstandaarden', crumbs: ['Operationeel', 'Bezettingsstandaarden'] },
        'cml.html': { title: 'Roosterwijzigingen', crumbs: ['Operationeel', 'Roosterwijzigingen'] },
        'hours.html': { title: 'Urenanalyse & urenbank', crumbs: ['Management', 'Urenanalyse & urenbank'] },
        'visitors.html': { title: 'Bezoekersfrequentie', crumbs: ['Management', 'Bezoekersfrequentie'] },
        'healthplanner.html': { title: 'HealthPlanner', crumbs: ['Management', 'HealthPlanner'] },
        'employee-settings.html': { title: 'Medewerkers', crumbs: ['Admin', 'Medewerkers'] },
        'employee.html': { title: 'Medewerkerinstellingen', crumbs: ['Admin', { label: 'Medewerkers', href: 'employee-settings.html' }, 'Medewerker'] },
        'cf.html': { title: 'Wijziging registreren', crumbs: ['Admin', 'Wijziging registreren'] },
        'dashboard.html': { title: 'Import & datakwaliteit', crumbs: ['Admin', 'Import & datakwaliteit'] },
        'create.html': { title: 'Accounts', crumbs: ['Admin', 'Accounts'] },
        'login.html': { title: 'Inloggen', crumbs: [] }
    };
    const SIDEBAR_STORAGE_KEY = 'sso_sidebar_collapsed';
    const GROUP_STORAGE_PREFIX = 'sso_nav_group_';
    const desktopSidebarQuery = window.matchMedia('(min-width: 901px)');
    let currentAuthState = { authenticated: false, role: 'guest', user: null };

    const roleAllows = (role, minimumRole) => (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minimumRole] || 0);
    const currentPage = () => window.location.pathname.split('/').pop() || 'index.html';
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    function ensureStylesheet(href) {
        if (document.querySelector(`link[href^="${href}"]`)) return;
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = `${href}?v=20260903-low-fatigue-v2`;
        document.head.appendChild(stylesheet);
    }

    function icon(name) {
        const paths = {
            home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
            calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
            list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
            help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 4.3 1.45c-.9.9-2.1 1.2-2.1 2.55M12 17h.01"/>',
            chart: '<path d="M4 20V10M9 20V4M14 20v-7M19 20V7"/><path d="M2 20h20"/>',
            settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
            swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="m18 7 3 3-3 3M6 17l-3-3 3-3"/>',
            clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
            plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
            database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
            account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
            logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6"/>'
        };
        return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.list}</svg>`;
    }

    function navigationItem(href, iconName, label, minimumRole = 'guest', attributes = '') {
        return `<a class="nav-item" href="${href}" title="${escapeHtml(label)}" data-min-role="${minimumRole}" ${attributes}>
            <span class="nav-item-icon" aria-hidden="true">${icon(iconName)}</span>
            <span class="nav-item-label">${label}</span>
        </a>`;
    }

    function navigationGroup(id, label, items, minimumRole = 'guest') {
        return `<section class="nav-group" data-nav-group="${id}" data-min-role="${minimumRole}">
            <button type="button" class="nav-group-toggle" data-nav-group-toggle aria-expanded="true">
                <span class="nav-group-label">${label}</span>
                <span class="nav-group-chevron" aria-hidden="true">⌄</span>
            </button>
            <div class="nav-group-items">${items}</div>
        </section>`;
    }

    function setMobileNavigationOpen(nav, open) {
        const toggle = nav?.querySelector('#nav-toggle');
        if (!toggle) return;
        toggle.checked = Boolean(open);
        document.body.classList.toggle('mobile-navigation-open', Boolean(open));
        nav.querySelector('.nav-toggle-label')?.setAttribute('aria-expanded', String(Boolean(open)));
    }

    function closeMobileNavigation(nav) {
        setMobileNavigationOpen(nav, false);
    }

    function updateCollapseButton(button, collapsed) {
        if (!button) return;
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? 'Navigatie uitklappen' : 'Navigatie inklappen');
        const iconElement = button.querySelector('[data-collapse-icon]');
        if (iconElement) iconElement.textContent = collapsed ? '›' : '‹';
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

    function setGroupCollapsed(group, collapsed, persist = true) {
        const id = group.dataset.navGroup;
        group.classList.toggle('is-collapsed', collapsed);
        group.querySelector('[data-nav-group-toggle]')?.setAttribute('aria-expanded', String(!collapsed));
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
        if (backdrop) return;
        backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.className = 'nav-backdrop';
        backdrop.setAttribute('aria-label', 'Navigatie sluiten');
        backdrop.addEventListener('click', () => closeMobileNavigation(nav));
        nav.insertBefore(backdrop, navLinks);
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
            toggleLabel?.setAttribute('aria-label', 'Navigatie openen of sluiten');
            toggleLabel?.setAttribute('aria-expanded', 'false');
            toggle?.addEventListener('change', () => setMobileNavigationOpen(nav, toggle.checked));

            const navLinks = nav.querySelector('.nav-links');
            if (!navLinks) return;
            addMobileBackdrop(nav, navLinks);
            navLinks.innerHTML = `
                <div class="nav-sidebar-head">
                    <a class="nav-brand" href="index.html" aria-label="Sport Society Overview">
                        <span class="nav-brand-mark" aria-hidden="true">SS</span>
                        <span class="nav-brand-line">Sport Society</span>
                        <span class="nav-brand-line nav-brand-line--secondary">Overview</span>
                    </a>
                    <button type="button" class="nav-mobile-close" data-mobile-nav-close aria-label="Navigatie sluiten">×</button>
                    <button type="button" class="nav-collapse-button" data-sidebar-collapse aria-expanded="true"><span data-collapse-icon aria-hidden="true">‹</span></button>
                </div>
                ${navigationGroup('general', 'Algemeen',
                    navigationItem('index.html', 'home', 'Home') +
                    navigationItem('roster.html', 'calendar', 'Rooster', 'employee') +
                    navigationItem('changelog.html', 'list', 'Changelog') +
                    navigationItem('help.html', 'help', 'Handleiding'))}
                ${navigationGroup('operational', 'Operationeel',
                    navigationItem('planner.html', 'calendar', 'Planner', 'admin') +
                    navigationItem('staffing.html', 'chart', 'Bezettingsanalyse', 'manager') +
                    navigationItem('staffing-standards.html', 'settings', 'Bezettingsstandaarden', 'manager') +
                    navigationItem('cml.html', 'swap', 'Roosterwijzigingen', 'manager'), 'manager')}
                ${navigationGroup('management', 'Management',
                    navigationItem('hours.html', 'clock', 'Urenanalyse &amp; urenbank', 'manager') +
                    navigationItem('visitors.html', 'chart', 'Bezoekersfrequentie', 'manager') +
                    navigationItem('healthplanner.html', 'list', 'HealthPlanner', 'manager'), 'manager')}
                ${navigationGroup('admin', 'Admin',
                    navigationItem('employee-settings.html', 'users', 'Medewerkers', 'admin') +
                    navigationItem('cf.html', 'plus', 'Wijziging registreren', 'admin') +
                    navigationItem('dashboard.html', 'database', 'Import &amp; datakwaliteit', 'admin') +
                    navigationItem('create.html', 'account', 'Accounts', 'admin'), 'admin')}
                <div class="nav-spacer" aria-hidden="true"></div>
                <div class="nav-account" data-nav-account hidden>
                    <button type="button" class="nav-account-button" data-nav-account-button aria-expanded="false">
                        <span class="nav-account-avatar" data-nav-account-avatar>?</span>
                        <span class="nav-account-name" data-nav-account-name>Account</span>
                        <span class="nav-account-role" data-nav-account-role></span>
                        <span class="nav-account-chevron" aria-hidden="true">⌄</span>
                    </button>
                    <div class="nav-account-menu" data-nav-account-menu hidden>
                        <a href="#" class="nav-item" data-auth-logout>
                            <span class="nav-item-icon">${icon('logout')}</span>
                            <span class="nav-item-label">Uitloggen</span>
                        </a>
                    </div>
                </div>
                <div class="nav-login-link" data-nav-login>
                    ${navigationItem('login.html', 'account', 'Inloggen')}
                </div>
            `;

            navLinks.querySelector(`a[href="${currentPage()}"]`)?.setAttribute('aria-current', 'page');
            navLinks.querySelector('[data-sidebar-collapse]')?.addEventListener('click', toggleDesktopSidebar);
            navLinks.querySelector('[data-mobile-nav-close]')?.addEventListener('click', () => closeMobileNavigation(nav));
            navLinks.querySelectorAll('a[href]').forEach((link) => link.addEventListener('click', () => closeMobileNavigation(nav)));
            navLinks.querySelector('[data-nav-account-button]')?.addEventListener('click', () => {
                const menu = navLinks.querySelector('[data-nav-account-menu]');
                const button = navLinks.querySelector('[data-nav-account-button]');
                const open = menu?.hidden !== false;
                if (menu) menu.hidden = !open;
                button?.setAttribute('aria-expanded', String(open));
            });
            navLinks.querySelector('[data-auth-logout]')?.addEventListener('click', logout);
            initializeGroups(navLinks);
            closeMobileNavigation(nav);
        });
        applySidebarState();
    }

    async function logout(event) {
        event?.preventDefault();
        try { await fetch('/api/auth/logout', { method: 'POST' }); }
        finally {
            localStorage.removeItem('demoRole');
            window.location.href = 'login.html';
        }
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

    function initials(value) {
        const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return parts.slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('nl-NL');
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
        document.querySelectorAll('[data-nav-account]').forEach((account) => {
            account.hidden = !authState.authenticated;
            const displayName = authState.user?.displayName || authState.user?.username || 'Account';
            const name = account.querySelector('[data-nav-account-name]');
            const role = account.querySelector('[data-nav-account-role]');
            const avatar = account.querySelector('[data-nav-account-avatar]');
            if (name) name.textContent = displayName;
            if (role) role.textContent = ROLE_LABEL[authState.role] || authState.role;
            if (avatar) avatar.textContent = initials(displayName);
        });
        document.querySelectorAll('[data-nav-login]').forEach((login) => { login.hidden = authState.authenticated; });
        applyRoleVisibility(authState);
    }

    function renderBreadcrumbs(crumbs = []) {
        if (!crumbs.length) return '';
        return `<div class="sso-breadcrumbs" aria-label="Broodkruimelpad">${crumbs.map((crumb, index) => {
            const item = typeof crumb === 'string' ? { label: crumb } : crumb;
            const content = item.href
                ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
                : `<span>${escapeHtml(item.label)}</span>`;
            const separator = index < crumbs.length - 1 ? '<span class="sso-breadcrumb-separator" aria-hidden="true">›</span>' : '';
            return `${content}${separator}`;
        }).join('')}</div>`;
    }

    function setPageHeader({ title, crumbs = [], action = null } = {}) {
        const header = document.querySelector('body > header');
        if (!header) return;
        header.className = 'sso-page-header';
        header.innerHTML = `
            <div class="sso-page-heading">
                <h1 class="sso-page-title">${escapeHtml(title || 'Sport Society Overview')}</h1>
                ${renderBreadcrumbs(crumbs)}
            </div>
            ${action?.href ? `<a class="sso-button sso-button--secondary" href="${escapeHtml(action.href)}">${escapeHtml(action.label || 'Terug')}</a>` : ''}
        `;
    }

    function initializePageHeader() {
        const meta = PAGE_META[currentPage()] || { title: 'Sport Society Overview', crumbs: [] };
        setPageHeader(meta);
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
        if (!authState.authenticated) window.location.replace(`login.html?next=${encodeURIComponent(page)}`);
        else window.location.replace('index.html');
        return false;
    }

    window.ssoPageHeader = { set: setPageHeader };

    desktopSidebarQuery.addEventListener?.('change', () => {
        applySidebarState();
        if (desktopSidebarQuery.matches) document.querySelectorAll('nav').forEach(closeMobileNavigation);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            document.querySelectorAll('nav').forEach(closeMobileNavigation);
            document.querySelectorAll('[data-nav-account-menu]').forEach((menu) => { menu.hidden = true; });
            document.querySelectorAll('[data-nav-account-button]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-nav-account]')) return;
        document.querySelectorAll('[data-nav-account-menu]').forEach((menu) => { menu.hidden = true; });
        document.querySelectorAll('[data-nav-account-button]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    });

    document.addEventListener('DOMContentLoaded', async () => {
        initializePageHeader();
        buildNavigation();
        const authState = await fetchAuthState();
        updateAuthNavigation(authState);
        const accessible = await protectCurrentPage(authState);
        if (!accessible) return;
        document.dispatchEvent(new CustomEvent('authready', { detail: authState }));
    });
})();
