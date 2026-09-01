# Sport Society Overview — Roadmap Rooster V2

**Doel:** van Excel-gedreven rooster naar de Sport Society Overview-database als bron van waarheid.

**Vaste architectuurkeuze:** patterns zijn een generator; concrete gepubliceerde shifts zijn de officiële waarheid.

## Roadmap

| Fase | Onderdeel | Kernresultaat |
|---|---|---|
| R0 | Contract- en testbasis | roosterfixtures, role/access-tests, uren- en staffingfixtures, restoretest |
| R1 | Masterdata normaliseren | locations, employees, employments, contract terms, user↔employee, user location scopes |
| R2 | Nieuwe rooster-datalaag | periods/versions, shifts/patterns, availability, publications/audit, indexes, optimistic locking |
| R3 | Roosterdomainservice | Pattern, Draft, Validation, Publication, Query, Hours en Authorization services |
| R4 | Legacy importadapter | Excel → canonical draft, parityrapport, nooit direct publiceren |
| R5 | Nieuwe weekplanner | locatie/week, shift CRUD, open shifts, conflicts, mobile-first, uren |
| R6 | Publicatiemotor | validate, diff, publish, history, changed-since-last-publication, urgent publish |
| R7 | Rechten | Employee volledig gepubliceerd rooster, Manager edit-scope per vestiging, Admin organisatiebreed, Guest default deny |
| R8 | Staffing + uren | coverage rules uit DB, backend staffing engine, planned hours uit published shifts, Excel shadow parity |
| R9 | Export | ExcelJS, week-/maandexport, Graph upload, exportlog/checksum, noodrestore |
| R10 | Cutover | rooster.sportsocietyoverview.net, database officiële roosterbron, feature flags, monitoring |
| R11 | Legacy cleanup | monkeypatches/Excel-overlay weg, oude import-UI uit workflow, legacy read-only, bootstrap refactor |

## Mijlpalen

1. **Foundation — R0–R1**
2. **Core Build — R2–R6**
3. **Adoption — R7–R9**
4. **Cutover — R10–R11**

## R0 — acceptatiecontract

R0 verandert geen roosterbusinesslogica. R0 legt de huidige kritieke contractsituatie vast voordat R1 en later de datastructuur gaan wijzigen.

R0 is gereed wanneer:

- [x] een vaste fixture bestaat voor `roster_items + roster_overrides → effectief rooster`;
- [x] een urenfixture begin/eindtijd, overnight diensten en medewerkermaand-zichtbaarheid vastlegt;
- [x] een staffingfixture `under / vulnerable / sufficient` vastlegt;
- [x] een accessfixture de rolhiërarchie en Manager-vestigingsscope vastlegt;
- [x] `npm test` naast syntaxchecks ook echte Node-tests uitvoert;
- [x] databaseback-up en -verificatie dezelfde testbare library gebruiken;
- [x] een restorefunctie uitsluitend expliciet naar een gekozen doelpad herstelt;
- [x] een automatische test backup → restore → integrity_check → sentinelcontrole uitvoert op een tijdelijke database;
- [x] GitHub Actions is groen op de R0-implementatiecommit.

**Status: R0 afgerond.**

De fixturetests zijn bewust een **legacy reference contract**. Vanaf R1 moet nieuwe code tegen deze contracts worden vergeleken totdat een wijziging bewust als nieuw functioneel gedrag is goedgekeurd.

## R1 — masterdata normaliseren

R1 wordt in twee delen uitgevoerd zodat de nieuwe relationele structuur niet hoeft te wachten op het handmatig verzamelen van medewerkersgegevens.

### R1A — structuur en vaste organisatiegegevens

- [x] locatiecodes vastgelegd: AVE, BVE, VHU, WEK, HAR;
- [x] nieuwe `locations`-mastertabel;
- [x] relationeel skelet voor employees, employments en contract terms;
- [x] stabiele `EMP-0001` employee-code sequence;
- [x] scheiding primaire/inzetbare vestigingen voorbereid;
- [x] `user_employee_links` voorbereid;
- [x] `user_location_scopes` voor vestigingsbeheer voorbereid;
- [x] historische aliases Lucas Veenendaal → Lucas V en Lucas Leeuwis → Lucas L;
- [x] Manager/Admin access-seeds vastgelegd zonder bestaande rollen stil te wijzigen;
- [x] planningsbaseline 2026-09-01 vastgelegd;
- [x] onbekende historische startdata mogen `NULL` blijven;
- [x] masterdatamigratie en rapportage zijn idempotent/testbaar;
- [x] GitHub Actions is groen op de R1A-implementatie.

### R1B — medewerkers vullen en koppelen

- [x] 22 actuele medewerkers als canonieke septemberbaseline vastgelegd;
- [x] contract/flex en huidige contractomvang vanaf `2026-09-01` vastgelegd;
- [x] primaire vestiging per medewerker vastgelegd;
- [x] 34 inzetbaarheidskoppelingen vastgelegd;
- [x] Lucas Leeuwis wordt canoniek `Lucas L`;
- [x] exact herkenbare user-accounts kunnen aan employees worden gekoppeld;
- [x] accountrol-afwijkingen worden gerapporteerd maar niet stil aangepast;
- [x] opnieuw migreren overschrijft latere handmatige correcties niet;
- [x] beschikbaarheid blijft expliciet leeg totdat medewerkers die hebben teruggekoppeld;
- [x] GitHub Actions groen op de R1B-implementatie.

Historische contractstartdata zijn **niet vereist**. Bestaande medewerkers hebben `starts_on = NULL` zolang die oude startdatum onbekend is; `known_from = 2026-09-01` legt alleen vast vanaf wanneer de gegevens voor Rooster V2 betrouwbaar zijn.

**Status: R1 afgerond.**
