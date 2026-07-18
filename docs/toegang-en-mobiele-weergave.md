# Toegang en mobiele weergave

## Rolhiërarchie

Een genoemde minimumrol omvat automatisch alle hogere rollen:

`Guest < Employee < Manager < Admin`

## Paginatoegang

| Pagina | Minimumrol | Bijzonderheden |
|---|---|---|
| Home | Guest | Voor iedereen zichtbaar |
| Rooster | Guest | Voor iedereen zichtbaar |
| Inloggen / account | Guest | Gasten zien inloggen; ingelogde gebruikers zien hun profiel |
| Bezettingsanalyse | Manager | Manager ziet standaard de eigen profielvestiging; Admin kan alle locaties analyseren |
| Bezettingsstandaarden | Manager | Manager ziet en beheert alleen de eigen profielvestiging; Admin beheert alle locaties en algemene regels |
| Roosterwijzigingen | Manager | Manager kan bekijken; bestaande adminacties blijven Admin-only |
| Urenanalyse & urenbank | Manager | Manager kan bekijken; Admin kan correcties en beheer uitvoeren |
| Medewerkerinstellingen | Admin | Alleen Admin |
| Wijziging registreren | Admin | Alleen Admin |
| Preview & integratiestatus | Admin | Alleen Admin |
| Accounts | Admin | Alleen Admin, behalve eenmalige bootstrap van het eerste adminaccount |

Dezelfde matrix wordt gebruikt voor navigatiezichtbaarheid, client-side redirects en server-side afscherming van beschermde HTML-pagina's.

## Profielvestiging

Accounts hebben een optionele vestiging. Voor een Manager is de vestiging verplicht. Deze koppeling bepaalt welke locatie op `staffing.html` en `staffing-standards.html` beschikbaar is. Een Admin kan via `create.html` rollen, vestigingen, actieve status en optioneel het wachtwoord beheren.

Een Manager mag binnen de eigen vestiging de lesregel, het minimum tijdens lessen, uitgesloten maanden en uitzonderingsvensters voor enkele bezetting aanpassen. Algemene avond- en drukteregels blijven Admin-only.

## Vaste standaarddiensten

De bezettingsanalyse genereert vanaf vandaag standaard 42 kalenderdagen. Daardoor worden lege standaarddiensten ook zichtbaar wanneer het geïmporteerde rooster voor die datum geen enkele dienst bevat.

### Barneveld, Voorthuizen en Wekerom

- maandag tot en met donderdag: `07:00–12:00` en `16:00–21:30`;
- vrijdag: `07:00–12:00`;
- zaterdag: `08:30–12:00`.

### Achterveld

- maandag tot en met donderdag: `07:00–12:00` en `16:00–21:30`;
- vrijdag: `07:00–12:00`;
- zaterdag en zondag: `08:30–12:00`.

### Harskamp

- maandag tot en met donderdag: `08:30–12:00` en `16:00–21:00`;
- vrijdag en zaterdag: `08:30–12:00`.

Binnen een vaste standaarddienst geldt:

- nul medewerkers: geen bezetting / onderbezet;
- één medewerker: enkele bezetting / kwetsbaar;
- twee of meer medewerkers: voldoende, tenzij een strengere les- of avondnorm geldt;
- binnen een ingesteld uitzonderingsvenster geldt één medewerker als voldoende, behalve wanneer een harde avondnorm actief is.

## Navigatie

De navigatie is ingedeeld in inklapbare groepen:

- Algemeen
- Operationeel
- Management
- Admin
- Account

De open/dicht-status wordt per groep lokaal bewaard. De groep van de huidige pagina wordt altijd geopend.

## Mobiele weergave

`responsive.css` wordt centraal via `auth-ui.js` op alle pagina's geladen. De mobiele laag verzorgt onder andere:

- een mobiele navigatielade;
- minimaal 46 pixels hoge touch-doelen;
- formulieren in één kolom;
- compacte kaarten en samenvattingen;
- horizontaal bruikbare uren-tabellen met een vaste eerste kolom;
- een cardweergave voor het roosterwijzigingenoverzicht;
- scrollbare locatietabs;
- gestapelde dashboards, acties en contractformulieren;
- invoervelden van 16 pixels om ongewenst inzoomen op mobiele browsers te voorkomen.
