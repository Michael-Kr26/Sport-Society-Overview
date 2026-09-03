# Database-driven configuratie

Status: 2026-09-03  
Doel: operationele/masterdata uit runtime-hardcode halen en SQLite als canonieke bron gebruiken.

## Uitgangspunt

Data die een Admin in de bedrijfsvoering kan wijzigen hoort in de database. Code bevat alleen schema/migraties, domeinregels, autorisatie-invarianten en technische defaults die nodig zijn om een lege installatie te starten.

Persoonsgebonden data mag niet als seed in productcode staan. Een lege werknemersdatabase moet leeg blijven totdat een Admin medewerkers handmatig toevoegt of een expliciete import uitvoert.

## Nu database-eigendom

### Medewerkers

Canonieke tabellen:

- `employees` — stabiele `EMP-xxxx` identiteit en weergavenaam;
- `employment_periods` — dienstverband en begin/einde;
- `contract_terms` — effective-dated contractomvang;
- `employee_location_eligibility` — primaire en inzetbare vestigingen;
- `user_employee_links` — account ↔ medewerker;
- `user_location_scopes` — organisatorische locatie-scope van accounts.

Nieuwe medewerkers worden vanuit Medewerkers eerst canoniek aangemaakt. Er is geen productie-R1B-medewerkerbaseline meer en de historische Lucas-naamsmigratie draait niet meer bij startup.

De oude `hour_employee_settings`, `hour_contract_periods` en `hour_adjustments` blijven voorlopig als compatibilitylaag voor de bestaande uren-UI en historische data. Ze mogen niet langer automatisch medewerkers uit roosterregels genereren.

### Locaties

`locations` is de runtimebron voor locatie-ID, code, naam, timezone, actief-status en sortering.

De vijf bestaande vestigingen worden nog één keer als bootstrap-masterdata in de schema-migratie gegarandeerd, zodat een verse installatie kan starten. Runtime-UI en nieuwe APIs moeten niet zelf lijsten met vestigingen dupliceren.

### Rooster / beschikbaarheid / staffing

Reeds databasegestuurd:

- `roster_settings`;
- roosterperioden, versies, shifts, patterns en exceptions;
- employee availability patterns/exceptions;
- `staffing_settings` en canonical coverage windows;
- publicatie- en exporthistorie.

## Volgende hardcode om te verwijderen

### Hoge prioriteit

1. **Legacy accountlocatie `users.location`**  
   Vervangen door alleen `user_location_scopes`. De stringkolom blijft tijdelijk voor backward compatibility.

2. **Locatielijsten in oude bootstraps/UI**  
   Onder andere `access-bootstrap.js` en `manager-standards-bootstrap.js` bevatten nog een vaste lijst met vestigingsnamen. Deze moeten via `locations` worden geladen.

3. **Dubbele contractwaarheid**  
   `hour_contract_periods` en `contract_terms` bestaan naast elkaar. Canoniek doel is `employment_periods` + `contract_terms`; de urenmodule moet daar rechtstreeks uit lezen/schrijven.

4. **Legacy naamgebaseerde roosterdata**  
   `roster_items.employee_name` blijft alleen historische/importdata. Nieuwe planning hoort uitsluitend aan `employees.id` gekoppeld te zijn.

5. **Staffing coverage bootstrap**  
   Coveragevensters staan al in SQLite, maar de migratie bevat nog de initiële bedrijfsregels. Zodra een beheer-UI alle coveragevensters kan onderhouden, wordt de DB volledig leidend na initiële installatie.

### Middelprioriteit

- HealthPlanner metric-register: naar tabellen wanneer metrics vanuit SSO beheerd moeten worden;
- importprofielen/kolommapping: naar configureerbare DB-profielen als meerdere bronnen of layouts worden ondersteund;
- exportbestemmingen: technische secrets blijven environment variables, maar niet-geheime pad-/profielkeuzes kunnen DB-configuratie worden;
- algemene organisatie-instellingen zoals timezone/default horizon wanneer die bestuurbaar moeten zijn.

## Bewust in code houden

Deze zaken zijn geen masterdata en horen niet zonder expliciet RBAC/configuratieontwerp in SQLite:

- rollen/enums zoals `employee`, `manager`, `admin`;
- minimale rol per beveiligde pagina/API;
- rolhiërarchie en Admin-only planner/publicatiebeleid;
- state machines (`draft`, `published`, enz.);
- validatieregels en database-invarianten;
- regel dat primaire medewerkerlocatie ook inzetbaar moet zijn;
- datum-/tijdvalidatie, conflictchecks en optimistic locking;
- schema- en migratieversies;
- secrets/tokens/wachtwoorden en technische credentials.

## Purge-fase — nog NIET uitgevoerd

Bestaande werknemersrecords zijn bewust niet verwijderd. Wanneer expliciet toestemming wordt gegeven om de werknemersdata leeg te maken, moet de purge als één gecontroleerde operatie worden uitgevoerd met vooraf een databasebackup.

Te beoordelen/legen persoonsgebonden tabellen zijn dan minimaal:

- `user_employee_links`;
- `employee_location_eligibility`;
- `contract_terms`;
- `employment_periods`;
- `employees`;
- `legacy_employee_aliases`;
- `masterdata_access_seeds`;
- legacy `hour_adjustments`;
- legacy `hour_contract_periods`;
- legacy `hour_employee_settings`.

Rooster-/publicatiehistorie met employee foreign keys of naamvelden moet vóór die purge expliciet worden beoordeeld. Historische waarheid mag niet onbedoeld door cascade/delete verloren gaan.
