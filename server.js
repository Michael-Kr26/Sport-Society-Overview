const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'sport-society.db');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

app.use(cors());
app.use(express.json());
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

app.listen(PORT, () => {
    console.log(`Sport Society Overview draait op http://localhost:${PORT}`);
});