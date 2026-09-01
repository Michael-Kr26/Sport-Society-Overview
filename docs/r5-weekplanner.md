# R5 — Nieuwe weekplanner

**Status: afgerond op `agent/v1-5-operational-release`.**

R5 maakt de canonical R2/R3-roosterdatalaag operationeel bruikbaar via `roster.html`, zonder de publicatieflow van R6 vooruit te lopen.

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

- Employee ziet uitsluitend gepubliceerde roosters;
- Manager ziet organisatiebreed gepubliceerd en kan alleen een toegewezen vestiging bewerken;
- Admin kan alle vestigingen bewerken;
- publicatie blijft Admin-only en wordt operationeel in R6 ontsloten.

## API/service

`lib/roster-planner.js` vertaalt de R3-domainservices naar een plannercontext en lokale `Europe/Amsterdam` tijden.

`roster-planner-bootstrap.js` biedt:

- `GET /api/roster-planner/context`;
- `POST /api/roster-planner/draft`;
- `POST /api/roster-planner/shifts`;
- `PATCH /api/roster-planner/shifts/:shiftUid`;
- `DELETE /api/roster-planner/shifts/:shiftUid`.

Mutaties gebruiken optimistic locking via `expectedRevision`.

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

R5-tests dekken onder andere:

- concept aanmaken;
- lokale tijd ↔ UTC;
- shift CRUD;
- open diensten;
- optimistic locking;
- Manager-vestigingsscope;
- Employee published-only;
- bescherming van handmatige wijzigingen tegen latere Excel-import;
- bescherming van handmatig verwijderde diensten tegen terugplaatsing door Excel.

De volledige bestaande testketen en PowerShell-checks zijn groen op de R5-implementatie.

## Niet onderdeel van R5

R6 blijft verantwoordelijk voor de volledige publicatiemotor in de operationele UI/API, waaronder validate/diff/publish, publicatiehistorie, changed-since-last-publication en urgente republish-flow.
