(function employeeViewModelFactory(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.SSOEmployeeView = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
    const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('nl-NL');

    function directoryRecordForEmployee(employee, directory = []) {
        const key = normalizeName(employee?.employeeName);
        return directory.find((record) => normalizeName(record.employeeName) === key) || null;
    }

    function employeeHref(employee, directory = []) {
        const record = directoryRecordForEmployee(employee, directory);
        if (record?.employeeId) return `employee.html?id=${encodeURIComponent(record.employeeId)}`;
        return `employee.html?name=${encodeURIComponent(employee.employeeName)}`;
    }

    function resolveEmployee({ employees = [], directory = [], id = null, name = null } = {}) {
        if (id !== null && id !== undefined && String(id).trim() !== '') {
            const numericId = Number(id);
            const record = directory.find((item) => Number(item.employeeId) === numericId);
            if (!record) return null;
            const key = normalizeName(record.employeeName);
            return employees.find((employee) => normalizeName(employee.employeeName) === key) || null;
        }
        if (name) {
            const key = normalizeName(name);
            return employees.find((employee) => normalizeName(employee.employeeName) === key) || null;
        }
        return null;
    }

    function sortedPeriods(employee, direction = 'desc') {
        const periods = [...(employee?.contractPeriods || [])];
        periods.sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
        return direction === 'asc' ? periods : periods.reverse();
    }

    function latestPeriod(employee) {
        return sortedPeriods(employee, 'desc')[0] || null;
    }

    function employeeState(employee, employmentStatus, today) {
        if (!employee?.isActive) return { label: 'Inactief', tone: 'danger' };
        if (employmentStatus?.activeUntil && employmentStatus.activeUntil < today) return { label: 'Uit dienst', tone: 'neutral' };
        if (employee.activeFrom && employee.activeFrom > today) return { label: 'Toekomstig', tone: 'warning' };
        return { label: 'Actief', tone: 'success' };
    }

    function periodState(period, today) {
        if (period.effectiveFrom > today) return { label: 'Toekomstig', tone: 'warning' };
        if (period.effectiveTo && period.effectiveTo < today) return { label: 'Historisch', tone: 'neutral' };
        return { label: 'Actief', tone: 'success' };
    }

    return {
        directoryRecordForEmployee,
        employeeHref,
        employeeState,
        latestPeriod,
        normalizeName,
        periodState,
        resolveEmployee,
        sortedPeriods
    };
});

if (typeof window !== 'undefined' && /(^|\/)employee\.html$/.test(window.location.pathname)) {
    const script = document.createElement('script');
    script.src = 'employee-location-ui.js?v=20260904-primary-location';
    script.defer = true;
    document.head.appendChild(script);
}
