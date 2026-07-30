# HealthPlanner-dashboard — gegevenscontract V1.5

## Status

Het interne gegevensmodel en het eerste importprofiel zijn vastgesteld op basis van de aangeleverde dagelijkse HealthPlanner-managementrapportage. De aangeleverde bron is een doorgestuurde e-mailrapportage in PDF-vorm met per vestiging de kolommen `Gisteren` en `Maand`.

De PDF is gebruikt om de bronstructuur, metrieklabels en periodebetekenis vast te stellen. De productie-import gebruikt in V1.5 een genormaliseerd CSV- of XLSX-bestand, omdat tabelkolommen en duurwaarden uit PDF-extractie niet stabiel genoeg zijn om zonder controle als administratieve bron te gebruiken.

## Doel

HealthPlanner-gegevens historisch bewaren en vergelijken per:

- dag;
- maand-tot-datum;
- rapportdatum;
- vestiging;
- totaal Sport Society wanneer een expliciete totaalregel wordt aangeleverd.

## Definitief uitgesloten

- salaris;
- payroll;
- loonstroken;
- loon- of personeelskosten;
- medische diagnoses of zorgdossiers;
- individuele ledengegevens zolang het managementdoel met geaggregeerde KPI's kan worden bereikt.

## Vastgestelde bronstructuur

De rapportage bevat de vestigingen:

- Voorthuizen;
- Achterveld;
- Barneveld;
- Wekerom;
- Harskamp.

Per vestiging worden twee vensters aangeleverd:

| Bronkolom | Canonieke waarde | Betekenis |
|---|---|---|
| `Gisteren` | `day` | Waarde van de dag vóór de rapportdatum |
| `Maand` | `month_to_date` | Maand-tot-datumwaarde op de rapportdatum |

Een maand-tot-datumwaarde is geen afgesloten maandtotaal. Opeenvolgende maand-tot-datumwaarden mogen daarom niet bij elkaar worden opgeteld.

## Identiteit van iedere meting

Iedere geïmporteerde regel bevat minimaal:

| Veld | Type | Verplicht | Definitie |
|---|---|---:|---|
| `reportDate` | datum | ja | Datum bovenaan de HealthPlanner-rapportage |
| `periodDate` | datum | ja | Vorige dag voor `day`; rapportdatum voor `month_to_date` |
| `periodType` | enum | ja | `day` of `month_to_date` |
| `location` | enum | ja | Achterveld, Barneveld, Voorthuizen, Wekerom, Harskamp of expliciet `Sport Society totaal` |
| `metricKey` | tekst/enum | ja | Canonieke sleutel uit `healthplanner-metrics.js` |
| `metricValue` | getal | ja | Gevalideerde bronwaarde, waarbij een expliciete nul geldig is |
| `metricUnit` | enum | ja | `count`, `signed_count`, `percentage`, `ratio` of `duration_seconds` |
| `sourceFile` | tekst | ja | Herleidbaar bronbestand |
| `sourceRow` | geheel getal | nee | Oorspronkelijke rij of recordpositie |
| `importedAt` | datum-tijd | ja | Verwerkingsmoment |
| `sourceHash` | tekst | ja | Detectie van duplicaten en gewijzigde bronregels |

## KPI-domeinen uit de bron

### Verkoop

Onder meer:

- verkochte lidmaatschappen totaal;
- actieve en passieve verkoop;
- geannuleerde lidmaatschappen;
- gemaakte, geplande en afgeronde verkoopafspraken;
- opkomstpercentages;
- afsluitingspercentages;
- succesratio.

### Leads en belanalyse

Onder meer:

- aantal belmomenten;
- bereikbaarheid;
- beleffectiviteit;
- potentiële klanten;
- reactiesnelheid leads;
- wachttijd leads.

### Leden en bezoek

Onder meer:

- actieve leden;
- ledengroei;
- algemene bezoekersfrequentie;
- niet-recente bezoekers;
- slapende leden.

### Afspraken en coaching

Onder meer:

- gemaakte, geplande en afgeronde afspraken;
- doorgeplande en niet-doorgeplande afspraken;
- leden met of zonder toekomstige afspraak;
- leden met of zonder doelstelling;
- leden met coach en zonder personal coach.

### Ledenbehoud

Onder meer:

- leden die na een exitgesprek lid zijn gebleven;
- aantal opzeggingen;
- slapende leden.

De volledige lijst met sleutels, eenheden en aggregatieregels staat in `healthplanner-metrics.js` en `templates/healthplanner-metric-register.csv`.

## Aggregatieregels

1. `count`: alleen optellen wanneer bronperioden niet overlappen.
2. `signed_count`: mag negatief zijn, zoals ledengroei.
3. `percentage`: niet optellen; vergelijken of opnieuw berekenen met geschikte noemers.
4. `ratio`: niet optellen; bezoekersfrequentie blijft een ratio.
5. `duration_seconds`: voor opslag normaliseren naar seconden; alleen middelen met een expliciete definitie.
6. `snapshot`: een peilwaarde zoals actieve of slapende leden wordt niet over rapportdagen opgeteld.
7. `month_to_date`: opeenvolgende rapportdagen niet sommeren; de laatste peildatum is leidend binnen dezelfde maand.

## Afgeleide KPI's

Afgeleide waarden worden niet als nieuwe bronwaarheid opgeslagen wanneer zij uit bestaande metingen kunnen worden berekend. Voorbeelden:

- coachdekking = leden met coach / actieve leden;
- doelstellingsdekking = leden met doelstelling / actieve leden;
- netto ledenontwikkeling wordt alleen berekend wanneer de benodigde bronvelden dezelfde periodebasis hebben;
- conversies worden bij voorkeur met de onderliggende aantallen berekend, maar HealthPlanner-percentages blijven zichtbaar als aangeleverde managementwaarde.

## Validatieregels

1. Aantallen zijn gehele getallen groter dan of gelijk aan nul, behalve expliciet ondertekende KPI's zoals ledengroei.
2. Percentages liggen tussen 0 en 100.
3. Een momentopname wordt niet over dagen of weken opgeteld.
4. Dubbelen worden herkend met de bestandshash en de combinatie periode, vestiging en metriek.
5. Een gewijzigd bronrecord wordt als revisie gelogd voordat de actuele waarde wordt vervangen.
6. Totaalregels en vestigingsregels mogen niet samen worden opgeteld als hetzelfde totaal al in de bron staat.
7. Ontbrekende waarden blijven ongeldig; alleen een expliciete nul wordt `0`.
8. Iedere import krijgt een preview met fouten, waarschuwingen en aantallen vóór definitieve opslag.
9. Het totaal verkochte lidmaatschappen wordt gecontroleerd tegen actieve plus passieve verkoop wanneer alle drie waarden aanwezig zijn.
10. Per rapportdatum en vestiging wordt gewaarschuwd wanneer niet zowel `Gisteren` als `Maand` is aangeleverd.

## Import- en revisiebeleid

- preview: `npm run preview:healthplanner -- <bestand> <importeur>`;
- definitieve opslag: `npm run import:healthplanner -- <bestand> <importeur>`;
- hetzelfde bronbestand wordt niet tweemaal geïmporteerd;
- gewijzigde waarden worden vastgelegd in `healthplanner_metric_revisions`;
- bronbestand, importeur, tijdstip, bronrij en hash blijven traceerbaar.

## Rechten

- Manager ziet uitsluitend de aan het account gekoppelde vestiging.
- Admin ziet alle vestigingen en de importhistorie.
- De server dwingt deze begrenzing af; de interface is niet de enige beveiligingslaag.

## Nog open voor latere integratie

- directe koppeling met de originele HealthPlanner-e-mail of API;
- automatische omzetting van de rapportbijlage naar het genormaliseerde importprofiel;
- formele bevestiging van HealthPlanner-definities zoals `slapend`, `niet recent`, `potentiële klant` en `succesratio`;
- omgang met eventuele correcties die HealthPlanner zelf achteraf in historische rapporten uitvoert.

Deze open punten blokkeren de gevalideerde handmatige V1.5-import niet, maar wel een volledig automatische bronkoppeling.
