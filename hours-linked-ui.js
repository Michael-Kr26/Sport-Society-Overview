(() => {
    const originalFetch = window.fetch.bind(window);
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

    function activeExcelIssues(excel) {
        const byEmployee = new Map((excel.employees || []).map((employee) => [employeeKey(employee.employeeName), employee]));
        return (excel.issues || []).filter((issue) => {
            if (!issue.employeeName) return true;
            const employee = byEmployee.get(employeeKey(issue.employeeName));
            if (!employee?.hasOverride || employee.usedFallback || !employee.isComplete) return true;

            const isRawMissingWarning = issue.type === 'source_validation'
                && /ontbrekend\s*:/i.test(String(issue.message || ''));
            const isResolvedMissingStatus = ['employee_missing', 'employee_fallback'].includes(issue.type);
            return !isRawMissingWarning && !isResolvedMissingStatus;
        });
    }

    function monthBounds(month) {
        const [year, number] = String(month || '').split('-').map(Number);
        if (!year || !number) return { first: '', last: '' };
        return {
            first: `${year}-${String(number).padStart(2, '0')}-01`,
            last: new Date(year, number, 0).toISOString().slice(0, 10)
        };
    }

    function visibleInMonth(status, month) {
        if (!status) return true;
        if (!status.isActive) return false;
        const { first, last } = monthBounds(month);
        if (status.activeFrom && last && status.activeFrom > last) return false;
        if (status.activeUntil && first && status.activeUntil < first) return false;
        return true;
    }

    function recalculateSummary(payload) {
        const employees = payload.employees || [];
        const contracts = employees.filter((employee) => employee.contractType === 'contract');
        const flex = employees.filter((employee) => employee.contractType === 'flex');
        const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
        const flexAverageHours = flex.length
            ? round(flex.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0) / flex.length)
            : 0;
        flex.forEach((employee) => {
            employee.flexDifference = round(numeric(employee.creditedHours) - flexAverageHours);
        });

        payload.summary = {
            ...(payload.summary || {}),
            employeeCount: employees.length,
            contractEmployeeCount: contracts.length,
            flexEmployeeCount: flex.length,
            totalScheduledHours: round(employees.reduce((sum, employee) => sum + numeric(employee.scheduledHours), 0)),
            totalCreditedHours: round(employees.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0)),
            contractMinimumHours: round(contracts.reduce((sum, employee) => sum + numeric(employee.monthlyNorm), 0)),
            contractMonthDelta: round(contracts.reduce((sum, employee) => sum + numeric(employee.monthDelta), 0)),
            flexAverageHours,
            excelIssueCount: (payload.excelIssues || []).length
        };
        return payload;
    }

    function applyEmploymentVisibility(payload, employment, month) {
        const statuses = new Map((employment?.employees || []).map((employee) => [employeeKey(employee.employeeName), employee]));
        const visibleNames = new Set();

        payload.employees = (payload.employees || []).filter((employee) => {
            const status = statuses.get(employeeKey(employee.employeeName));
            const visible = visibleInMonth(status, month);
            if (visible) {
                visibleNames.add(employeeKey(employee.employeeName));
                employee.activeUntil = status?.activeUntil || null;
            }
            return visible;
        });

        payload.excelIssues = (payload.excelIssues || []).filter((issue) => {
            if (!issue.employeeName) return true;
            return visibleNames.has(employeeKey(issue.employeeName));
        });
        payload.employmentStatusApplied = true;
        return recalculateSummary(payload);
    }

    function overlayExcelAnalysis(payload, excel) {
        const byEmployee = new Map((payload.employees || []).map((employee) => [employeeKey(employee.employeeName), employee]));

        for (const excelEmployee of excel.employees || []) {
            const key = employeeKey(excelEmployee.employeeName);
            let employee = byEmployee.get(key);
            if (!employee) {
                employee = {
                    employeeName: excelEmployee.employeeName,
                    contractType: 'contract',
                    weeklyContractHours: excelEmployee.weeklyContractHours || 0,
                    locations: [],
                    openingBankHours: 0,
                    openingBankMonth: excelEmployee.periodKey,
                    activeFrom: `${excelEmployee.periodKey}-01`
                };
                payload.employees.push(employee);
                byEmployee.set(key, employee);
            }

            employee.contractType = 'contract';
            if (Number.isFinite(excelEmployee.weeklyContractHours)) {
                employee.weeklyContractHours = excelEmployee.weeklyContractHours;
            }
            employee.monthlyNorm = excelEmployee.minimumHours;
            employee.scheduledHours = excelEmployee.scheduledHours;
            employee.creditedAdjustment = 0;
            employee.creditedHours = excelEmployee.scheduledHours;
            employee.bankAdjustment = 0;
            employee.monthDelta = excelEmployee.overtimeThisMonth;
            employee.bankBalance = excelEmployee.overtimeAfterMonth;
            employee.previousOvertime = excelEmployee.overtimePreviousMonth;
            employee.trendHours = Number.isFinite(excelEmployee.overtimeThisMonth)
                && Number.isFinite(excelEmployee.overtimePreviousMonth)
                ? round(excelEmployee.overtimeThisMonth - excelEmployee.overtimePreviousMonth)
                : null;
            employee.excel = excelEmployee;
        }

        payload.excelPeriod = excel.period || null;
        payload.excelIssues = activeExcelIssues(excel);
        payload.excelAvailablePeriods = excel.availablePeriods || [];
        payload.excelRequestedMonth = excel.requestedMonth || payload.month;
        payload.permissions = {
            ...(payload.permissions || {}),
            canEdit: Boolean(excel.permissions?.canEdit)
        };
        payload.hoursSource = 'Excel: eindtotaal urentabel, Minstens en overurenvelden per maandpagina';
        return recalculateSummary(payload);
    }

    window.fetch = async (input, options) => {
        const requestUrl = typeof input === 'string' ? input : input?.url;
        if (typeof requestUrl !== 'string' || !/^\/api\/hours\/analysis(?:\?|$)/.test(requestUrl)) {
            return originalFetch(input, options);
        }

        const response = await originalFetch(input, options);
        if (!response.ok) return response;

        try {
            const payload = await response.clone().json();
            const parsedUrl = new URL(requestUrl, window.location.origin);
            const month = parsedUrl.searchParams.get('month') || payload.month;
            const [excelResponse, employmentResponse] = await Promise.all([
                originalFetch(`/api/hours/excel-analysis?month=${encodeURIComponent(month)}`),
                originalFetch('/api/hours/employment-status')
            ]);
            if (!excelResponse.ok) return response;
            const excel = await excelResponse.json();
            const employment = employmentResponse.ok
                ? await employmentResponse.json().catch(() => ({ employees: [] }))
                : { employees: [] };
            const corrected = applyEmploymentVisibility(overlayExcelAnalysis(payload, excel), employment, month);
            const headers = new Headers(response.headers);
            headers.set('Content-Type', 'application/json; charset=utf-8');
            headers.delete('Content-Length');
            return new Response(JSON.stringify(corrected), {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        } catch (error) {
            console.warn('Het Excel-maandoverzicht of de uitdienstdatum kon niet over de urenanalyse worden gelegd.', error);
            return response;
        }
    };
})();
