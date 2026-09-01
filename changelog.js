(() => {
    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

    async function loadRelease() {
        try {
            const response = await fetch('/release.json');
            const release = await response.json();
            if (!response.ok) throw new Error(release.message || 'Releasegegevens konden niet worden geladen.');

            byId('release-title').textContent = release.title || 'Sport Society Overview';
            byId('release-summary').textContent = `Versie ${release.version} staat op kanaal ${release.channel} en is ${release.status}.`;
            byId('release-version').textContent = `v${release.version}`;
            byId('release-status').textContent = release.status || 'onbekend';
            byId('release-branch').textContent = release.branch || 'branch onbekend';
            byId('release-highlights').innerHTML = (release.highlights || [])
                .map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Geen vervolgstappen vastgelegd.</li>';
        } catch (error) {
            byId('release-summary').textContent = error.message;
            byId('release-summary').classList.add('changelog-state');
            byId('release-version').textContent = 'Versie onbekend';
            byId('release-status').textContent = 'niet beschikbaar';
            byId('release-branch').textContent = 'release.json kon niet worden gelezen';
        }
    }

    document.addEventListener('DOMContentLoaded', loadRelease, { once: true });
})();
