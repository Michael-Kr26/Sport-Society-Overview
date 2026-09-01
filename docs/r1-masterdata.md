# R1 — Masterdata normaliseren

## Status

- R1A: **afgerond — CI groen**
- R1B: **afgerond — CI groen**

De nieuwe relationele masterdata staat naast de legacy-tabellen. Bestaande rooster-, staffing- en urenbusinesslogica blijft voorlopig ongewijzigd.

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

De migratie wijzigt bestaande rollen **niet automatisch**. Exact herkenbare accounts worden wel aan het juiste employee-record gekoppeld. Een afwijkende bestaande rol verschijnt in `npm run report:masterdata` en moet bewust worden opgelost.

Bekende Manager-scopes:

- Lucas V → BVE
- Leroy → AVE
- Leon → VHU
- Dysianne → HAR
- Jamie → WEK

Bekende Admin-intenties:

- Michael
- Chico

## Nieuwe tabellen uit R1A

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

## Fresh-install gedrag

De masterdatamigratie verzekert idempotent ook de bestaande `users`-basistabel wanneer een volledig lege database wordt gebruikt. Daardoor kunnen de nieuwe relationele foreign keys vanaf de eerste installatie intact blijven. De bestaande authlaag blijft eigenaar van accountgedrag en sessies.

## R1B — medewerkersbaseline 2026-09-01

R1B vult de actuele medewerkerssituatie zonder fictieve historische startdata. Voor iedere medewerker wordt vastgelegd:

- canonieke naam;
- stabiele employee-code;
- contract/flex;
- huidige contractomvang vanaf de betrouwbare baseline;
- primaire vestiging;
- vestigingen waarop de medewerker inzetbaar is;
- gewenste SSO-rol voor accountcontrole;
- optionele user↔employee-koppeling wanneer een bestaand account exact herkend wordt.

| Medewerker | Type | Uur/wk | Primair | Inzetbaar | SSO-rol |
|---|---|---:|---|---|---|
| Lucas V | contract | 36 | BVE | BVE | manager |
| Olav | flex | 0 | BVE | BVE, WEK, VHU | employee |
| Daniel | flex | 0 | BVE | BVE | employee |
| Vigo | flex | 0 | BVE | BVE, VHU | employee |
| Denise | contract | 18 | BVE | BVE, WEK, VHU | employee |
| Sep | flex | 0 | BVE | BVE | employee |
| Ali | flex | 0 | BVE | BVE | employee |
| Leroy | contract | 35,5 | AVE | AVE | manager |
| Michael | contract | 34 | AVE | AVE, HAR | admin |
| Nicole | contract | 28 | AVE | AVE, BVE, VHU | employee |
| Melle | flex | 0 | AVE | AVE | employee |
| Jamie | contract | 32 | WEK | WEK | manager |
| Rick | flex | 0 | WEK | WEK, HAR, BVE | employee |
| Lucas L | flex | 0 | WEK | WEK | employee |
| Dysianne | contract | 34 | HAR | HAR | manager |
| Anne-Marthe | flex | 0 | HAR | HAR | employee |
| Gijs | contract | 22 | HAR | HAR | employee |
| Leon | contract | 38 | VHU | VHU | manager |
| Koen | contract | 21 | VHU | VHU, HAR | employee |
| Tristan | contract | 8 | VHU | VHU, BVE | employee |
| Jeffrey | flex | 0 | VHU | VHU | employee |
| Noel | flex | 0 | VHU | VHU | employee |

Dit zijn 22 medewerkers en 34 medewerker↔vestiging-eligibilities.

### Niet-destructieve baseline

De migratie is idempotent en behandelt `2026-09-01` als bronbaseline, niet als eeuwig afdwingbare waarde. Wanneer een bestaande baseline later handmatig is gecorrigeerd, wordt die correctie niet bij iedere startup terug overschreven. Het rapport toont dan een baseline-afwijking ter controle.

### Beschikbaarheid

Beschikbaarheid is **geen onderdeel van R1B**. Er worden geen werkdagen, dagdelen of tijdvakken gegokt of afgeleid uit contracturen, vestiging of huidig rooster.

De structurele en incidentele beschikbaarheid wordt in R2 als apart datamodel toegevoegd en kan daarna worden gevuld zodra de volledige terugkoppeling van medewerkers beschikbaar is.

**R1 is hiermee technisch afgerond.**
