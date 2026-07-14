const createForm = document.getElementById('create-account-form');
const createTitle = document.getElementById('create-title');
const createIntro = document.getElementById('create-intro');
const createStatus = document.getElementById('create-status');
const createRole = document.getElementById('create-role');
const createRoleLabel = document.getElementById('create-role-label');
const accountListCard = document.getElementById('account-list-card');
const accountList = document.getElementById('account-list');

let bootstrapMode = false;

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || 'Actie kon niet worden uitgevoerd.');
    }

    return data;
}

async function loadAccounts() {
    const users = await fetchJson('/api/users');

    accountListCard.hidden = false;

    if (!users.length) {
        accountList.innerHTML = '<p class="empty-state">Nog geen accounts gevonden.</p>';
        return;
    }

    accountList.innerHTML = users.map((user) => `
        <article class="account-item">
            <div>
                <strong>${escapeHtml(user.displayName)}</strong>
                <span class="account-username">@${escapeHtml(user.username)}</span>
            </div>
            <span class="account-role">${escapeHtml(user.role)}</span>
        </article>
    `).join('');
}

async function initializeCreatePage() {
    try {
        const [setupStatus, authState] = await Promise.all([
            fetchJson('/api/auth/setup-status'),
            fetchJson('/api/auth/me')
        ]);

        bootstrapMode = setupStatus.needsBootstrap;

        if (bootstrapMode) {
            createTitle.textContent = 'Eerste adminaccount';
            createIntro.textContent = 'Er bestaan nog geen accounts. Maak hier eenmalig het eerste adminaccount aan.';
            createRole.value = 'admin';
            createRoleLabel.hidden = true;
            createForm.hidden = false;
            return;
        }

        if (!authState.authenticated || authState.role !== 'admin') {
            window.location.replace('login.html?next=create.html');
            return;
        }

        createTitle.textContent = 'Account aanmaken';
        createIntro.textContent = 'Maak een employee-, manager- of adminaccount aan. Deze pagina staat niet in de navigatie.';
        createRoleLabel.hidden = false;
        createForm.hidden = false;
        await loadAccounts();
    } catch (error) {
        console.error(error);
        createStatus.textContent = error.message || 'Accountbeheer kon niet worden geladen.';
    }
}

createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = createForm.querySelector('button[type="submit"]');
    const username = document.getElementById('create-username').value.trim();
    const displayName = document.getElementById('create-display-name').value.trim();
    const password = document.getElementById('create-password').value;
    const passwordConfirm = document.getElementById('create-password-confirm').value;
    const role = bootstrapMode ? 'admin' : createRole.value;

    if (password !== passwordConfirm) {
        createStatus.textContent = 'De wachtwoorden zijn niet gelijk.';
        return;
    }

    submitButton.disabled = true;
    createStatus.textContent = 'Account aanmaken...';

    try {
        const endpoint = bootstrapMode ? '/api/auth/bootstrap' : '/api/users';
        const result = await fetchJson(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                displayName,
                password,
                role
            })
        });

        localStorage.setItem('demoRole', result.user.role);
        createForm.reset();
        createStatus.textContent = `${result.user.displayName} is aangemaakt als ${result.user.role}.`;

        if (bootstrapMode) {
            window.location.href = 'cf.html';
            return;
        }

        await loadAccounts();
    } catch (error) {
        console.error(error);
        createStatus.textContent = error.message || 'Account kon niet worden aangemaakt.';
    } finally {
        submitButton.disabled = false;
    }
});

document.addEventListener('DOMContentLoaded', initializeCreatePage);
