const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

const ARCHIVE_AFTER_DAYS = 7;
const ARCHIVED_PAGE_SIZE = 20;
const allowedStatuses = ['Open', 'In behandeling', 'Afgerond', 'Archived'];
const allowedLocations = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'sport-society.db');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, {
        recursive: true
    });
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

function userCanUpdateStatus(req) {
    const demoRole = req.header('X-Demo-Role');

    return demoRole === 'admin';
}

function parsePositiveInteger(value, fallback) {
    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        return fallback;
    }

    return parsedValue;
}

function isIsoDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
        return false;
    }

    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime());
}

function addDaysToIsoDate(dateString, days) {
    const parts = String(dateString || '').split('-').map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return null;
    }

    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);

    date.setDate(date.getDate() + days);

    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
    const nextDay = String(date.getDate()).padStart(2, '0');

    return `${nextYear}-${nextMonth}-${nextDay}`;
}

function insertFocusWeek(weeks, focusWeekStart) {
    if (!focusWeekStart) {
        return weeks;
    }

    const weekAlreadyExists = weeks.some((week) => week.weekStart === focusWeekStart);

    if (weekAlreadyExists) {
        return weeks;
    }

    const focusWeekEnd = addDaysToIsoDate(focusWeekStart, 6);

    if (!focusWeekEnd) {
        return weeks;
    }

    return [
        ...weeks,
        {
            weekStart: focusWeekStart,
            weekEnd: focusWeekEnd,
            weekItemCount: 0
        }
    ].sort((firstWeek, secondWeek) => secondWeek.weekStart.localeCompare(firstWeek.weekStart));
}

function archiveOldCompletedChanges(callback = () => {}) {
    const query = `
        UPDATE changes
        SET status = 'Archived'
        WHERE status = 'Afgerond'
          AND date(change_date) <= date('now', 'localtime', '-' || ? || ' days')
    `;

    db.run(query, [ARCHIVE_AFTER_DAYS], function (error) {
        if (error) {
            console.error('Wijzigingen konden niet automatisch worden gearchiveerd:', error.message);
            callback(error);
            return;
        }

        callback(null, this.changes);
    });
}

function runWithArchive(res, callback) {
    archiveOldCompletedChanges((archiveError) => {
        if (archiveError) {
            return res.status(500).json({
                message: 'Wijzigingen konden niet automatisch worden gearchiveerd.'
            });
        }

        callback();
    });
}

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
            reason TEXT,
            status TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS roster_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL,
            source_file TEXT,
            source_url TEXT,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL,
            items_found INTEGER NOT NULL DEFAULT 0,
            changes_detected INTEGER NOT NULL DEFAULT 0,
            error_message TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS roster_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER,
            roster_date TEXT NOT NULL,
            day_name TEXT,
            employee_name TEXT NOT NULL,
            source_slot_employee TEXT,
            item_type TEXT NOT NULL,
            location TEXT,
            start_time TEXT,
            end_time TEXT,
            status TEXT NOT NULL,
            note TEXT,
            source_sheet TEXT,
            source_cell TEXT,
            source_hash TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (import_id) REFERENCES roster_imports(id)
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

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            message: 'Ongeldige status.'
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
    runWithArchive(res, () => {
        const {
            name,
            focusWeekStart,
            month,
            location,
            type,
            status
        } = req.query;

        const requestedPage = parsePositiveInteger(req.query.page, 1);
        const weekStartExpression = `date(change_date, '-' || ((CAST(strftime('%w', change_date) AS INTEGER) + 6) % 7) || ' days')`;

        let whereQuery = `
            FROM changes
            WHERE 1 = 1
        `;

        const values = [];

        if (name) {
            whereQuery += `
                AND (
                    LOWER(employee_1) LIKE LOWER(?)
                    OR LOWER(employee_2) LIKE LOWER(?)
                )
            `;

            values.push(`%${name}%`, `%${name}%`);
        }

        if (month) {
            whereQuery += `
                AND substr(change_date, 6, 2) = ?
            `;

            values.push(month);
        }

        if (location) {
            whereQuery += `
                AND location = ?
            `;

            values.push(location);
        }

        if (type) {
            whereQuery += `
                AND change_type = ?
            `;

            values.push(type);
        }

        if (status) {
            whereQuery += `
                AND status = ?
            `;

            values.push(status);
        } else {
            whereQuery += `
                AND status != 'Archived'
            `;
        }

        if (status === 'Archived') {
            const countQuery = `
                SELECT COUNT(*) AS totalItems
                ${whereQuery}
            `;

            db.get(countQuery, values, (countError, countRow) => {
                if (countError) {
                    console.error('Gearchiveerde roosterwijzigingen konden niet worden geteld:', countError.message);

                    return res.status(500).json({
                        message: 'Gearchiveerde roosterwijzigingen konden niet worden opgehaald.'
                    });
                }

                const totalItems = countRow ? countRow.totalItems : 0;
                const totalPages = Math.max(1, Math.ceil(totalItems / ARCHIVED_PAGE_SIZE));
                const page = Math.min(requestedPage, totalPages);
                const offset = (page - 1) * ARCHIVED_PAGE_SIZE;

                if (totalItems === 0) {
                    return res.json({
                        items: [],
                        pagination: {
                            mode: 'archive',
                            page: 1,
                            totalPages: 1,
                            totalItems: 0,
                            pageSize: ARCHIVED_PAGE_SIZE,
                            weekStart: null,
                            weekEnd: null
                        }
                    });
                }

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
                    ${whereQuery}
                    ORDER BY
                        change_date DESC,
                        created_at DESC,
                        id DESC
                    LIMIT ? OFFSET ?
                `;

                db.all(query, [...values, ARCHIVED_PAGE_SIZE, offset], (error, rows) => {
                    if (error) {
                        console.error('Gearchiveerde roosterwijzigingen konden niet worden opgehaald:', error.message);

                        return res.status(500).json({
                            message: 'Gearchiveerde roosterwijzigingen konden niet worden opgehaald.'
                        });
                    }

                    res.json({
                        items: rows,
                        pagination: {
                            mode: 'archive',
                            page,
                            totalPages,
                            totalItems,
                            pageSize: ARCHIVED_PAGE_SIZE,
                            weekStart: null,
                            weekEnd: null
                        }
                    });
                });
            });

            return;
        }

        const weeksQuery = `
            SELECT
                weekStart,
                date(weekStart, '+6 days') AS weekEnd,
                COUNT(*) AS weekItemCount
            FROM (
                SELECT ${weekStartExpression} AS weekStart
                ${whereQuery}
            )
            GROUP BY weekStart
            ORDER BY weekStart DESC
        `;

        db.all(weeksQuery, values, (weeksError, weekRows) => {
            if (weeksError) {
                console.error('Wijzigingsweken konden niet worden opgehaald:', weeksError.message);

                return res.status(500).json({
                    message: 'Roosterwijzigingen konden niet worden opgehaald.'
                });
            }

            const weeks = insertFocusWeek(weekRows || [], focusWeekStart);

            if (weeks.length === 0) {
                return res.json({
                    items: [],
                    pagination: {
                        mode: 'week',
                        page: 1,
                        totalPages: 1,
                        totalWeeks: 0,
                        totalItems: 0,
                        weekStart: null,
                        weekEnd: null
                    }
                });
            }

            const totalPages = weeks.length;
            const focusWeekIndex = focusWeekStart
                ? weeks.findIndex((week) => week.weekStart === focusWeekStart)
                : -1;
            const page = focusWeekIndex >= 0
                ? focusWeekIndex + 1
                : Math.min(requestedPage, totalPages);
            const selectedWeek = weeks[page - 1];

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
                ${whereQuery}
                  AND ${weekStartExpression} = ?
                ORDER BY
                    change_date DESC,
                    created_at DESC,
                    id DESC
            `;

            db.all(query, [...values, selectedWeek.weekStart], (error, rows) => {
                if (error) {
                    console.error('Roosterwijzigingen konden niet worden opgehaald:', error.message);

                    return res.status(500).json({
                        message: 'Roosterwijzigingen konden niet worden opgehaald.'
                    });
                }

                res.json({
                    items: rows,
                    pagination: {
                        mode: 'week',
                        page,
                        totalPages,
                        totalWeeks: totalPages,
                        totalItems: selectedWeek.weekItemCount,
                        weekStart: selectedWeek.weekStart,
                        weekEnd: selectedWeek.weekEnd
                    }
                });
            });
        });
    });
});

app.get('/api/changes/latest', (req, res) => {
    runWithArchive(res, () => {
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
            WHERE status != 'Archived'
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

app.patch('/api/changes/:id', (req, res) => {
    if (!userCanUpdateStatus(req)) {
        return res.status(403).json({
            message: 'Alleen admins mogen roosterwijzigingen aanpassen.'
        });
    }

    const changeId = Number(req.params.id);
    const {
        date,
        location,
        employee,
        employee2,
        reason
    } = req.body;

    const normalizedDate = String(date || '').trim();
    const normalizedLocation = String(location || '').trim();
    const normalizedEmployee = String(employee || '').trim();
    const normalizedEmployee2 = String(employee2 || '').trim();
    const normalizedReason = String(reason || '').trim();

    if (!Number.isInteger(changeId) || changeId <= 0) {
        return res.status(400).json({
            message: 'Ongeldig wijziging-ID.'
        });
    }

    if (!normalizedDate || !normalizedLocation || !normalizedEmployee) {
        return res.status(400).json({
            message: 'Datum, locatie en medewerker 1 zijn verplicht.'
        });
    }

    if (!isIsoDateString(normalizedDate)) {
        return res.status(400).json({
            message: 'Ongeldige datum.'
        });
    }

    if (!allowedLocations.includes(normalizedLocation)) {
        return res.status(400).json({
            message: 'Ongeldige locatie.'
        });
    }

    const query = `
        UPDATE changes
        SET
            change_date = ?,
            location = ?,
            employee_1 = ?,
            employee_2 = ?,
            reason = ?
        WHERE id = ?
    `;

    const values = [
        normalizedDate,
        normalizedLocation,
        normalizedEmployee,
        normalizedEmployee2,
        normalizedReason,
        changeId
    ];

    db.run(query, values, function (error) {
        if (error) {
            console.error('Wijziging kon niet worden aangepast:', error.message);

            return res.status(500).json({
                message: 'Wijziging kon niet worden aangepast.'
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({
                message: 'Wijziging niet gevonden.'
            });
        }

        res.json({
            message: 'Wijziging bijgewerkt.',
            id: changeId
        });
    });
});

app.delete('/api/changes/:id', (req, res) => {
    if (!userCanUpdateStatus(req)) {
        return res.status(403).json({
            message: 'Alleen admins mogen roosterwijzigingen verwijderen.'
        });
    }

    const changeId = Number(req.params.id);

    if (!Number.isInteger(changeId) || changeId <= 0) {
        return res.status(400).json({
            message: 'Ongeldig wijziging-ID.'
        });
    }

    const query = `
        DELETE FROM changes
        WHERE id = ?
    `;

    db.run(query, [changeId], function (error) {
        if (error) {
            console.error('Wijziging kon niet worden verwijderd:', error.message);

            return res.status(500).json({
                message: 'Wijziging kon niet worden verwijderd.'
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({
                message: 'Wijziging niet gevonden.'
            });
        }

        res.json({
            message: 'Wijziging verwijderd.',
            id: changeId
        });
    });
});

app.get('/api/roster', (req, res) => {
    const {
        name,
        location,
        type,
        status,
        from,
        to
    } = req.query;

    let query = `
        SELECT
            id,
            import_id AS importId,
            roster_date AS rosterDate,
            day_name AS dayName,
            employee_name AS employeeName,
            source_slot_employee AS sourceSlotEmployee,
            item_type AS itemType,
            location,
            start_time AS startTime,
            end_time AS endTime,
            status,
            note,
            source_sheet AS sourceSheet,
            source_cell AS sourceCell,
            source_hash AS sourceHash,
            created_at AS createdAt
        FROM roster_items
        WHERE 1 = 1
    `;

    const values = [];

    if (name) {
        query += `
            AND (
                LOWER(employee_name) LIKE LOWER(?)
                OR employee_name = 'ALL'
            )
        `;

        values.push(`%${name}%`);
    }

    if (location) {
        query += `
            AND location = ?
        `;

        values.push(location);
    }

    if (type) {
        query += `
            AND item_type = ?
        `;

        values.push(type);
    }

    if (status) {
        query += `
            AND status = ?
        `;

        values.push(status);
    }

    if (from) {
        query += `
            AND date(roster_date) >= date(?)
        `;

        values.push(from);
    }

    if (to) {
        query += `
            AND date(roster_date) <= date(?)
        `;

        values.push(to);
    }

    query += `
        ORDER BY
            CASE
                WHEN date(roster_date) >= date('now') THEN 0
                ELSE 1
            END,
            CASE
                WHEN date(roster_date) >= date('now') THEN date(roster_date)
            END ASC,
            CASE
                WHEN date(roster_date) < date('now') THEN date(roster_date)
            END DESC,
            start_time ASC,
            employee_name ASC
        LIMIT 10000
    `;

    db.all(query, values, (error, rows) => {
        if (error) {
            console.error('Rooster kon niet worden opgehaald:', error.message);

            return res.status(500).json({
                message: 'Rooster kon niet worden opgehaald.'
            });
        }

        res.json(rows);
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
