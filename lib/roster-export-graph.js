'use strict';

const { ClientSecretCredential } = require('@azure/identity');

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const DEFAULT_CURRENT_PATH = 'Actueel/Rooster.xlsx';
const DEFAULT_ARCHIVE_PATH = 'Archief';

function required(env, name) {
    const value = String(env[name] || '').trim();
    if (!value) throw new Error(`Ontbrekende .env waarde: ${name}`);
    return value;
}

function encodeSharingUrl(sharingUrl) {
    const base64Value = Buffer.from(String(sharingUrl).trim(), 'utf8')
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `u!${base64Value}`;
}

function encodeGraphPath(value) {
    return String(value || '')
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join('/');
}

async function graphJson(fetchImpl, url, accessToken, options = {}) {
    const response = await fetchImpl(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers || {})
        }
    });
    const text = await response.text().catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
        const error = new Error(`Microsoft Graph request mislukt (${response.status}).`);
        error.status = response.status;
        error.details = payload;
        throw error;
    }
    return payload;
}

async function graphBinary(fetchImpl, url, accessToken, buffer) {
    const response = await fetchImpl(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        },
        body: buffer
    });
    const text = await response.text().catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
        const error = new Error(`Microsoft Graph upload mislukt (${response.status}).`);
        error.status = response.status;
        error.details = payload;
        throw error;
    }
    return payload || {};
}

function createGraphRosterExporter({ env = process.env, fetchImpl = global.fetch, tokenProvider = null } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is niet beschikbaar voor Microsoft Graph.');

    async function accessToken() {
        if (tokenProvider) return tokenProvider();
        const credential = new ClientSecretCredential(
            required(env, 'MICROSOFT_TENANT_ID'),
            required(env, 'MICROSOFT_CLIENT_ID'),
            required(env, 'MICROSOFT_CLIENT_SECRET')
        );
        const token = await credential.getToken(GRAPH_SCOPE);
        if (!token?.token) throw new Error('Geen Microsoft Graph access token ontvangen.');
        return token.token;
    }

    function assertFolder(metadata) {
        if (!metadata?.id) throw new Error('Graph rooster-root kon niet worden herleid.');
        if (!metadata.folder) {
            throw new Error('De R9 Graph-doellocatie moet een gedeelde map zijn, geen bestand.');
        }
        return metadata;
    }

    async function resolveExportRoot(token) {
        const driveId = String(env.GRAPH_ROSTER_ROOT_DRIVE_ID || '').trim();
        const itemId = String(env.GRAPH_ROSTER_ROOT_ITEM_ID || '').trim();
        if (driveId && itemId) {
            const metadata = assertFolder(await graphJson(
                fetchImpl,
                `${GRAPH_ROOT}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,parentReference,folder`,
                token
            ));
            return {
                driveId,
                itemId: metadata.id,
                name: metadata.name || 'Rooster',
                parentReference: metadata.parentReference || null
            };
        }

        const shareLink = String(env.GRAPH_ROSTER_ROOT_SHARE_LINK || '').trim();
        if (!shareLink) {
            throw new Error('Vul GRAPH_ROSTER_ROOT_SHARE_LINK of GRAPH_ROSTER_ROOT_DRIVE_ID + GRAPH_ROSTER_ROOT_ITEM_ID in .env in.');
        }
        const shareId = encodeSharingUrl(shareLink);
        const metadata = assertFolder(await graphJson(
            fetchImpl,
            `${GRAPH_ROOT}/shares/${shareId}/driveItem?$select=id,name,parentReference,folder`,
            token
        ));
        const resolvedDriveId = metadata?.parentReference?.driveId;
        if (!resolvedDriveId) throw new Error('Graph rooster-root bevat geen drive-id.');
        return {
            driveId: resolvedDriveId,
            itemId: metadata.id,
            name: metadata.name || 'Rooster',
            parentReference: metadata.parentReference || null
        };
    }

    async function uploadRelative(root, token, buffer, relativePath) {
        const encodedPath = encodeGraphPath(relativePath);
        const item = await graphBinary(
            fetchImpl,
            `${GRAPH_ROOT}/drives/${encodeURIComponent(root.driveId)}/items/${encodeURIComponent(root.itemId)}:/${encodedPath}:/content`,
            token,
            buffer
        );
        return {
            driveId: root.driveId,
            itemId: item.id || null,
            name: item.name || relativePath.split('/').pop(),
            remotePath: relativePath
        };
    }

    async function uploadCurrent(root, token, buffer) {
        const currentPath = String(env.GRAPH_ROSTER_CURRENT_PATH || DEFAULT_CURRENT_PATH).trim() || DEFAULT_CURRENT_PATH;
        return uploadRelative(root, token, buffer, currentPath);
    }

    async function uploadArchive(root, token, buffer, fileName) {
        const archivePath = String(env.GRAPH_ROSTER_ARCHIVE_PATH || DEFAULT_ARCHIVE_PATH).trim() || DEFAULT_ARCHIVE_PATH;
        const remotePath = `${archivePath.replace(/\/+$/, '')}/${fileName}`;
        const item = await uploadRelative(root, token, buffer, remotePath);
        return { ...item, archivePath };
    }

    async function upload({ buffer, fileName, month, currentMonth }) {
        const token = await accessToken();
        const root = await resolveExportRoot(token);
        const archive = await uploadArchive(root, token, buffer, fileName);
        const currentPath = String(env.GRAPH_ROSTER_CURRENT_PATH || DEFAULT_CURRENT_PATH).trim() || DEFAULT_CURRENT_PATH;
        let current = { status: 'skipped', reason: 'not_current_calendar_month', remotePath: currentPath };
        if (month === currentMonth) {
            current = { status: 'success', ...(await uploadCurrent(root, token, buffer)) };
        }
        return { root, target: root, archive: { status: 'success', ...archive }, current };
    }

    return {
        accessToken,
        resolveExportRoot,
        upload
    };
}

module.exports = {
    DEFAULT_ARCHIVE_PATH,
    DEFAULT_CURRENT_PATH,
    GRAPH_ROOT,
    createGraphRosterExporter,
    encodeGraphPath,
    encodeSharingUrl
};
