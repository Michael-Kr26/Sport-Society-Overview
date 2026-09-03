'use strict';

const { ClientSecretCredential } = require('@azure/identity');

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

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

    async function resolveCurrentTarget(token) {
        const driveId = String(env.GRAPH_DRIVE_ID || '').trim();
        const itemId = String(env.GRAPH_ITEM_ID || '').trim();
        if (driveId && itemId) {
            const metadata = await graphJson(
                fetchImpl,
                `${GRAPH_ROOT}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,parentReference`,
                token
            );
            return {
                driveId,
                itemId,
                name: metadata?.name || 'Rooster.xlsx',
                parentReference: metadata?.parentReference || null
            };
        }
        const shareLink = String(env.GRAPH_SHARE_LINK || '').trim();
        if (!shareLink) throw new Error('Vul GRAPH_DRIVE_ID + GRAPH_ITEM_ID of GRAPH_SHARE_LINK in .env in.');
        const shareId = encodeSharingUrl(shareLink);
        const metadata = await graphJson(
            fetchImpl,
            `${GRAPH_ROOT}/shares/${shareId}/driveItem?$select=id,name,parentReference`,
            token
        );
        const resolvedDriveId = metadata?.parentReference?.driveId;
        if (!metadata?.id || !resolvedDriveId) throw new Error('Graph share-link kon niet naar drive/item worden herleid.');
        return {
            driveId: resolvedDriveId,
            itemId: metadata.id,
            name: metadata.name || 'Rooster.xlsx',
            parentReference: metadata.parentReference || null
        };
    }

    async function uploadCurrent(target, token, buffer) {
        const item = await graphBinary(
            fetchImpl,
            `${GRAPH_ROOT}/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(target.itemId)}/content`,
            token,
            buffer
        );
        return {
            driveId: target.driveId,
            itemId: item.id || target.itemId,
            name: item.name || target.name
        };
    }

    async function uploadArchive(target, token, buffer, fileName) {
        const archivePath = String(env.GRAPH_ROSTER_ARCHIVE_PATH || 'Rooster Archief').trim() || 'Rooster Archief';
        const remotePath = `${encodeGraphPath(archivePath)}/${encodeURIComponent(fileName)}`;
        const item = await graphBinary(
            fetchImpl,
            `${GRAPH_ROOT}/drives/${encodeURIComponent(target.driveId)}/root:/${remotePath}:/content`,
            token,
            buffer
        );
        return {
            driveId: target.driveId,
            itemId: item.id || null,
            name: item.name || fileName,
            archivePath
        };
    }

    async function upload({ buffer, fileName, month, currentMonth }) {
        const token = await accessToken();
        const target = await resolveCurrentTarget(token);
        const archive = await uploadArchive(target, token, buffer, fileName);
        let current = { status: 'skipped', reason: 'not_current_calendar_month' };
        if (month === currentMonth) {
            current = { status: 'success', ...(await uploadCurrent(target, token, buffer)) };
        }
        return { target, archive: { status: 'success', ...archive }, current };
    }

    return {
        accessToken,
        resolveCurrentTarget,
        upload
    };
}

module.exports = {
    GRAPH_ROOT,
    createGraphRosterExporter,
    encodeGraphPath,
    encodeSharingUrl
};
