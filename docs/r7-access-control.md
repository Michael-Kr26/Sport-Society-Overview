# R7 — Roosterrechten

**Branch:** `design/quiet-blue-ui-overhaul`

R7 maakt de roosterrechten daadwerkelijk afdwingbaar aan de serverrand. De definitieve beleidskeuze is expliciet: **Managers mogen het rooster niet plannen. Alleen Admin mag drafts openen, wijzigen en publiceren.** Frontendverbergen van knoppen blijft alleen UX; de server beslist altijd opnieuw op basis van de actieve sessie.

## Rechtenmatrix

| Rol | Published rooster | Planner openen | Draft bekijken/bewerken | Publiceren |
|---|---|---|---|---|
| Guest | nee | nee | nee | nee |
| Employee | organisatiebreed | nee | nee | nee |
| Manager | organisatiebreed | nee | nee | nee |
| Admin | organisatiebreed | ja | organisatiebreed | ja |

Een Employee- of Manager-account hoeft niet per se aan een `employees`-record gekoppeld te zijn om het organisatiebrede published rooster te mogen bekijken. Een `user_employee_links`-koppeling is bedoeld voor medewerker-specifieke self-service, niet als voorwaarde voor basisroostertoegang.

## Autoriteitsbronnen

Voor roosterrechten gelden uitsluitend:

1. de actieve `sso_session`;
2. `users.role`;
3. de R7 server-side policy voor Planner-toegang;
4. de Planner/R3-services voor mutaties en publicatie.

`user_location_scopes` kan een Manager nog organisatorisch aan één of meerdere vestigingen koppelen, maar verleent **geen roosterbewerkingsrecht**. R7 neutraliseert voor Manager-accounts zowel `can_edit_roster` als `can_publish_roster` naar `0`.

`users.location` is eveneens geen roosterautorisatie. Dat veld bestaat nog voor de legacy account-UI en kan alleen worden gebruikt om een organisatorische locatie-scope te synchroniseren.

`localStorage.demoRole` en eventuele client-side rolweergave zijn geen security boundary. Een gemanipuleerde browserstate kan hooguit UI beïnvloeden; de server controleert iedere beschermde roosteractie opnieuw.

## Server-side guard

`r7-access-bootstrap.js` wordt als buitenste serverbootstrap geladen en plaatst de rooster-access guard vóór bestaande routes/static delivery.

Beschermde pagina's:

- `roster.html` — minimaal Employee;
- `planner.html` — uitsluitend Admin;
- `cml.html` — minimaal Manager;
- `cf.html` — Admin.

Belangrijkste beschermde API-families:

- `/api/roster` — Employee+;
- `/api/roster-effective` — Employee+;
- `/api/roster-planner/*` — Employee+ aan de rand omdat `roster.html` de published context uit deze API leest; iedere draftmutatie is daarna expliciet Admin-only;
- `/api/roster-preview` — Admin;
- `/api/roster-publication/*` — Admin;
- `/api/change-form/*` en `/api/change-workflow` — Admin.

Guest krijgt voor API's `401`; een ingelogde rol zonder voldoende rechten krijgt `403`. Beschermde HTML-pagina's sturen een Guest naar login en een ingelogde maar onvoldoende bevoegde rol naar Home.

## Manager-locaties

Managers kunnen nog een organisatorische vestigingskoppeling hebben. Die kan later worden gebruikt voor managementweergaven, bezettingsanalyse of andere locatiegebonden functies, maar **niet om het rooster te plannen**.

R7 zorgt daarom voor het volgende:

- bestaande Manager-scopes met `can_edit_roster=1` worden bij migratie/start naar `0` gezet;
- `can_publish_roster` wordt voor Managers eveneens `0`;
- nieuwe Manager-locatiescopes worden direct met beide roosterflags op `0` aangemaakt;
- meerdere organisatorische locatiescopes blijven technisch mogelijk;
- `effective_from` / `effective_to` kunnen voor die organisatorische scope behouden blijven;
- een oude of handmatig fout ingestelde scope is niet voldoende om de Planner te gebruiken, omdat de Planner-service daarnaast expliciet `users.role === 'admin'` vereist.

Hiermee is de rol zelf doorslaggevend voor planning: **Manager = read-only rooster, Admin = planner.**

## Planner

`planner.html` mag uitsluitend door Admin worden geopend.

De Planner-service controleert dit nogmaals vóór:

- concept aanmaken;
- dienst toevoegen;
- dienst wijzigen;
- dienst verwijderen.

Ook de context die via `/api/roster-planner/context` wordt opgevraagd geeft voor Employee en Manager altijd:

- `canEdit = false`;
- `canPublish = false`;
- `canViewDraft = false`;
- geen draft-ID/revision;
- geen medewerkerkeuzelijst voor planning.

Een Manager die zelf een `view=draft`, version-ID, andere locatie of mutatiepayload probeert te sturen krijgt daardoor geen toegang tot een concept of wijzigingsactie.

## Published rooster

Het published rooster blijft organisatiebreed voor Employee, Manager en Admin. Dit is bewust niet beperkt tot primaire vestiging of Manager-locatiescope.

De pagina `roster.html` leest uitsluitend canonical published versions. Drafts zijn via deze pagina niet opvraagbaar.

De legacy endpoints blijven tijdens de overgang bestaan, maar R7 zet daar dezelfde minimale sessiegrens voor: zij zijn niet meer anoniem opvraagbaar.

## Publiceren

R6-publicatie blijft Admin-only op twee niveaus:

- de R7 serverrand vereist Admin voor de publication API;
- R3/R6 `AuthorizationService.assertCanPublish()` controleert dit opnieuw binnen de domeinservice.

Managers kunnen dus noch plannen, noch publiceren.

## Tests

De R7/R5 regressietests controleren onder andere:

- Guest deny;
- Employee published access;
- Manager published access;
- Manager geen Planner;
- Manager geen draft;
- Manager geen create/update/delete;
- ook een legacy `can_edit_roster=1`-scope wordt naar `0` geneutraliseerd;
- nieuwe Manager-locatiescope krijgt geen roosterrechten;
- Admin kan organisatiebreed plannen en publiceren;
- frontend toont Planner alleen aan Admin;
- serverstart loopt via de R7-guard;
- belangrijkste roosterpagina/API-minimumrollen zijn centraal vastgelegd.

**Status: R7 afgerond — Planner en alle roosterbewerkingen uitsluitend Admin.**
