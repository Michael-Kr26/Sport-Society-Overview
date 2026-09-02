# R8 — Staffing + uren

**Branch:** `design/quiet-blue-ui-overhaul`

R8 haalt bezettingsanalyse en urenanalyse uit de Excel-/legacy-autoriteitslaag. Vanaf de betrouwbare Rooster V2-baseline zijn concrete **gepubliceerde canonical shifts** de primaire bron voor zowel bezetting als geplande uren.

## Brongrens

De overgangsgrens is bewust gelijk aan de R1-planningsbaseline:

- vanaf `2026-09-01`: nieuwste gepubliceerde Rooster V2-versie is leidend;
- maanden vóór september 2026: historische `roster_items` blijven leesbaar zodat oude uren niet verdwijnen;
- conceptversies tellen nooit mee voor operationele bezetting of definitieve maanduren;
- open diensten tellen als open capaciteit maar leveren geen medewerkeruren en geen aanwezige medewerker op;
- Excel/legacy mag vanaf september 2026 alleen nog als **shadow parity** worden gebruikt.

Dit verandert niets aan het R7-rechtencontract: Managers kunnen analyses lezen, maar krijgen geen Planner- of roosterbewerkingsrechten.

## Coveragevensters uit de database

R8 introduceert `staffing_coverage_windows`.

Per vestiging en ISO-weekdag worden opgeslagen:

- begin- en eindtijd;
- label;
- hard minimum;
- geadviseerd minimum;
- actief/inactief;
- bronmetadata.

De bestaande Sport Society-dienstvensters zijn idempotent als R8-baseline geseed. Daarmee staat de vaste coveragekalender niet langer hardcoded in de actieve browseranalyse.

De reeds bestaande `staffing_settings` blijven de bron voor onder andere:

- avondpiek;
- groepslesminimum/-advies;
- enkele-bezetting uitzonderingen;
- zomeruitsluitingen;
- full/waitlist-signalen.

## Backend staffing-engine

`lib/roster-operations.js` voert de staffinganalyse server-side uit.

De engine:

1. leest de coveragevensters uit `staffing_coverage_windows`;
2. leest de actuele staffingstandaarden uit de database;
3. haalt uitsluitend shifts uit de **hoogste gepubliceerde `version_no`** per locatie/week;
4. zet UTC naar lokale vestigingstijd om via de location-timezone;
5. splitst relevante tijdsgrenzen in analyseblokken;
6. bepaalt per blok hard minimum, adviesminimum en uitzonderingen;
7. classificeert als `under`, `vulnerable` of `sufficient`;
8. rapporteert open diensten apart zonder ze als medewerkerbezetting te tellen.

De actieve pagina `staffing.html` gebruikt alleen `/api/roster-operations/staffing`. De oude `staffing.js` en `staffing-coverage.js` blijven tijdens de overgang in de repository, maar zijn niet meer gekoppeld aan de operationele pagina. Verwijdering hoort bij R11.

### Manager-scope

- Admin kan organisatiebreed analyseren;
- Manager kan alleen de vestiging(en) uit de actieve organisatorische `user_location_scopes` analyseren;
- deze scopes geven nog steeds **geen** roosterbewerkingsrecht.

## Groepslesdruk

De personeelsbezetting en coverage zijn canonical/database-gedreven, maar de huidige groepslesdruk heeft nog geen live canonical bron. R8 behoudt daarom tijdelijk de bestaande weektemplates als `historical-template`.

Dat is expliciet een overgangsbron. De staffingrespons vermeldt deze bron apart, zodat zij later door bijvoorbeeld DEWI of een andere live lesroosterbron kan worden vervangen zonder de roosterwaarheid opnieuw te veranderen.

## Urenanalyse

Vanaf september 2026 gebruikt `analyzeHours()`:

- medewerkers en dienstverbanden uit R1-masterdata;
- effective-dated `contract_terms.weekly_minutes` voor contractomvang;
- uitsluitend nieuwste gepubliceerde canonical shifts voor geplande uren;
- `hour_adjustments` voor expliciete credited/bank-correcties;
- bestaande openingsstanden voor continuïteit van de urenbank.

De huidige maandnorm blijft conform het bestaande urencontract:

`weekly_contract_hours × 4,33`

Een draftwijziging verandert dus geen officieel urenoverzicht. Pas een R6-publicatie maakt de wijziging zichtbaar in R8.

De actieve `hours.html` gebruikt `/api/roster-operations/hours`; de browser-Excel-overlay uit `hours-linked-ui.js` is niet meer gekoppeld aan de pagina.

## Historische continuïteit

Voor maanden vóór `2026-09` gebruikt R8 bewust nog de legacy-historische bron. Dat voorkomt dat de migratie naar Rooster V2 oude managementinformatie onzichtbaar maakt.

Deze historische fallback is geen terugvalmechanisme voor nieuwe maanden: september 2026 en later blijven canonical published.

## Shadow parity

`/api/roster-operations/parity` is Admin-only.

Per medewerker worden canonical published uren en legacy uren naast elkaar gezet met status:

- `match`;
- `different`;
- `canonical_only`;
- `legacy_only`.

Shadow parity:

- corrigeert canonical data niet;
- publiceert niets terug naar Excel;
- heeft geen effect op de urenbank;
- dient uitsluitend als overgangs- en datakwaliteitscontrole.

CLI:

```bash
npm run report:roster-operations-parity -- 2026-09
```

## API

- `GET /api/roster-operations/staffing` — Manager/Admin;
- `GET /api/roster-operations/hours` — Manager/Admin;
- `GET /api/roster-operations/parity` — Admin-only.

De R7 serverguard kent deze minimumrollen ook; de R8-routes controleren de actieve sessie zelf opnieuw.

## Migratie en startup

`migrate-roster-operations.js`:

- migreert de onderliggende publicatielaag veilig mee;
- maakt/seedd `staffing_coverage_windows` idempotent;
- ondersteunt `--quiet`;
- is de bovenste roostermigratie in `npm start`.

De stille startup blijft compact:

```text
migrate-roster-operations --quiet → employee-name migration --quiet → hours migration → server
```

## Tests

R8-contracttests controleren onder andere:

- 51 baseline coveragevensters in de database;
- alleen de hoogste published versie telt;
- drafts worden genegeerd;
- open diensten tellen voor nul medewerkeruren;
- geen bezetting wordt `under`;
- enkele bezetting wordt `vulnerable`, behalve waar een vastgelegde uitzondering dit toestaat;
- avondpiek vereist twee medewerkers;
- september+ gebruikt canonical published uren en canonical contractterms;
- pre-baseline historie blijft leesbaar;
- shadow parity detecteert gelijkheid en afwijkingen;
- actieve staffing-/urenpagina’s laden de nieuwe R8-API en niet de oude browser-/Excel-overlay.

**Status: R8 afgerond.**
