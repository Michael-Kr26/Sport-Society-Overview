'use strict';

require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const r8 = require('./r8-operations-bootstrap');
const r7 = require('./r7-access-bootstrap');
const {
    createMonthlyExport,
    currentAmsterdamMonth,
    exportHistory,
    monthsTouchedByWeeks,
    recordDelivery
} = require('./lib/roster-export');
const { createGraphRosterExporter } = require('./lib/roster-export-graph');

const app = r8.app;
if (!app) throw new Error('Express-app kon niet worden gekoppeld aan R9 export.');

const DB_PATH = path.join(__dirname, 'data', 'sport-society.db');
const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 5000);

// R9 wordt vóór serverstart expliciet gemigreerd. Runtime gebruikt daarna
// alleen het bestaande schema en start geen tweede migratieverbinding.
const ready = Promise.resolve();

function all(sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function apiError(res, error, fallback) {
    console.error(error);
    if (res.headersSent) return;
    res.status(error.status || 500).json({
        message: error.status ? error.message : fallback,
        code: error.code || null,
        details: error.details || null
    });
}

function exportRoute(handler, { adminOnly = false } = {}) {
    return async (req, res) => {
        try {
            await ready;
            const user = await r7.authenticatedUser(req);
            if (!user) return res.status(401).json({ message: 'Log eerst in.' });
            if (!['manager', 'admin'].includes(user.role)) {
                return res.status(403).json({ message: 'Je hebt geen toegang tot roosterexports.' });
            }
            if (adminOnly && user.role !== 'admin') {
                return res.status(403).json({ message: 'Alleen een admin kan roosterexports naar SharePoint sturen.' });
            }
            return await handler(req, res, user);
        } catch (error) {
            apiError(res, error, 'De roosterexport kon niet worden verwerkt.');
        }
    };
}

async function uploadExport(exportData) {
    const graph = createGraphRosterExporter();
    try {
        const result = await graph.upload({
            buffer: exportData.buffer,
            fileName: exportData.fileName,
            month: exportData.month,
            currentMonth: currentAmsterdamMonth()
        });
        await recordDelivery(db, exportData.exportId, {
            channel: 'sharepoint_archive',
            status: 'success',
            remoteDriveId: result.archive.driveId,
            remoteItemId: result.archive.itemId,
            remoteName: result.archive.name,
            details: {
                rootFolderId: result.root.itemId,
                rootFolderName: result.root.name,
                remotePath: result.archive.remotePath,
                archivePath: result.archive.archivePath
            }
        });
        if (result.current.status === 'success') {
            await recordDelivery(db, exportData.exportId, {
                channel: 'sharepoint_current',
                status: 'success',
                remoteDriveId: result.current.driveId,
                remoteItemId: result.current.itemId,
                remoteName: result.current.name,
                details: {
                    rootFolderId: result.root.itemId,
                    rootFolderName: result.root.name,
                    remotePath: result.current.remotePath
                }
            });
        } else {
            await recordDelivery(db, exportData.exportId, {
                channel: 'sharepoint_current',
                status: 'skipped',
                remoteDriveId: result.root.driveId,
                remoteItemId: result.root.itemId,
                remoteName: result.current.remotePath,
                details: {
                    reason: result.current.reason,
                    currentMonth: currentAmsterdamMonth(),
                    rootFolderName: result.root.name,
                    remotePath: result.current.remotePath
                }
            });
        }
        return result;
    } catch (error) {
        await recordDelivery(db, exportData.exportId, {
            channel: 'sharepoint_archive',
            status: 'failed',
            errorMessage: error.message,
            details: error.details || null
        }).catch(() => {});
        throw error;
    }
}

app.get('/api/roster-export/month', exportRoute(async (req, res, user) => {
    const result = await createMonthlyExport(db, { month: String(req.query.month || ''), actorUserId: user.id });
    await recordDelivery(db, result.exportId, { channel: 'download', status: 'success' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('X-SSO-Export-Id', String(result.exportId));
    res.setHeader('X-SSO-Export-Checksum', result.checksumSha256);
    res.send(result.buffer);
}));

app.post('/api/roster-export/sharepoint', exportRoute(async (req, res, user) => {
    const result = await createMonthlyExport(db, { month: String(req.body?.month || ''), actorUserId: user.id });
    const upload = await uploadExport(result);
    res.status(201).json({
        exportId: result.exportId,
        exportUid: result.exportUid,
        month: result.month,
        fileName: result.fileName,
        checksumSha256: result.checksumSha256,
        upload
    });
}, { adminOnly: true }));

app.post('/api/roster-export/sharepoint/from-versions', exportRoute(async (req, res, user) => {
    const versionIds = [...new Set((Array.isArray(req.body?.versionIds) ? req.body.versionIds : []).map(Number).filter(Number.isInteger))];
    if (!versionIds.length) return res.status(400).json({ message: 'Geen gepubliceerde versies opgegeven.' });
    const placeholders = versionIds.map(() => '?').join(',');
    const rows = await all(`SELECT DISTINCT p.week_start AS weekStart
        FROM roster_versions v
        INNER JOIN roster_periods p ON p.id=v.period_id
        WHERE v.id IN (${placeholders}) AND v.state='published'
        ORDER BY p.week_start`, versionIds);
    const months = monthsTouchedByWeeks(rows.map((row) => row.weekStart));
    const results = [];
    for (const month of months) {
        try {
            const generated = await createMonthlyExport(db, { month, actorUserId: user.id });
            const upload = await uploadExport(generated);
            results.push({ month, status: 'uploaded', exportId: generated.exportId, fileName: generated.fileName, upload });
        } catch (error) {
            if (error.code === 'ROSTER_EXPORT_INCOMPLETE') {
                results.push({ month, status: 'skipped_incomplete', message: error.message, details: error.details });
                continue;
            }
            results.push({ month, status: 'failed', message: error.message, code: error.code || null });
        }
    }
    res.status(207).json({ versionIds, months, results });
}, { adminOnly: true }));

app.get('/api/roster-export/history', exportRoute(async (req, res) => {
    res.json({ items: await exportHistory(db, { limit: Number(req.query.limit || 30) }) });
}, { adminOnly: true }));

module.exports = {
    app,
    db,
    ready,
    uploadExport
};