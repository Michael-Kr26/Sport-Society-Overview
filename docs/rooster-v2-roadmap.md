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

## R2 — nieuwe rooster-datalaag

Vaste keuzes uit de R2-vragenlijst:

- [x] diensttypes beperkt tot vloer / administratie / stage;
- [x] geen aparte pauzelogica;
- [x] open diensten ondersteunen vrije notitie;
- [x] recurring patterns ondersteunen ieder positief weekinterval;
- [x] patternhistorie blijft effective-dated;
- [x] beschikbaarheid wordt als vaste categorie opgeslagen;
- [x] ontbrekende beschikbaarheid = onbekend;
- [x] incidentele beschikbaarheidsuitzonderingen zijn toegestaan na overleg;
- [x] beschikbaarheid en locatie-eligibility worden waarschuwingen, geen hard blocks;
- [x] vakantie/ziekte/verlof blijven apart van beschikbaarheid;
- [x] harde roosterhorizon 6 weken, streef 12 weken, generator 24 weken;
- [x] genereren gebeurt on demand;
- [x] patternwijzigingen propagateren automatisch naar toekomstige weken;
- [x] gepubliceerde historie blijft immutable via nieuwe versies/republish;
- [x] maximaal één actieve draft per locatie-week;
- [x] wijzigingsreden na publicatie wordt service-regel en CML-hook is voorbereid;
- [x] alleen Admin publiceert;
- [x] batch-publicatie ondersteunt meerdere locaties en meerdere weken;
- [x] dubbele dienst wordt later hard conflict;
- [x] contractafwijkingen gaan richting urenbank en blokkeren niet;
- [x] open diensten en staffingtekorten blokkeren publicatie niet;
- [x] ISO-week maandag t/m zondag.

Technische acceptatie:

- [x] relationele tabellen voor periods/versions/shifts/patterns;
- [x] beschikbaarheidspatterns en exceptions;
- [x] publication + publication-version koppeling;
- [x] publication changes + audit/CML-hook;
- [x] optimistic locking op draft revision;
- [x] database-triggers maken published versions/shifts immutable;
- [x] persistente queue voor automatische patternpropagatie;
- [x] R2-tests toegevoegd;
- [x] GitHub Actions groen op de R2-implementatie.

**Status: R2 afgerond.**

## R3 — roosterdomainservice

R3 maakt de R2-tabellen daadwerkelijk bruikbaar als roostermotor.

- [x] `AuthorizationService`: organisatiebreed gepubliceerd lezen, Manager eigen edit-scope, Admin publiceren;
- [x] `DraftService`: on-demand drafts, published → draft clone en optimistic locking;
- [x] `PatternService`: local-time generatie, stable shift UID en automatische propagatie;
- [x] handmatige pattern-weekexceptions voorkomen dat incidentele edits door sync worden teruggedraaid;
- [x] structurele patternwijziging synchroniseert bestaande toekomstige drafts automatisch;
- [x] reeds gepubliceerde toekomstige weken krijgen een nieuwe draft en worden klaargezet voor republish;
- [x] `ValidationService`: overlap en ontbrekend dienstverband hard; open shift/beschikbaarheid/locatie warnings;
- [x] beschikbaarheidsexception wint van structureel availability-pattern;
- [x] contractverschillen blokkeren niet en worden urenbankprojectie;
- [x] `HoursService`: organisatiebrede geplande minuten versus effective-dated contractminuten;
- [x] `QueryService`: actuele draft, nieuwste published, medewerkerrooster en open diensten;
- [x] `PublicationService`: atomaire batch, diff, audit/CML-hook en verplichte reden na eerdere publicatie;
- [x] published historie blijft immutable;
- [x] staffing wordt in R3 niet gefingeerd; definitieve coverage-engine blijft R8;
- [x] R3-migratie en domeintests opgenomen in `npm test`;
- [x] GitHub Actions groen op de R3-implementatie.

De goedgekeurde nieuwe frontend van het wijzigingsformulier blijft behouden. De huidige overgangsroute schrijft voorlopig nog naar legacy overrides + bestaande CML; de backend wordt pas bewust naar R3 canonical shifts omgezet wanneer de legacy adapter/planner/publicatieflow daarop zijn aangesloten.

R3 bevat de **domeinkern** van publiceren. R6 blijft nodig voor de volledige operationele publicatieflow: API/UI-orkestratie, horizoncontrole, changed-since-last-publication, CML-projectie/notificaties en éénklik urgente/structurele republish.

**Status: R3 afgerond.**

## R4 — legacy importadapter

R4 maakt van de bestaande Excel-/legacybron gecontroleerde canonical drafts zonder Excel publicatierechten te geven.

- [x] adapter leest het effectieve legacy-rooster uit `roster_items + roster_overrides`;
- [x] alleen data vanaf de betrouwbare baseline `2026-09-01` wordt naar V2 gemapt;
- [x] employee- en locatiekoppeling gebruikt uitsluitend R1-masterdata/aliases en verzint niets;
- [x] legacy diensten worden per locatie/week naar canonical shifts met UTC-tijden vertaald;
- [x] legacy shifts krijgen stabiele `LEGACY:*` UID en bronherleidbaarheid;
- [x] legacy diensttype wordt veilig als `floor` gemapt omdat Excel administratie/stage niet betrouwbaar onderscheidt;
- [x] ziekte/vakantie/TVT/overige niet-shifts worden apart gestaged met bronpayload;
- [x] unresolved medewerkers/locaties/tijden worden persistent gerapporteerd;
- [x] dezelfde import is idempotent en maakt geen onnodige extra versies;
- [x] een volledig import-managed draft kan automatisch worden gereconcilieerd;
- [x] een draft met handmatige/pattern-data wordt `protected_draft` en niet overschreven;
- [x] wijzigingen/verwijderingen uit Excel worden in een veilige import-draft weerspiegeld;
- [x] als published al gelijk is aan Excel wordt geen overbodige draft gemaakt;
- [x] als published afwijkt wordt uitsluitend een nieuwe draft met `based_on_version_id` gemaakt;
- [x] published versies/shifts worden door de adapter nooit gemuteerd;
- [x] iedere import schrijft een persistent parityrapport per batch en per locatie/week;
- [x] `npm run report:roster-parity` toont het laatste parityrapport;
- [x] de bestaande `import:roster`-keten voert de canonical adapter als laatste stap uit;
- [x] R4-tests zijn opgenomen in `npm test`.

Een paritystatus `attention` is bewust geen stille correctie en ook geen publicatieblokkade vanuit Excel: de import is technisch gelukt, maar unresolved items of beschermde drafts moeten door een beheerder worden bekeken.

De goedgekeurde change-form frontend blijft in R4 intact. Omdat de adapter ook `roster_overrides` leest, zijn via het formulier gemaakte operationele wijzigingen wel zichtbaar in de canonical overgangslaag. De daadwerkelijke formulierwrite wordt pas in de planner/publicatieflow volledig naar canonical drafts omgezet.

**Status: R4 afgerond.**

## R5 — nieuwe weekplanner

R5 maakt de canonical R2/R3-roosterdatalaag operationeel bruikbaar voor dagelijkse planning.

- [x] `planner.html` is de aparte bewerkbare roosterwerkplek;
- [x] `roster.html` is afgesplitst als read-only published overzicht;
- [x] week- en vestigingsnavigatie;
- [x] zeven dagkolommen desktop en dagtabs mobiel;
- [x] shift drawer zonder drag-and-drop;
- [x] vloer / administratie / stage;
- [x] open diensten;
- [x] shift toevoegen, wijzigen en verwijderen;
- [x] optimistic locking;
- [x] validatie- en waarschuwingspaneel;
- [x] urenbankprojectie;
- [x] Manager alleen eigen edit-scope, Admin alle locaties;
- [x] Employee uitsluitend published;
- [x] handmatige edits/verwijderingen worden beschermd tegen legacy/pattern sync;
- [x] wijzigingsformulier spiegelt wijzigingen direct naar de canonical overgangslaag;
- [x] quiet-blue frontend behouden als actuele ontwerpvariant;
- [x] R5-tests opgenomen in `npm test`;
- [x] GitHub Actions groen op de R5-implementatie.

**Status: R5 afgerond.**

## R6 — publicatiemotor

R6 maakt de R3-publicatiekern operationeel en zorgt dat de gepubliceerde canonical shifts daadwerkelijk de officiële roosterweergave kunnen voeden.

- [x] Admin-only publicatie-API;
- [x] publicatiedrawer in de Planner;
- [x] selectie van meerdere locaties en meerdere weken;
- [x] changed-since-last-publication preview;
- [x] toegevoegd / gewijzigd / verwijderd per stable `shift_uid`;
- [x] harde validation errors blokkeren de volledige batch;
- [x] waarschuwingen blokkeren niet;
- [x] reden verplicht bij iedere herpublicatie;
- [x] 6-weken minimum, 12-weken target en 24-weken horizon zichtbaar per vestiging;
- [x] geprojecteerde horizon zichtbaar vóór publicatie;
- [x] atomaire batchpublicatie via R3 `PublicationService`;
- [x] published historie blijft immutable;
- [x] laatste publicaties zichtbaar in de publicatiedrawer;
- [x] herpublicatie projecteert één samenvattende `Roosterpublicatie` naar het CML;
- [x] `Roosterpublicatie`-CML-regels zijn backend én frontend immutable;
- [x] notification-outbox voor `roster_published` en `roster_changed`;
- [x] wijzigingsformulier kan een veilige reeds gepubliceerde week direct herpubliceren;
- [x] wijzigingsformulier maakt daarbij geen dubbele CML-regel;
- [x] protected drafts, eerste publicatie en hard conflicts worden niet stil via het wijzigingsformulier gepubliceerd;
- [x] R6-migratie is opgenomen in de stille serverstart;
- [x] R6-tests zijn opgenomen in `npm test`;
- [x] GitHub Actions groen op de volledige R6-implementatie.

Zie `docs/r6-publication-engine.md` voor het volledige publicatiecontract.

**Status: R6 afgerond.**

## R7 — rechten

R7 maakt de roosterrechten server-side afdwingbaar en verwijdert legacy velden/browserstate als security boundary.

- [x] `roster.html` vereist server-side minimaal Employee;
- [x] `planner.html` vereist server-side minimaal Manager;
- [x] published rooster blijft organisatiebreed voor Employee, Manager en Admin;
- [x] Guest heeft standaard geen rooster-API of roosterpagina-toegang;
- [x] legacy `/api/roster` en `/api/roster-effective` zijn niet meer anoniem opvraagbaar;
- [x] `/api/roster-preview` is Admin-only;
- [x] planner-API heeft een centrale sessiegrens en R3 controleert daarna draft-scope per locatie/week;
- [x] `user_location_scopes` is de enige autoriteitsbron voor Manager-editrecht;
- [x] Manager-scopes blijven effective-dated;
- [x] `users.location` verleent zelfstandig geen roosterrecht;
- [x] bestaande account-UI synchroniseert een Manager-locatie naar een canonical scope;
- [x] nieuwe Manager-scopes worden niet met terugwerkende kracht vóór accountaanmaak gebackfilled;
- [x] Managerdemotie trekt open edit-scopes in;
- [x] meerdere canonical Manager-scopes blijven technisch mogelijk;
- [x] Manager kan nooit publiceren; Admin blijft de enige publicatierol;
- [x] wijzigingsformulier en publication API blijven Admin-only;
- [x] browser-/frontendrol is alleen UX; iedere beschermde actie wordt server-side opnieuw gecontroleerd;
- [x] `/api/access/roster-policy` maakt de actuele roosterrechten/scopes inspecteerbaar;
- [x] R7-rechtenmatrix en effective-date-randgevallen zijn opgenomen in `npm test`.

Zie `docs/r7-access-control.md` voor het volledige rechtencontract.

**Status: R7 afgerond zodra de definitieve GitHub Actions-run op deze roadmapstand groen is.**
