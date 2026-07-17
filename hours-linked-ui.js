(() => {
    const originalFetch = window.fetch.bind(window);
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

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

        const employees = payload.employees || [];
        const contracts = employees.filter((employee) => employee.contractType === 'contract');
        const flex = employees.filter((employee) => employee.contractType === 'flex');
        const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
        const flexAverageHours = flex.length
            ? round(flex.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0) / flex.length)
            : 0;
        flex.forEach((employee) => { employee.flexDifference = round(numeric(employee.creditedHours) - flexAverageHours); });

        payload.summary = {
            ...payload.summary,
            employeeCount: employees.length,
            contractEmployeeCount: contracts.length,
            flexEmployeeCount: flex.length,
            totalScheduledHours: round(employees.reduce((sum, employee) => sum + numeric(employee.scheduledHours), 0)),
            totalCreditedHours: round(employees.reduce((sum, employee) => sum + numeric(employee.creditedHours), 0)),
            contractMinimumHours: round(contracts.reduce((sum, employee) => sum + numeric(employee.monthlyNorm), 0)),
            contractMonthDelta: round(contracts.reduce((sum, employee) => sum + numeric(employee.monthDelta), 0)),
            flexAverageHours,
            excelIssueCount: Number(excel.issueCount || 0)
        };
        payload.excelPeriod = excel.period || null;
        payload.excelIssues = excel.issues || [];
        payload.excelAvailablePeriods = excel.availablePeriods || [];
        payload.excelRequestedMonth = excel.requestedMonth || payload.month;
        payload.permissions = {
            ...(payload.permissions || {}),
            canEdit: Boolean(excel.permissions?.canEdit)
        };
        payload.hoursSource = 'Excel: Minstens en overurenvelden per maandpagina';
        return payload;
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
            const excelResponse = await originalFetch(`/api/hours/excel-analysis?month=${encodeURIComponent(month)}`);
            if (!excelResponse.ok) return response;
            const excel = await excelResponse.json();
            const corrected = overlayExcelAnalysis(payload, excel);
            const headers = new Headers(response.headers);
            headers.set('Content-Type', 'application/json; charset=utf-8');
            headers.delete('Content-Length');
            return new Response(JSON.stringify(corrected), {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        } catch (error) {
            console.warn('Het Excel-maandoverzicht kon niet over de urenanalyse worden gelegd.', error);
            return response;
        }
    };
})();
