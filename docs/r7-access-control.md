# R7 — Roosterrechten

**Branch:** `design/quiet-blue-ui-overhaul`

R7 maakt de rechtenmatrix uit R1/R3 daadwerkelijk afdwingbaar aan de serverrand. Frontendverbergen van knoppen blijft alleen UX; de server beslist altijd opnieuw op basis van de actieve sessie en canonical scopes.

## Rechtenmatrix

| Rol | Published rooster | Planner openen | Draft bekijken/bewerken | Publiceren |
|---|---|---|---|---|
| Guest | nee | nee | nee | nee |
| Employee | organisatiebreed | nee | nee | nee |
| Manager | organisatiebreed | ja | alleen toegewezen vestiging(en) | nee |
| Admin | organisatiebreed | ja | organisatiebreed | ja |

Een Employee-account hoeft niet per se aan een `employees`-record gekoppeld te zijn om het organisatiebrede published rooster te mogen bekijken. Een `user_employee_links`-koppeling is bedoeld voor medewerker-specifieke self-service, niet als voorwaarde voor basisroostertoegang.

## Autoriteitsbronnen

Voor roosterrechten gelden uitsluitend:

1. de actieve `sso_session`;
2. `users.role`;
3. effective-dated `user_location_scopes` voor Manager-editrechten;
4. de R3 `AuthorizationService` voor draftmutaties en publicatie.

`users.location` is geen roosterautorisatie. Dat veld bestaat nog voor de legacy account-UI en wordt door R7 alleen gebruikt om een nieuwe Manager-accountkoppeling naar `user_location_scopes` te synchroniseren.

`localStorage.demoRole` en eventuele client-side rolweergave zijn geen security boundary. Een gemanipuleerde browserstate kan hooguit UI beïnvloeden; de server controleert iedere beschermde roosteractie opnieuw.

## Server-side guard

`r7-access-bootstrap.js` wordt als buitenste serverbootstrap geladen en plaatst de rooster-access guard vóór bestaande routes/static delivery.

Beschermde pagina's:

- `roster.html` — minimaal Employee;
- `planner.html` — minimaal Manager;
- `cml.html` — minimaal Manager;
- `cf.html` — Admin.

Belangrijkste beschermde API-families:

- `/api/roster` — Employee+;
- `/api/roster-effective` — Employee+;
- `/api/roster-planner/*` — Employee+ aan de rand; draftmutaties worden daarna opnieuw door R3 gecontroleerd;
- `/api/roster-preview` — Admin;
- `/api/roster-publication/*` — Admin;
- `/api/change-form/*` en `/api/change-workflow` — Admin.

Guest krijgt voor API's `401`; een ingelogde rol zonder voldoende rechten krijgt `403`. Beschermde HTML-pagina's sturen een Guest naar login en een ingelogde maar onvoldoende bevoegde rol naar Home.

## Manager-scopes

Manager-editrechten blijven effective-dated:

- `effective_from` bepaalt de eerste geldige datum;
- `effective_to` is inclusief en optioneel;
- buiten die periode bestaat geen editrecht;
- meerdere vestigingen kunnen technisch tegelijk geldig zijn;
- `can_edit_roster=1` is vereist;
- `can_publish_roster` geeft een Manager geen publicatierecht: publiceren blijft uitsluitend Admin.

De account-UI heeft historisch één `users.location`-veld. R7 maakt daar geen tweede autoriteitsbron van. Bij het aanmaken/updaten van een Manager met zo'n legacy locatie zorgt een database-trigger dat minimaal de corresponderende canonical scope bestaat. Bestaande canonical scopes worden niet stil verwijderd, zodat multi-location Manager-scopes mogelijk blijven.

Bij demotie van Manager naar een andere rol worden nog open Manager-scopes beëindigd/verwijderd. Daarnaast controleert de R3-domainlaag altijd de actuele accountrol, zodat een achtergebleven historische scope nooit zelfstandig rechten kan verlenen.

Nieuwe Manager-scopes worden niet teruggedateerd. Alleen een bestaand legacy Manager-account zonder enige canonical scope kan tijdens R7-migratie een éénmalige backfill krijgen; de ingangsdatum is nooit eerder dan de R1-planningsbaseline en nooit eerder dan de accountaanmaakdatum.

## Planner

`planner.html` mag door Manager en Admin worden geopend.

Dit betekent niet dat een Manager ieder concept kan bekijken. Voor iedere locatie/week bepaalt `AuthorizationService.canEditLocation()` opnieuw of er op die effectieve datum een geldige scope bestaat:

- geldige scope → draft kan worden bekeken/bewerkt;
- geen scope → alleen de published organisatiebrede weergave;
- Employee → published only, en krijgt de Plannerpagina zelf niet;
- Admin → alle locaties en drafts.

Shift create/update/delete en draft-create gebruiken dezelfde server-side scopecontrole. Het wijzigen van URL's, request bodies of DOM-elementen om een andere vestiging te selecteren omzeilt dit niet.

## Published rooster

Het published rooster blijft organisatiebreed voor Employee, Manager en Admin. Dit is bewust niet beperkt tot primaire vestiging of Manager-scope.

De pagina `roster.html` leest uitsluitend canonical published versions. Drafts zijn via deze pagina niet opvraagbaar.

De legacy endpoints blijven tijdens de overgang bestaan, maar R7 zet daar nu dezelfde minimale sessiegrens voor: zij zijn niet meer anoniem opvraagbaar.

## Publiceren

R6-publicatie blijft Admin-only op twee niveaus:

- de R7 serverrand vereist Admin voor de publication API;
- R3/R6 `AuthorizationService.assertCanPublish()` controleert dit opnieuw binnen de domeinservice.

Een Manager-scope met `can_publish_roster` kan daardoor niet stil tot publicatierecht leiden. Die kolom blijft gereserveerd voor eventuele toekomstige beleidswijziging.

## Tests

`tests/roster-access.test.js` controleert onder andere:

- Guest deny;
- Employee published access;
- Employee geen Planner/edit;
- Manager Planner maar geen publicatie;
- Admin organisatiebreed + publiceren;
- Manager-scope vóór `effective_from` ongeldig;
- Manager-scope na `effective_to` ongeldig;
- geen editrecht op een andere vestiging;
- legacy Manager-account → canonical scope;
- Managerdemotie trekt editrecht in;
- serverstart loopt via de R7-guard;
- belangrijkste roosterpagina/API-minimumrollen zijn centraal vastgelegd.

**Status: R7 afgerond.**
