const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const currentDemoRole = localStorage.getItem('demoRole') || 'guest';
const nextPage = new URLSearchParams(window.location.search).get('next');

function showDevelopmentAccess() {
    if (currentDemoRole !== 'admin') {
        return;
    }

    const adminAccess = document.getElementById('login-admin-access');
    const adminLink = document.getElementById('login-admin-link');

    adminAccess.hidden = false;
    adminLink.href = nextPage === 'cf.html' ? 'cf.html' : 'cf.html';
}

loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();

    loginStatus.textContent = 'De echte loginbackend is nog niet gekoppeld. Dit scherm is alvast voorbereid voor de volgende ontwikkelstap.';
});

document.addEventListener('DOMContentLoaded', showDevelopmentAccess);
