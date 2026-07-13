const currentDemoRole = localStorage.getItem('demoRole') || 'guest';
const isDemoAdmin = currentDemoRole === 'admin';

function updateAuthNavigation() {
    document.querySelectorAll('[data-auth-entry]').forEach((link) => {
        if (isDemoAdmin) {
            link.href = 'cf.html';
            link.textContent = 'ChangeForm';
            link.setAttribute('aria-label', 'Open het wijzigingsformulier');
            return;
        }

        link.href = 'login.html';
        link.textContent = 'Inloggen';
        link.setAttribute('aria-label', 'Inloggen');
    });

    document.querySelectorAll('[data-admin-only]').forEach((element) => {
        element.hidden = !isDemoAdmin;
    });

    document.querySelectorAll('[data-admin-content]').forEach((element) => {
        element.hidden = !isDemoAdmin;
    });
}

function protectAdminPage() {
    if (!document.body.hasAttribute('data-admin-page') || isDemoAdmin) {
        return;
    }

    const nextPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'cf.html');
    window.location.replace(`login.html?next=${nextPage}`);
}

document.addEventListener('DOMContentLoaded', () => {
    updateAuthNavigation();
    protectAdminPage();
});
