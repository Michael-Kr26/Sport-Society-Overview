# R5 — Nieuwe weekplanner

**Status: afgerond op `agent/v1-5-operational-release`; rechtenbeleid later aangescherpt in R7.**

R5 maakt de canonical R2/R3-roosterdatalaag operationeel bruikbaar via de aparte Planner, zonder de publicatieflow van R6 vooruit te lopen.

## Gebruikersinterface

- weeknavigatie maandag t/m zondag;
- vestigingsselectie voor AVE, BVE, VHU, WEK en HAR;
- desktopweergave met zeven dagkolommen;
- compacte mobiele dagtabs;
- diensten gegroepeerd als ochtend, middag/avond en overig;
- concept/gepubliceerd-schakelaar waar de rol dat toestaat;
- status van concept/gepubliceerde versie zichtbaar;
- shift editor in een drawer, bewust zonder drag-and-drop;
- dienst toevoegen, wijzigen en verwijderen;
- open diensten via `employee_id = NULL`;
- diensttypes vloer, administratie en stage;
- notities op diensten;
- conflict-/waarschuwingspaneel;
- urenbankprojectie voor de conceptweek.

## Rechten

De oorspronkelijke R5-implementatie ondersteunde Manager-edit-scope per vestiging. **R7 heeft dit beleid expliciet vervangen.** De actuele regel is:

- Employee ziet uitsluitend gepubliceerde roosters;
- Manager ziet eveneens uitsluitend het organisatiebrede gepubliceerde rooster;
- Manager kan de Planner niet openen en geen draft aanmaken of wijzigen;
- alleen Admin kan alle vestigingen in de Planner bewerken;
- publicatie blijft eveneens Admin-only.

De Planner-service controleert Admin vóór iedere create/update/delete-mutatie, los van eventuele historische `user_location_scopes`.

## API/service

`lib/roster-planner.js` vertaalt de R3-domainservices naar een plannercontext en lokale `Europe/Amsterdam` tijden.

`roster-planner-bootstrap.js` biedt:

- `GET /api/roster-planner/context`;
- `POST /api/roster-planner/draft`;
- `POST /api/roster-planner/shifts`;
- `PATCH /api/roster-planner/shifts/:shiftUid`;
- `DELETE /api/roster-planner/shifts/:shiftUid`.

De GET-context blijft Employee+ omdat `roster.html` daarmee published canonical data leest. Draftmutaties zijn sinds R7 uitsluitend Admin. Mutaties gebruiken optimistic locking via `expectedRevision`.

## Legacy-overgang

De bestaande, goedgekeurde change-form blijft bestaan.

Na een wijziging via `/api/change-workflow`:

1. blijft de CML/legacy-registratie intact;
2. wordt de effectieve legacybron direct opnieuw naar de canonical overgangslaag gespiegeld;
3. wordt published nooit gemuteerd;
4. wordt een bestaande handmatige canonical draft niet door de legacy-import overschreven.

Handmatige wijzigingen/verwijderingen in de weekplanner krijgen een exception-marker zodat een latere Excel-import ze niet stil terugdraait.

## Terminal/startup

De serverstart is compacter gemaakt:

- R2 wordt niet meer apart vóór R3 gedraaid, omdat de R3-migratie R1/R2 zelf al veilig meeneemt;
- R3-migratie draait bij `npm start` met `--quiet`;
- legacy-naamsmigratie draait bij `npm start` met `--quiet`;
- de losse succesvolle `Database verbonden`-regel wordt bij normale serverstart onderdrukt;
- fouten blijven zichtbaar;
- handmatig uitgevoerde migratiecommando's blijven standaard hun rapportage tonen.

## Tests

De huidige regressietests dekken onder andere:

- concept aanmaken door Admin;
- lokale tijd ↔ UTC;
- shift CRUD;
- open diensten;
- optimistic locking;
- Manager published-only en geen Planner-mutaties;
- Employee published-only;
- bescherming van handmatige wijzigingen tegen latere Excel-import;
- bescherming van handmatig verwijderde diensten tegen terugplaatsing door Excel.

De volledige bestaande testketen en PowerShell-checks blijven onderdeel van de quality gate.

## Niet onderdeel van R5

R6 blijft verantwoordelijk voor de volledige publicatiemotor in de operationele UI/API, waaronder validate/diff/publish, publicatiehistorie, changed-since-last-publication en urgente republish-flow.
