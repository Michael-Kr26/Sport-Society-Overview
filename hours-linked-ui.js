(() => {
    const originalFetch = window.fetch.bind(window);
    const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
    const employeeKey = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

    function addMonths(month, amount) {
        const [year, number] = month.split('-').map(Number);
        const date = new Date(year, number - 1 + amount, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function monthsBetween(from, to) {
        const months = [];
        for (let month = from; month <= to && months.length < 240; month = addMonths(month, 1)) months.push(month);
        return months;
    }

    function correctionFor(months, month) {
        return round(months?.[month]?.correction || 0);
    }

    function applyCorrections(payload, corrections) {
        const byEmployee = new Map((corrections.employees || []).map((employee) => [employeeKey(employee.employeeName), employee.months || {}]));
        const selectedMonth = payload.month;
        const previousMonth = payload.previousMonth;

        for (const employee of payload.employees || []) {
            const months = byEmployee.get(employeeKey(employee.employeeName)) || {};
            const currentCorrection = correctionFor(months, selectedMonth);
            const previousCorrection = correctionFor(months, previousMonth);
            const activeMonth = String(employee.activeFrom || '').slice(0, 7) || selectedMonth;
            const openingMonth = [employee.openingBankMonth || selectedMonth, activeMonth].sort().reverse()[0];
            const cumulativeCorrection = monthsBetween(openingMonth, selectedMonth)
                .reduce((total, month) => round(total + correctionFor(months, month)), 0);

            employee.scheduledHours = round(employee.scheduledHours + currentCorrection);
            employee.creditedHours = round(employee.creditedHours + currentCorrection);
            employee.previousScheduledHours = round(employee.previousScheduledHours + previousCorrection);
            employee.trendHours = round(employee.scheduledHours - employee.previousScheduledHours);
            employee.declaredHoursCorrection = currentCorrection;
            employee.declaredHoursLinkedShifts = Number(months?.[selectedMonth]?.linkedShifts || 0);
            if (employee.contractType === 'contract') {
                employee.monthDelta = round(employee.monthDelta + currentCorrection);
                employee.bankBalance = round(employee.bankBalance + cumulativeCorrection);
            }
        }

        const employees = payload.employees || [];
        const contracts = employees.filter((employee) => employee.contractType === 'contract');
        const flex = employees.filter((employee) => employee.contractType === 'flex');
        const flexAverageHours = flex.length
            ? round(flex.reduce((sum, employee) => sum + employee.creditedHours, 0) / flex.length)
            : 0;
        flex.forEach((employee) => { employee.flexDifference = round(employee.creditedHours - flexAverageHours); });
        payload.summary.totalScheduledHours = round(employees.reduce((sum, employee) => sum + employee.scheduledHours, 0));
        payload.summary.totalCreditedHours = round(employees.reduce((sum, employee) => sum + employee.creditedHours, 0));
        payload.summary.contractMonthDelta = round(contracts.reduce((sum, employee) => sum + employee.monthDelta, 0));
        payload.summary.flexAverageHours = flexAverageHours;
        payload.hoursSource = corrections.source || 'Excel-kolom Uren';
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
            const correctionResponse = await originalFetch(`/api/hours/declared-corrections?month=${encodeURIComponent(month)}`);
            if (!correctionResponse.ok) return response;
            const corrections = await correctionResponse.json();
            const corrected = applyCorrections(payload, corrections);
            const headers = new Headers(response.headers);
            headers.set('Content-Type', 'application/json; charset=utf-8');
            headers.delete('Content-Length');
            return new Response(JSON.stringify(corrected), {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        } catch (error) {
            console.warn('Excel-uren konden niet over de urenanalyse worden gelegd.', error);
            return response;
        }
    };
})();
