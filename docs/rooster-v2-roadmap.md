# Sport Society Overview — Roadmap Rooster V2

**Doel:** van Excel-gedreven rooster naar de Sport Society Overview-database als bron van waarheid.

**Vaste architectuurkeuze:** patterns zijn een generator; concrete gepubliceerde shifts zijn de officiële waarheid.

## Roadmap

| Fase | Onderdeel | Kernresultaat |
|---|---|---|
| R0 | Contract- en testbasis | roosterfixtures, role/access-tests, uren- en staffingfixtures, restoretest |
| R1 | Masterdata normaliseren | locations, employees, employments, contract terms, user↔employee, user location scopes |
| R2 | Nieuwe rooster-datalaag | periods/versions, shifts/patterns, publications/audit, indexes, optimistic locking |
| R3 | Roosterdomainservice | Pattern, Draft, Validation, Publication, Query, Hours en Authorization services |
| R4 | Legacy importadapter | Excel → canonical draft, parityrapport, nooit direct publiceren |
| R5 | Nieuwe weekplanner | locatie/week, shift CRUD, open shifts, conflicts, mobile-first, uren |
| R6 | Publicatiemotor | validate, diff, publish, history, changed-since-last-publication, urgent publish |
| R7 | Rechten | Employee eigen rooster, Manager vestigingsscope, Admin organisatiebreed, Guest default deny |
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
- [ ] GitHub Actions is groen op de R0-commit.

De fixturetests zijn bewust een **legacy reference contract**. Vanaf R1 moet nieuwe code tegen deze contracts worden vergeleken totdat een wijziging bewust als nieuw functioneel gedrag is goedgekeurd.
