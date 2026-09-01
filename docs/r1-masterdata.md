# R1 — Masterdata normaliseren

## Status

- R1A: **gereed voor CI-validatie**
- R1B: wacht op de actuele medewerkersmasterdata

R1A verandert nog geen bestaande rooster-, staffing- of urenbusinesslogica. De nieuwe relationele masterdata staat naast de legacy-tabellen totdat R1B de medewerkers veilig kan koppelen.

## Vaste keuzes

### Planningsbaseline

Voor Rooster V2 geldt `2026-09-01` als de eerste periode waarvan de personeels-/roosterplanning volledig betrouwbaar moet zijn.

Oudere contract- of dienstverbandstartdata worden niet verzonnen. `employment_periods.starts_on` mag daarom `NULL` zijn. `known_from` legt vast vanaf wanneer de applicatie de betreffende personeelsstatus betrouwbaar kent.

### Locaties

| Code | Locatie |
|---|---|
| AVE | Achterveld |
| BVE | Barneveld |
| VHU | Voorthuizen |
| WEK | Wekerom |
| HAR | Harskamp |

### Historische naamaliases

- `Lucas Veenendaal` → `Lucas V`
- `Lucas Leeuwis` → `Lucas L`

Vanaf juni 2026 worden de canonieke korte namen als betrouwbaar beschouwd.

### Rechtenprincipe

- Employee: mag uiteindelijk het volledige **gepubliceerde** rooster bekijken.
- Manager: mag uiteindelijk het volledige gepubliceerde rooster bekijken, maar alleen de toegewezen vestiging beheren.
- Admin: organisatiebreed beheer.
- Guest: alleen expliciet openbaar gemaakte informatie.

R1A legt alleen de toekomstige edit-scopes vast. Het huidige V1.5-rechtenmodel blijft actief tot de rooster-V2-routes dit model daadwerkelijk gebruiken.

Bekende Manager-scopes:

- Lucas V → BVE
- Leroy → AVE
- Leon → VHU
- Dysianne → HAR
- Jamie → WEK

Bekende Admin-intenties:

- Michael
- Chico

De migratie wijzigt bestaande rollen **niet automatisch**. Een exact gevonden account met een afwijkende rol verschijnt als mismatch in `npm run report:masterdata` en moet bewust worden opgelost.

## Nieuwe tabellen

- `masterdata_meta`
- `locations`
- `employees`
- `employee_code_sequence`
- `legacy_employee_aliases`
- `employment_periods`
- `contract_terms`
- `employee_location_eligibility`
- `user_employee_links`
- `user_location_scopes`
- `masterdata_access_seeds`

`employee_code` gebruikt het stabiele formaat `EMP-0001`, `EMP-0002`, enzovoort.

## R1B

R1B vult en koppelt de daadwerkelijke medewerkers. Hiervoor is geen historische contractstartdatum vereist. Voor een bestaande medewerker kan bijvoorbeeld worden vastgelegd:

- `starts_on = NULL` wanneer de oude startdatum onbekend is;
- `known_from = 2026-09-01`;
- een contractterm vanaf `2026-09-01` met de op dat moment geldende contracturen.

Latere correcties of oudere historie kunnen daarna handmatig worden toegevoegd zonder bestaande gegevens te overschrijven.
