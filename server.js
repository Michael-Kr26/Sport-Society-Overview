const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

const allowedStatuses = ['Open', 'In behandeling', 'Afgerond'];

function userCanUpdateStatus(req) {
    const demoRole = req.header('X-Demo-Role');

    return demoRole === 'admin';
}

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'sport-society.db');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

app.use(cors());
app.use(express.json());

app.use('/data/imports', (req, res) => {
    res.status(403).json({
        message: 'Importbestanden zijn niet publiek toegankelijk.'
    });
});

app.use(express.static(__dirname));

const db = new sqlite3.Database(dbPath, (error) => {
    if (error) {
        console.error('Database kon niet worden geopend:', error.message);
        return;
    }

    console.log('Database verbonden:', dbPath);
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            change_date TEXT NOT NULL,
            reported_date TEXT NOT NULL,
            location TEXT NOT NULL,
            employee_1 TEXT NOT NULL,
            employee_2 TEXT,
            change_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

app.post('/api/changes', (req, res) => {
    const {
        date,
        reportedDate,
        location,
        employee,
        employee2,
        type,
        reason,
        status,
        createdBy
    } = req.body;

    if (!date || !reportedDate || !location || !employee || !type || !status || !createdBy) {
        return res.status(400).json({
            message: 'Niet alle verplichte velden zijn ingevuld.'
        });
    }

    const query = `
        INSERT INTO changes (
            change_date,
            reported_date,
            location,
            employee_1,
            employee_2,
            change_type,
            reason,
            status,
            created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        date,
        reportedDate,
        location,
        employee,
        employee2 || '',
        type,
        reason || '',
        status,
        createdBy
    ];

    db.run(query, values, function (error) {
        if (error) {
            console.error('Wijziging kon niet worden opgeslagen:', error.message);

            return res.status(500).json({
                message: 'Wijziging kon niet worden opgeslagen.'
            });
        }

        res.status(201).json({
            message: 'Wijziging opgeslagen.',
            id: this.lastID
        });
    });
});

app.get('/api/changes', (req, res) => {
    const { name, month, location, type, status } = req.query;

    let query = `
        SELECT
            id,
            change_date AS date,
            reported_date AS reportedDate,
            location,
            employee_1 AS employee,
            employee_2 AS employee2,
            change_type AS type,
            reason,
            status,
            created_by AS createdBy,
            created_at AS createdAt
        FROM changes
        WHERE 1 = 1
    `;

    const values = [];

    if (name) {
        query += `
            AND (
                LOWER(employee_1) LIKE LOWER(?)
                OR LOWER(employee_2) LIKE LOWER(?)
            )
        `;

        values.push(`%${name}%`, `%${name}%`);
    }

    if (month) {
        query += `
            AND substr(change_date, 6, 2) = ?
        `;

        values.push(month);
    }

    if (location) {
        query += `
            AND location = ?
        `;

        values.push(location);
    }

    if (type) {
        query += `
            AND change_type = ?
        `;

        values.push(type);
    }

    if (status) {
        query += `
            AND status = ?
        `;

        values.push(status);
    }

    query += `
        ORDER BY
            CASE
                WHEN date(change_date) >= date('now') THEN 0
                ELSE 1
            END,
            CASE
                WHEN date(change_date) >= date('now') THEN date(change_date)
            END ASC,
            CASE
                WHEN date(change_date) < date('now') THEN date(change_date)
            END DESC,
            created_at DESC,
            id DESC
        LIMIT 200
    `;

    db.all(query, values, (error, rows) => {
        if (error) {
            console.error('Roosterwijzigingen konden niet worden opgehaald:', error.message);

            return res.status(500).json({
                message: 'Roosterwijzigingen konden niet worden opgehaald.'
            });
        }

        res.json(rows);
    });
});

app.patch('/api/changes/:id/status', (req, res) => {
    if (!userCanUpdateStatus(req)) {
        return res.status(403).json({
            message: 'Alleen admins mogen statussen aanpassen.'
        });
    }

    const changeId = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(changeId) || changeId <= 0) {
        return res.status(400).json({
            message: 'Ongeldig wijziging-ID.'
        });
    }

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            message: 'Ongeldige status.'
        });
    }

    const query = `
        UPDATE changes
        SET status = ?
        WHERE id = ?
    `;

    db.run(query, [status, changeId], function (error) {
        if (error) {
            console.error('Status kon niet worden aangepast:', error.message);

            return res.status(500).json({
                message: 'Status kon niet worden aangepast.'
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({
                message: 'Wijziging niet gevonden.'
            });
        }

        res.json({
            message: 'Status bijgewerkt.',
            id: changeId,
            status
        });
    });
});

app.get('/api/changes/latest', (req, res) => {
    const query = `
        SELECT
            id,
            change_date AS date,
            reported_date AS reportedDate,
            location,
            employee_1 AS employee,
            employee_2 AS employee2,
            change_type AS type,
            reason,
            status,
            created_by AS createdBy,
            created_at AS createdAt
        FROM changes
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `;

    db.get(query, [], (error, row) => {
        if (error) {
            console.error('Laatste wijziging kon niet worden opgehaald:', error.message);

            return res.status(500).json({
                message: 'Laatste wijziging kon niet worden opgehaald.'
            });
        }

        if (!row) {
            return res.status(404).json({
                message: 'Geen wijzigingen gevonden.'
            });
        }

        res.json(row);
    });
});

app.get('/api/roster-preview', (req, res) => {
    const previewPath = path.join(__dirname, 'data', 'imports', 'roster-preview.json');

    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({
            message: 'Nog geen rooster-preview gevonden. Draai eerst npm run import:roster.'
        });
    }

    fs.readFile(previewPath, 'utf8', (error, fileContent) => {
        if (error) {
            console.error('Rooster-preview kon niet worden gelezen:', error.message);

            return res.status(500).json({
                message: 'Rooster-preview kon niet worden gelezen.'
            });
        }

        try {
            const previewData = JSON.parse(fileContent);

            res.json(previewData);
        } catch (parseError) {
            console.error('Rooster-preview bevat geen geldige JSON:', parseError.message);

            res.status(500).json({
                message: 'Rooster-preview bevat geen geldige JSON.'
            });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Sport Society Overview draait op http://localhost:${PORT}`);
});