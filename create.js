const createForm = document.getElementById('create-account-form');
const createTitle = document.getElementById('create-title');
const createIntro = document.getElementById('create-intro');
const createStatus = document.getElementById('create-status');
const createRole = document.getElementById('create-role');
const createRoleLabel = document.getElementById('create-role-label');
const createLocation = document.getElementById('create-location');
const createLocationLabel = document.getElementById('create-location-label');
const accountListCard = document.getElementById('account-list-card');
const accountList = document.getElementById('account-list');
const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
let bootstrapMode = false;
let users = [];

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function formatDate(value) {
    if (!value) return 'Nog nooit';
    const parsed = new Date(String(value).endsWith('Z') ? value : `${value}Z`);
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('nl-NL', {
        dateStyle: 'medium', timeStyle: 'short'
    }).format(parsed);
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || 'Actie kon niet worden uitgevoerd.');
        error.status = response.status;
        throw error;
    }
    return data;
}

function locationOptions(selected = '') {
    return `<option value="">Geen vaste vestiging</option>${LOCATIONS.map((location) =>
        `<option value="${location}" ${location === selected ? 'selected' : ''}>${location}</option>`
    ).join('')}`;
}

function roleOptions(selected) {
    return ['employee', 'manager', 'admin'].map((role) =>
        `<option value="${role}" ${role === selected ? 'selected' : ''}>${role[0].toUpperCase()}${role.slice(1)}</option>`
    ).join('');
}

function applyLocationRule(roleSelect, locationSelect) {
    const isAdmin = roleSelect.value === 'admin';
    locationSelect.disabled = isAdmin;
    locationSelect.required = roleSelect.value === 'manager';
    if (isAdmin) locationSelect.value = '';
}

function accountItem(user) {
    return `<form class="account-item account-edit-form" data-user-id="${user.id}">
        <div class="account-identity">
            <strong>${escapeHtml(user.displayName)}</strong>
            <span class="account-username">@${escapeHtml(user.username)}</span>
            <span class="account-login">Laatste login: ${escapeHtml(formatDate(user.lastLoginAt))}</span>
        </div>
        <label>Weergavenaam<input name="displayName" type="text" maxlength="80" value="${escapeHtml(user.displayName)}" required></label>
        <label>Rol<select name="role">${roleOptions(user.role)}</select></label>
        <label>Vestiging<select name="location">${locationOptions(user.location || '')}</select></label>
        <label>Nieuw wachtwoord<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Ongewijzigd laten"></label>
        <label class="account-active"><input name="isActive" type="checkbox" ${user.isActive ? 'checked' : ''}> Account actief</label>
        <button type="submit" class="admin-button">Account opslaan</button>
    </form>`;
}

function bindAccountForms() {
    accountList.querySelectorAll('[data-user-id]').forEach((form) => {
        const roleSelect = form.elements.role;
        const locationSelect = form.elements.location;
        applyLocationRule(roleSelect, locationSelect);
        roleSelect.addEventListener('change', () => applyLocationRule(roleSelect, locationSelect));
        form.addEventListener('submit', saveAccount);
    });
}

function renderAccounts() {
    accountListCard.hidden = false;
    accountList.innerHTML = users.length
        ? users.map(accountItem).join('')
        : '<p class="empty-state">Nog geen accounts gevonden.</p>';
    bindAccountForms();
}

async function loadAccounts() {
    const payload = await fetchJson('/api/access/users');
    users = payload.users || [];
    renderAccounts();
}

async function initializeCreatePage() {
    try {
        const [setupStatus, authState] = await Promise.all([
            fetchJson('/api/auth/setup-status'),
            fetchJson('/api/access/me')
        ]);
        bootstrapMode = setupStatus.needsBootstrap;
        if (bootstrapMode) {
            createTitle.textContent = 'Eerste adminaccount';
            createIntro.textContent = 'Er bestaan nog geen accounts. Maak eenmalig het eerste adminaccount aan.';
            createRole.value = 'admin';
            createRoleLabel.hidden = true;
            createLocationLabel.hidden = true;
            createForm.hidden = false;
            return;
        }
        if (!authState.authenticated || authState.role !== 'admin') {
            window.location.replace('login.html?next=create.html');
            return;
        }
        createTitle.textContent = 'Account aanmaken';
        createIntro.textContent = 'Maak een Employee-, Manager- of Adminaccount aan. Managers moeten aan één vestiging worden gekoppeld.';
        createRoleLabel.hidden = false;
        createLocationLabel.hidden = false;
        createForm.hidden = false;
        applyLocationRule(createRole, createLocation);
        await loadAccounts();
    } catch (error) {
        console.error(error);
        createStatus.textContent = error.message || 'Accountbeheer kon niet worden geladen.';
    }
}

async function saveAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
    createStatus.textContent = 'Account bijwerken...';
    try {
        await fetchJson(`/api/access/users/${encodeURIComponent(form.dataset.userId)}`, {
            method: 'PATCH',
            body: JSON.stringify({
                displayName: data.get('displayName'),
                role: data.get('role'),
                location: data.get('location') || null,
                password: data.get('password') || '',
                isActive: data.get('isActive') === 'on'
            })
        });
        createStatus.textContent = 'Account bijgewerkt.';
        await loadAccounts();
    } catch (error) {
        createStatus.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

createRole?.addEventListener('change', () => applyLocationRule(createRole, createLocation));
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
        const endpoint = bootstrapMode ? '/api/auth/bootstrap' : '/api/access/users';
        const result = await fetchJson(endpoint, {
            method: 'POST',
            body: JSON.stringify({ username, displayName, password, role, location: createLocation.value || null })
        });
        createForm.reset();
        createStatus.textContent = `${result.user.displayName} is aangemaakt als ${result.user.role}.`;
        if (bootstrapMode) {
            window.location.href = 'index.html';
            return;
        }
        applyLocationRule(createRole, createLocation);
        await loadAccounts();
    } catch (error) {
        console.error(error);
        createStatus.textContent = error.message || 'Account kon niet worden aangemaakt.';
    } finally {
        submitButton.disabled = false;
    }
});

document.addEventListener('DOMContentLoaded', initializeCreatePage);
