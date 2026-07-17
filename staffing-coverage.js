(() => {
    const commonLocationWindows = [
        { days: [1, 2, 3, 4], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { days: [1, 2, 3, 4], start: '16:00', end: '21:30', label: 'Avonddienst' },
        { days: [5], start: '07:00', end: '12:00', label: 'Ochtenddienst' },
        { days: [6], start: '08:30', end: '12:00', label: 'Ochtenddienst' }
    ];
    const standardShiftWindows = {
        Barneveld: commonLocationWindows,
        Voorthuizen: commonLocationWindows,
        Wekerom: commonLocationWindows,
        Achterveld: [
            ...commonLocationWindows,
            { days: [0], start: '08:30', end: '12:00', label: 'Zondagsdienst' }
        ],
        Harskamp: [
            { days: [1, 2, 3, 4], start: '08:30', end: '12:00', label: 'Ochtenddienst' },
            { days: [1, 2, 3, 4], start: '16:00', end: '21:00', label: 'Avonddienst' },
            { days: [5, 6], start: '08:30', end: '12:00', label: 'Ochtenddienst' }
        ]
    };
    let defaultSixWeekRangeApplied = false;

    function shiftsForDate(location, dateString) {
        const day = parseDate(dateString).getDay();
        return (standardShiftWindows[location] || [])
            .filter((window) => window.days.includes(day))
            .map((window) => ({
                ...window,
                startMinutes: timeToMinutes(window.start),
                endMinutes: timeToMinutes(window.end)
            }));
    }

    function activeStandardShift(location, dateString, start, end) {
        return shiftsForDate(location, dateString).find((window) => (
            window.startMinutes < end && window.endMinutes > start
        )) || null;
    }

    function formatLocationSchedule(location) {
        if (location === 'Harskamp') {
            return 'ma–do 08:30–12:00 en 16:00–21:00 · vr–za 08:30–12:00';
        }
        const sunday = location === 'Achterveld' ? ' · zo 08:30–12:00' : '';
        return `ma–do 07:00–12:00 en 16:00–21:30 · vr 07:00–12:00 · za 08:30–12:00${sunday}`;
    }

    getRuleState = function getRuleStateWithStandardShifts(location, dateString, start, end, activeLessons) {
        const date = parseDate(dateString);
        const month = date.getMonth() + 1;
        const eveningState = getEveningState(dateString, start, end);
        const locationRule = standards.locations[location] || DEFAULT_STANDARDS.locations[location];
        const singleWindow = getSingleCoverageWindow(location, dateString, start, end);
        const standardShift = activeStandardShift(location, dateString, start, end);
        let hardMinimum = 1;
        let advisedMinimum = 1;
        const suppressLessonVulnerability = Boolean(singleWindow);
        const reasons = [];

        if (standardShift) {
            reasons.push(`Vaste standaarddienst: ${standardShift.start}–${standardShift.end}.`);
            if (singleWindow) {
                reasons.push(`Uitzondering: ${singleWindow.label}.`);
            } else {
                advisedMinimum = 2;
                reasons.push('Enkele bezetting wordt binnen een standaarddienst als kwetsbaar gemarkeerd.');
            }
        } else if (singleWindow) {
            reasons.push(`Uitzondering: ${singleWindow.label}.`);
        }

        if (eveningState.active) {
            hardMinimum = Math.max(hardMinimum, standards.eveningPeak.minimum);
            advisedMinimum = Math.max(advisedMinimum, standards.eveningPeak.minimum);
            reasons.push(`Harde avondnorm: ${standards.eveningPeak.minimum} medewerkers van ${standards.eveningPeak.start} tot ${standards.eveningPeak.end}.`);
        }

        if (activeLessons.length) {
            reasons.push(`Reguliere groepsles actief: ${activeLessons.map((lesson) => lesson.name).join(', ')}.`);

            if (!singleWindow) {
                const excluded = locationRule.excludedMonths.includes(month);
                if (excluded) {
                    reasons.push(`Lesregel voor ${location} is in deze maand uitgesloten.`);
                } else if (locationRule.lessonMode === 'hard') {
                    hardMinimum = Math.max(hardMinimum, locationRule.lessonMinimum);
                    advisedMinimum = Math.max(advisedMinimum, locationRule.lessonMinimum);
                    reasons.push(`${location}: tijdens een reguliere groepsles minimaal ${locationRule.lessonMinimum} medewerkers.`);
                } else if (locationRule.lessonMode === 'advice') {
                    advisedMinimum = Math.max(advisedMinimum, locationRule.lessonMinimum);
                    reasons.push(`${location}: tijdens een reguliere groepsles worden ${locationRule.lessonMinimum} medewerkers geadviseerd.`);
                }

                if (activeLessons.length > 1) {
                    advisedMinimum = Math.max(advisedMinimum, activeLessons.length + 1);
                    reasons.push(`${activeLessons.length} lessen overlappen; extra operationele capaciteit overwegen.`);
                }
            }

            const threshold = standards.lessonDemand.highParticipantThreshold;
            const highDemand = activeLessons.some((lesson) => (
                lesson.waitlist > 0
                || lesson.registered >= lesson.capacity
                || lesson.registered >= threshold
            ));
            if (highDemand) {
                reasons.push(`Hoge lesdruk: volle les, wachtlijst of minimaal ${threshold} deelnemers.`);
            }
        }

        return {
            hardMinimum,
            advisedMinimum,
            reasons,
            isEveningPeak: eveningState.active,
            singleWindow,
            standardShift,
            suppressLessonVulnerability
        };
    };

    analyzeDateLocation = function analyzeDateLocationWithStandardShifts(dateString, location) {
        const lessons = getLessons(location, dateString);
        const standardShifts = shiftsForDate(location, dateString);
        const boundaries = new Set();
        const evening = standards.eveningPeak;
        const day = parseDate(dateString).getDay();

        standardShifts.forEach((window) => {
            boundaries.add(window.startMinutes);
            boundaries.add(window.endMinutes);
        });

        if (evening.enabled && evening.days.includes(day)) {
            boundaries.add(timeToMinutes(evening.start));
            boundaries.add(timeToMinutes(evening.end));
        }

        lessons.forEach((lesson) => {
            boundaries.add(timeToMinutes(lesson.start));
            boundaries.add(timeToMinutes(lesson.end));
        });

        rosterItems
            .filter((item) => item.itemType === 'shift' && item.location === location && item.rosterDate === dateString)
            .forEach((item) => {
                const start = timeToMinutes(item.startTime);
                const end = timeToMinutes(item.endTime);
                if (start !== null) boundaries.add(start);
                if (end !== null) boundaries.add(end);
            });

        const sorted = [...boundaries].filter(Number.isFinite).sort((a, b) => a - b);
        const rows = [];

        for (let index = 0; index < sorted.length - 1; index += 1) {
            const start = sorted[index];
            const end = sorted[index + 1];
            if (end <= start) continue;

            const activeLessons = lessons.filter((lesson) => (
                timeToMinutes(lesson.start) < end && timeToMinutes(lesson.end) > start
            ));
            const eveningState = getEveningState(dateString, start, end);
            const standardShift = activeStandardShift(location, dateString, start, end);
            if (!standardShift && !eveningState.active && activeLessons.length === 0) continue;

            const employees = getShiftEmployees(location, dateString, start, end);
            const rule = getRuleState(location, dateString, start, end, activeLessons);
            const fullOrWaitlist = activeLessons.some((lesson) => lesson.waitlist > 0 || lesson.registered >= lesson.capacity);
            let status = 'sufficient';

            if (employees.length < rule.hardMinimum) {
                status = 'under';
            } else if (employees.length < rule.advisedMinimum) {
                status = 'vulnerable';
            } else if (
                standards.lessonDemand.markFullOrWaitlistVulnerable
                && fullOrWaitlist
                && !rule.suppressLessonVulnerability
            ) {
                status = 'vulnerable';
            }

            rows.push({
                date: dateString,
                location,
                start,
                end,
                employees,
                activeLessons,
                status,
                ...rule
            });
        }

        return rows;
    };

    renderRulesSummary = function renderRulesSummaryWithStandardShifts() {
        const evening = standards.eveningPeak;
        const exceptionCount = LOCATIONS.reduce(
            (total, location) => total + (standards.locations[location]?.singleCoverageWindows?.length || 0),
            0
        );
        const locationRules = LOCATIONS.filter((location) => standards.locations[location]?.lessonMode !== 'none');

        activeRulesGrid.innerHTML = `
            <article><strong>Standaarddiensten</strong><p>Vaste dienstvensters per locatie. Zonder medewerker is het blok onderbezet; met één medewerker kwetsbaar.</p></article>
            <article><strong>Avondpiek</strong><p>${evening.enabled ? `${evening.start}–${evening.end}, minimum ${evening.minimum} medewerkers.` : 'Uitgeschakeld.'}</p></article>
            <article><strong>Groepslesregels</strong><p>${locationRules.length ? locationRules.map((location) => `${location}: ${standards.locations[location].lessonMode === 'hard' ? 'harde norm' : 'advies'}`).join(' · ') : 'Geen extra lesregels actief.'}</p></article>
            <article><strong>Enkele bezetting toegestaan</strong><p>${exceptionCount} vastgelegde uitzonderingsvenster(s). Binnen zo'n venster geldt één medewerker als voldoende, tenzij een harde avondnorm actief is.</p></article>
            <article><strong>Reformer Pilates</strong><p>Volledig uitgesloten van deze bezettingsanalyse.</p></article>
        `;
    };

    renderSummary = function renderCoverageSummary(allRows) {
        const noCoverage = allRows.filter((row) => row.standardShift && row.employees.length === 0).length;
        const singleCoverage = allRows.filter((row) => row.standardShift && row.employees.length === 1 && row.status !== 'sufficient').length;
        const otherIssues = allRows.filter((row) => (
            row.status !== 'sufficient'
            && !(row.standardShift && row.employees.length <= 1)
        )).length;
        const sufficient = allRows.filter((row) => row.status === 'sufficient').length;
        const missingHours = allRows
            .filter((row) => row.status === 'under')
            .reduce((total, row) => total + (row.end - row.start) / 60, 0);

        summary.innerHTML = `
            <article class="summary-card is-danger"><span class="summary-value">${noCoverage}</span><span class="summary-label">Geen bezetting</span></article>
            <article class="summary-card is-warning"><span class="summary-value">${singleCoverage}</span><span class="summary-label">Enkele bezetting</span></article>
            <article class="summary-card is-warning"><span class="summary-value">${otherIssues}</span><span class="summary-label">Overige aandachtspunten</span></article>
            <article class="summary-card is-ok"><span class="summary-value">${sufficient}</span><span class="summary-label">Voldoende bezet</span></article>
            <article class="summary-card"><span class="summary-value">${missingHours.toFixed(1)}</span><span class="summary-label">Uren onder harde norm</span></article>
        `;
    };

    renderRows = function renderCoverageRows(rows) {
        resultCount.textContent = `${rows.length} tijdsblok(ken)`;
        if (!rows.length) {
            results.innerHTML = '<p class="empty-state">Geen tijdsblokken gevonden voor deze selectie.</p>';
            return;
        }

        results.innerHTML = rows.map((row) => {
            const lessonText = row.activeLessons.length
                ? row.activeLessons.map((lesson) => `${lesson.name} ${lesson.registered}/${lesson.capacity}${lesson.waitlist ? ` +${lesson.waitlist} wachtlijst` : ''}`).join(' · ')
                : 'Geen groepsles';
            const shiftText = row.standardShift
                ? `${row.standardShift.label}: ${row.standardShift.start}–${row.standardShift.end}`
                : 'Geen vaste standaarddienst';
            let label = row.status === 'under' ? 'Onderbezet' : row.status === 'vulnerable' ? 'Kwetsbaar' : 'Voldoende';
            if (row.standardShift && row.employees.length === 0) label = 'Geen bezetting';
            else if (row.standardShift && row.employees.length === 1 && row.status !== 'sufficient') label = 'Enkele bezetting';

            return `
                <article class="staffing-row is-${row.status}">
                    <div class="staffing-date"><strong>${escapeHtml(formatDate(row.date))}</strong><span class="muted">${WEEKDAYS[parseDate(row.date).getDay()]}</span></div>
                    <div class="staffing-location"><strong>${escapeHtml(row.location)}</strong><span class="muted">${escapeHtml(shiftText)} · ${escapeHtml(lessonText)}</span></div>
                    <div><strong>${minutesToTime(row.start)}–${minutesToTime(row.end)}</strong><span class="muted">${row.employees.length ? escapeHtml(row.employees.join(', ')) : 'Niemand ingepland'}</span></div>
                    <div><strong>${row.employees.length}</strong><span class="muted">ingepland</span></div>
                    <div><strong>${row.hardMinimum}</strong><span class="muted">harde norm${row.advisedMinimum > row.hardMinimum ? ` / advies ${row.advisedMinimum}` : ''}</span></div>
                    <div class="staffing-reason"><span class="status-pill is-${row.status}">${label}</span><ul>${row.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>
                </article>
            `;
        }).join('');
    };

    runAnalysis = function runSixWeekCoverageAnalysis() {
        if (!defaultSixWeekRangeApplied) {
            const today = isoDate(new Date());
            fromFilter.value = today;
            toFilter.value = addDays(today, 41);
            defaultSixWeekRangeApplied = true;
        }
        const selectedMode = statusFilter.value;
        statusFilter.value = 'all';
        const allRows = analyze();
        statusFilter.value = selectedMode;
        renderSummary(allRows);
        renderRows(analyze());
    };

    document.addEventListener('authready', (event) => {
        const authState = event.detail;
        if (authState?.role === 'manager' && authState.user?.location) {
            locationFilter.value = authState.user.location;
            locationFilter.disabled = true;
            locationFilter.title = `Vaste profielvestiging: ${authState.user.location}`;
            runAnalysis();
        }
    });

    window.SSO_STANDARD_SHIFT_WINDOWS = standardShiftWindows;
    window.SSO_FORMAT_LOCATION_SCHEDULE = formatLocationSchedule;
})();
