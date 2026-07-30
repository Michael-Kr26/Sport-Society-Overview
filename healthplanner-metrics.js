const METRICS = [
    { key: 'membershipsSold', label: 'Aantal verkochte lidmaatschappen', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: ['verkochte lidmaatschappen', 'lidmaatschappen verkocht'] },
    { key: 'membershipsSoldActive', label: 'Aantal verkochte lidmaatschappen (actieve verkoop)', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: ['actieve verkoop'] },
    { key: 'membershipsSoldPassive', label: 'Aantal verkochte lidmaatschappen (passieve verkoop)', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: ['passieve verkoop'] },
    { key: 'cancelledMemberships', label: 'Geannuleerde lidmaatschappen', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'salesAppointmentsCreated', label: 'Totaal aantal gemaakte verkoopafspraken', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: ['gemaakte verkoopafspraken totaal'] },
    { key: 'firstSalesAppointmentsCreated', label: 'Gemaakte 1ste verkoopafspraken', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: ['gemaakte eerste verkoopafspraken'] },
    { key: 'extraSalesAppointmentsCreated', label: 'Gemaakte extra verkoopafspraken', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'salesAppointmentsScheduled', label: 'Totaal aantal geplande verkoopafspraken', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: ['geplande verkoopafspraken totaal'] },
    { key: 'salesAppointmentsCompleted', label: 'Afgeronde verkoopafspraken', domain: 'sales', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'salesAppointmentsRemaining', label: 'Nog geplande verkoopafspraken', domain: 'sales', unit: 'count', aggregation: 'snapshot', aliases: [] },
    { key: 'attendanceRate', label: 'Uiteindelijke opkomstpercentage', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: ['opkomstpercentage'] },
    { key: 'firstAttendanceRate', label: 'Opkomstpercentage 1ste verkoopgesprek', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: ['opkomstpercentage eerste verkoopgesprek'] },
    { key: 'extraAttendanceRate', label: 'Opkomstpercentage extra verkoopgesprek', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: [] },
    { key: 'closingRate', label: 'Afsluitingspercentage', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: [] },
    { key: 'directClosingRate', label: 'Directe afsluitpercentage', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: ['direct afsluitingspercentage'] },
    { key: 'extraClosingRate', label: 'Afsluitingspercentage bij extra verkoopgesprekken', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: [] },
    { key: 'successRatio', label: 'Succesratio', domain: 'sales', unit: 'percentage', aggregation: 'ratio', aliases: [] },
    { key: 'callMoments', label: 'Totaal aantal belmomenten', domain: 'leads', unit: 'count', aggregation: 'sum', aliases: ['aantal belmomenten'] },
    { key: 'callReachabilityRate', label: 'Bereikbaarheid belmomenten', domain: 'leads', unit: 'percentage', aggregation: 'ratio', aliases: [] },
    { key: 'callEffectivenessRate', label: 'Bel effectiviteit', domain: 'leads', unit: 'percentage', aggregation: 'ratio', aliases: ['beleffectiviteit'] },
    { key: 'potentialCustomers', label: 'Totaal aantal potentiële klanten', domain: 'leads', unit: 'count', aggregation: 'sum', aliases: ['potentiele klanten'] },
    { key: 'leadResponseSeconds', label: 'Reactiesnelheid leads oppakken', domain: 'leads', unit: 'duration_seconds', aggregation: 'average', aliases: ['reactiesnelheid leads'] },
    { key: 'leadWaitSeconds', label: 'Wachttijd leads', domain: 'leads', unit: 'duration_seconds', aggregation: 'average', aliases: [] },
    { key: 'memberGrowth', label: 'Ledengroei', domain: 'retention', unit: 'signed_count', aggregation: 'sum', aliases: [] },
    { key: 'visitFrequency', label: 'Algemene bezoekersfrequentie', domain: 'visits', unit: 'ratio', aggregation: 'average', aliases: ['bezoekersfrequentie'] },
    { key: 'appointmentsCompleted', label: 'Aantal afgeronde afspraken', domain: 'coaching', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'appointmentsCreated', label: 'Aantal gemaakte afspraken', domain: 'coaching', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'appointmentsScheduled', label: 'Aantal geplande afspraken', domain: 'coaching', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'appointmentsReplanned', label: 'Doorgeplande afspraken', domain: 'coaching', unit: 'count', aggregation: 'sum', aliases: ['doorgepande afspraken'] },
    { key: 'appointmentsNotReplanned', label: 'Niet doorgeplande afspraken', domain: 'coaching', unit: 'count', aggregation: 'sum', aliases: [] },
    { key: 'appointmentsReplannedRate', label: 'Percentage doorgeplande afspraken', domain: 'coaching', unit: 'percentage', aggregation: 'ratio', aliases: [] },
    { key: 'membersWithoutFutureAppointment', label: 'Aantal leden zonder een afspraak in de toekomst', domain: 'coaching', unit: 'count', aggregation: 'snapshot', aliases: [] },
    { key: 'membersWithFutureAppointment', label: 'Aantal leden met een afspraak in de toekomst', domain: 'coaching', unit: 'count', aggregation: 'snapshot', aliases: [] },
    { key: 'activeMembers', label: 'Actieve leden', domain: 'members', unit: 'count', aggregation: 'snapshot', aliases: [] },
    { key: 'nonRecentVisitors', label: 'Niet recente bezoekers', domain: 'visits', unit: 'count', aggregation: 'snapshot', aliases: ['niet-recente bezoekers'] },
    { key: 'dormantMembers', label: 'Slapende leden', domain: 'retention', unit: 'count', aggregation: 'snapshot', aliases: [] },
    { key: 'membersWithoutGoal', label: 'Aantal leden zonder een doelstelling', domain: 'coaching', unit: 'count', aggregation: 'snapshot', aliases: ['leden zonder doelstelling'] },
    { key: 'membersWithGoal', label: 'Aantal leden met een doelstelling', domain: 'coaching', unit: 'count', aggregation: 'snapshot', aliases: ['leden met doelstelling'] },
    { key: 'membersWithCoach', label: 'Leden met coach', domain: 'coaching', unit: 'count', aggregation: 'snapshot', aliases: ['leden met personal coach'] },
    { key: 'membersWithoutPersonalCoach', label: 'Leden zonder personal coach', domain: 'coaching', unit: 'count', aggregation: 'snapshot', aliases: ['leden zonder coach'] },
    { key: 'membersRetainedAfterExit', label: 'Aantal leden die lid zijn gebleven na een exit-gesprek', domain: 'retention', unit: 'count', aggregation: 'sum', aliases: ['behouden na exit gesprek'] },
    { key: 'cancellations', label: 'Aantal opzeggingen', domain: 'retention', unit: 'count', aggregation: 'sum', aliases: ['opzeggingen'] }
];

const DOMAIN_LABELS = {
    sales: 'Verkoop',
    leads: 'Leads en belanalyse',
    members: 'Leden',
    visits: 'Bezoek',
    coaching: 'Afspraken en coaching',
    retention: 'Ledenbehoud'
};

function clean(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
    return clean(value).toLocaleLowerCase('nl-NL')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

const METRIC_LOOKUP = new Map();
for (const metric of METRICS) {
    for (const value of [metric.key, metric.label, ...(metric.aliases || [])]) {
        METRIC_LOOKUP.set(normalize(value), metric);
    }
}

function resolveMetric(value) {
    return METRIC_LOOKUP.get(normalize(value)) || null;
}

module.exports = {
    METRICS,
    DOMAIN_LABELS,
    clean,
    normalize,
    resolveMetric
};
