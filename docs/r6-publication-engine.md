# R6 — Publicatiemotor

**Branch:** `design/quiet-blue-ui-overhaul`

R6 maakt de immutable publication-kern uit R3 operationeel bruikbaar vanuit de Planner en koppelt publicaties aan horizoncontrole, CML, notificatie-outbox en publicatiehistorie.

## Gebruikersflow

De Planner blijft de enige werkplek voor conceptroosters. `roster.html` blijft uitsluitend de gepubliceerde waarheid tonen.

Voor Admin is in de Planner een knop **Publiceren** beschikbaar. De publicatiedrawer ondersteunt:

- alle open concepten binnen de 24-weken planningshorizon;
- selectie van meerdere vestigingen en meerdere weken in één batch;
- actuele publicatiehorizon per vestiging;
- 6 weken als bedrijfsminimum;
- 12 weken als streefgrens;
- preview vóór publicatie;
- harde validatiefouten versus waarschuwingen;
- changed-since-last-publication diff;
- aantallen toegevoegd / gewijzigd / verwijderd;
- verplichte reden bij herpublicatie;
- definitieve atomaire batchpublicatie;
- laatste publicaties in de UI.

Managers behouden hun edit-scope voor toegewezen vestigingen, maar krijgen geen publicatierecht. Alleen Admin kan de publicatie-API gebruiken.

## Publicatiecontract

Een publicatie gebruikt de bestaande R3 `PublicationService` als transactionele kern:

1. alle geselecteerde versions moeten `draft` zijn;
2. iedere version wordt opnieuw gevalideerd;
3. één hard conflict blokkeert de volledige batch;
4. waarschuwingen blokkeren niet;
5. bij een herpublicatie is een reden verplicht;
6. alle versions worden in één database-transactie gepubliceerd;
7. published versions en shifts blijven immutable;
8. per `shift_uid` wordt de diff toegevoegd / gewijzigd / verwijderd vastgelegd;
9. period-pointers worden naar de nieuwe published versie gezet;
10. audit-events en publication-history blijven bewaard.

Er bestaat geen in-place wijziging van een gepubliceerd rooster. Een wijziging is altijd:

`published vN → nieuwe draft → validatie → published vN+1`.

## Publicatiehorizon

R6 leest de R2-instellingen uit `roster_settings`:

- minimum: 6 weken;
- target: 12 weken;
- generatie/planning: 24 weken.

Per actieve vestiging wordt vanaf de huidige week bepaald hoeveel **aaneengesloten toekomstige weken** gepubliceerd zijn. De UI toont:

- `critical`: minder dan 6 weken;
- `minimum`: minimaal 6 maar minder dan 12 weken;
- `target`: 12 weken of meer.

Een publicatiepreview toont ook de geprojecteerde horizon wanneer de geselecteerde drafts worden gepubliceerd.

## CML

Bij een eerste publicatie ontstaat geen kunstmatige CML-wijzigingsregel; de volledige publicatiehistorie staat al in de publication-tabellen.

Bij een wijziging van een eerder gepubliceerd rooster maakt de normale Planner-publicatie per getroffen locatie-week één CML-regel met type `Roosterpublicatie`. Deze bevat:

- vestiging;
- week;
- reden;
- aantallen toegevoegd / gewijzigd / verwijderd;
- invoerder;
- status `Afgerond`.

Een door R6 gegenereerde `Roosterpublicatie`-regel is immutable. Database-triggers blokkeren update en delete. De CML-frontend toont deze regel eveneens als vastgelegd in plaats van als bewerkbare workflowregel.

## Wijzigingsformulier

De eerder goedgekeurde change-form blijft de primaire snelle route voor een concrete operationele roosterwijziging.

De route blijft:

`wijzigingsformulier → CML + operationele override → canonical sync`.

Wanneer die wijziging een reeds gepubliceerde week raakt, mag R6 automatisch herpubliceren als:

- de canonical adapter een nieuwe veilige draft heeft gemaakt;
- alle geselecteerde versions daadwerkelijk herpublicaties zijn;
- de validation service geen hard conflict vindt;
- er geen protected handmatige draft wordt overschreven.

In dat geval wordt de reden uit het wijzigingsformulier gebruikt als publicatiereden. Er wordt **geen tweede CML-regel** aangemaakt, omdat de concrete wijziging al in het CML staat. De notification-outbox en publication state worden wel via dezelfde R6-workflow verwerkt.

Een eerste publicatie wordt nooit stil via het wijzigingsformulier uitgevoerd. Ook een blocked/protected situatie gaat terug naar de Planner voor bewuste controle.

## Notificatie-outbox

R6 levert nog geen extern notificatiekanaal. Het legt wel persistent vast wie door een publicatie geraakt is in `roster_notification_outbox`.

Events:

- `roster_published` — medewerker komt voor in een eerste publicatie;
- `roster_changed` — medewerker zit in de before/after-diff van een herpublicatie.

De outbox is idempotent per publication + period + employee + event. De delivery state ondersteunt `pending`, `sent` en `failed` zodat een latere notifier geen roosterbusinesslogica hoeft te reconstrueren.

## Publicatiehistorie

De publication drawer toont de laatste publicaties met:

- tijdstip;
- Admin;
- aantal locatie-week versions;
- aantal shiftwijzigingen;
- publicatiereden;
- notification state.

De onderliggende historie blijft beschikbaar in:

- `roster_publications`;
- `roster_publication_versions`;
- `roster_publication_changes`;
- `audit_events`.

## API

Admin-only:

- `GET /api/roster-publication/candidates`
- `GET /api/roster-publication/horizon`
- `POST /api/roster-publication/prepare`
- `POST /api/roster-publication/publish`
- `GET /api/roster-publication/history`

De normale weekplanner-API uit R5 blijft ongewijzigd voor draft CRUD.

## Datalaag

R6 voegt toe:

- `roster_publication_cml_links` — koppelt een R6-herpublicatie aan zijn CML-samenvatting;
- `roster_notification_outbox` — persistente queue voor toekomstige medewerker-notificaties;
- database-triggers die CML-regels van type `Roosterpublicatie` immutable maken zodra de `changes`-tabel beschikbaar is.

Migratie:

`npm run migrate:rosterpublication`

Bij normale serverstart draait deze migratie stil via `npm start`.

## Tests

De R6-tests controleren onder andere:

- eerste publicatie;
- changed-since-last-publication preview;
- reason required bij republish;
- immutable published historie;
- immutable `Roosterpublicatie`-CML;
- CML-projectie bij normale herpublicatie;
- CML-projectie overslaan wanneer het wijzigingsformulier de wijziging al vastlegt;
- notification-outbox bij eerste publicatie en republish;
- batchpublicatie meerdere locaties;
- Manager kan niet publiceren;
- publicatiehorizon;
- publicatiehistorie.

R6 wordt pas als afgerond gemarkeerd wanneer de definitieve branchstand volledig groen is in GitHub Actions.
