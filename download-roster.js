const fs = require('fs');
const path = require('path');
const { ClientSecretCredential } = require('@azure/identity');

require('dotenv').config();

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

const outputPath = process.argv[2] || path.join(__dirname, 'data', 'imports', 'live-rooster.xlsx');

function getRequiredEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Ontbrekende .env waarde: ${name}`);
    }

    return value;
}

function encodeSharingUrl(sharingUrl) {
    const base64Value = Buffer.from(sharingUrl, 'utf8')
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `u!${base64Value}`;
}

function getGraphDownloadUrl() {
    const driveId = process.env.GRAPH_DRIVE_ID;
    const itemId = process.env.GRAPH_ITEM_ID;
    const shareLink = process.env.GRAPH_SHARE_LINK;

    if (driveId && itemId) {
        return `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
    }

    if (shareLink) {
        const shareId = encodeSharingUrl(shareLink);

        return `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`;
    }

    throw new Error('Vul GRAPH_DRIVE_ID + GRAPH_ITEM_ID of GRAPH_SHARE_LINK in .env in.');
}

async function getAccessToken() {
    const tenantId = getRequiredEnv('MICROSOFT_TENANT_ID');
    const clientId = getRequiredEnv('MICROSOFT_CLIENT_ID');
    const clientSecret = getRequiredEnv('MICROSOFT_CLIENT_SECRET');

    const credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret
    );

    const token = await credential.getToken(GRAPH_SCOPE);

    if (!token || !token.token) {
        throw new Error('Geen Microsoft Graph access token ontvangen.');
    }

    return token.token;
}

async function downloadRoster() {
    const accessToken = await getAccessToken();
    const downloadUrl = getGraphDownloadUrl();

    console.log('Live rooster downloaden via Microsoft Graph...');
    console.log(`Output: ${outputPath}`);

    const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');

        throw new Error([
            `Graph download mislukt.`,
            `Status: ${response.status}`,
            `Response: ${errorText}`
        ].join('\n'));
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    fs.mkdirSync(path.dirname(outputPath), {
        recursive: true
    });

    fs.writeFileSync(outputPath, fileBuffer);

    console.log('Live rooster succesvol gedownload.');
    console.log(`Bestandsgrootte: ${fileBuffer.length} bytes`);
}

downloadRoster().catch((error) => {
    console.error(error.message);
    process.exit(1);
});