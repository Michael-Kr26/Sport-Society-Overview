# HealthPlanner-dashboard — gegevenscontract V1.5

## Status

Dit document legt het interne, canonieke gegevensmodel vast. De letterlijke kolomnamen uit de HealthPlanner-bron worden pas via een afzonderlijk importprofiel gekoppeld nadat het daadwerkelijke bronbestand is gecontroleerd. Er worden geen velden op basis van aannames stilzwijgend gemapt.

## Doel

HealthPlanner-gegevens historisch bewaren en vergelijken per:

- dag;
- week;
- maand;
- jaar;
- vestiging;
- totaal Sport Society.

## Definitief uitgesloten

- salaris;
- payroll;
- loonstroken;
- loon- of personeelskosten;
- medische diagnoses of zorgdossiers.

## Identiteit van iedere meting

Iedere geïmporteerde regel bevat minimaal:

| Veld | Type | Verplicht | Definitie |
|---|---|---:|---|
| `periodDate` | datum | ja | Datum waarop de meting betrekking heeft |
| `periodType` | enum | ja | `day`, `week` of `month` |
| `location` | enum | ja | Achterveld, Barneveld, Voorthuizen, Wekerom, Harskamp of `Sport Society totaal` |
| `sourceFile` | tekst | ja | Herleidbaar bronbestand |
| `sourceRow` | geheel getal | nee | Oorspronkelijke rij of recordpositie |
| `importedAt` | datum-tijd | ja | Verwerkingsmoment |
| `sourceHash` | tekst | ja | Detectie van duplicaten en gewijzigde bronregels |

## KPI-domeinen

### Leden

| Canoniek veld | Type | Aggregatie | Definitie vóór implementatie bevestigen |
|---|---:|---|---|
| `activeMembers` | geheel getal | momentopname | Actieve leden aan het einde van de periode |
| `newMembers` | geheel getal | optellen | Nieuwe actieve lidmaatschappen in de periode |
| `cancelledMembers` | geheel getal | optellen | Opzeggingen in de periode |
| `reactivatedMembers` | geheel getal | optellen | Heractiveerde leden in de periode |
| `dormantMembers` | geheel getal | momentopname | Leden onder de vastgelegde bezoekdrempel |

### Leads en verkoop

| Canoniek veld | Type | Aggregatie |
|---|---:|---|
| `newLeads` | geheel getal | optellen |
| `followedUpLeads` | geheel getal | optellen |
| `appointmentsScheduled` | geheel getal | optellen |
| `appointmentsAttended` | geheel getal | optellen |
| `membershipsSold` | geheel getal | optellen |

Afgeleide KPI’s worden niet geïmporteerd maar berekend:

- opvolgpercentage = `followedUpLeads / newLeads`;
- verschijningspercentage = `appointmentsAttended / appointmentsScheduled`;
- leadconversie = `membershipsSold / newLeads`.

### Coaching

| Canoniek veld | Type | Aggregatie |
|---|---:|---|
| `membersWithCoach` | geheel getal | momentopname |
| `membersWithoutCoach` | geheel getal | momentopname |
| `coachAppointmentsScheduled` | geheel getal | optellen |
| `coachAppointmentsCompleted` | geheel getal | optellen |
| `overdueCoachContacts` | geheel getal | momentopname |

Afgeleide KPI’s:

- coachdekking = `membersWithCoach / activeMembers`;
- uitvoeringspercentage = `coachAppointmentsCompleted / coachAppointmentsScheduled`.

### Bezoek en retentie

| Canoniek veld | Type | Aggregatie |
|---|---:|---|
| `totalVisits` | geheel getal | optellen |
| `uniqueVisitors` | geheel getal | uitsluitend optellen wanneer de bronperiode niet overlapt |
| `membersWithDecliningFrequency` | geheel getal | momentopname |
| `retentionRiskMembers` | geheel getal | momentopname |

Afgeleide KPI’s:

- bezoekfrequentie = `totalVisits / activeMembers`;
- netto ledenontwikkeling = `newMembers + reactivatedMembers - cancelledMembers`;
- opzeggingspercentage = `cancelledMembers / activeMembers` met expliciete periodebasis.

## Validatieregels

1. Aantallen zijn gehele getallen groter dan of gelijk aan nul.
2. Percentages worden berekend en niet als bron van waarheid geïmporteerd.
3. Een momentopname mag niet over dagen of weken worden opgeteld.
4. Dubbelen worden herkend met `sourceHash` en de combinatie periode, vestiging en bronrecord.
5. Een gewijzigde bronregel wordt als revisie gelogd; oude waarden worden niet zonder auditspoor overschreven.
6. Totaalregels en vestigingsregels mogen niet samen worden opgeteld als hetzelfde totaal al in de bron staat.
7. Ontbrekende waarden blijven `null`; alleen een expliciete nul wordt `0`.
8. Iedere import krijgt een preview met fouten, waarschuwingen en aantallen vóór definitieve opslag.

## Openstaande bronvragen

Voor de daadwerkelijke importer moet het aangeleverde HealthPlanner-bestand nog worden gecontroleerd op:

- exacte bestandsvorm: Excel, CSV, API, e-mailbijlage of rapportweergave;
- exacte kolomnamen;
- periodebasis per veld;
- vestigingsniveau;
- betekenis van slapend/inactief lid;
- definitie van lead, afspraak en verkoop;
- definitie van coachcontact en achterstallig contact;
- omgang met correcties achteraf;
- aanwezigheid van persoonsgegevens.

Persoonsgegevens worden alleen geïmporteerd wanneer een concrete operationele functie dat vereist. Het managementdashboard gebruikt standaard geaggregeerde gegevens.
