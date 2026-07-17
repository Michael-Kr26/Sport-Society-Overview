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
| Bezettingsanalyse | Manager | Manager en Admin |
| Bezettingsstandaarden | Manager | Manager ziet alleen de eigen profielvestiging en kan alleen lezen; Admin ziet en beheert alle locaties |
| Roosterwijzigingen | Manager | Manager kan bekijken; bestaande adminacties blijven Admin-only |
| Urenanalyse & urenbank | Manager | Manager kan bekijken; Admin kan correcties en beheer uitvoeren |
| Medewerkerinstellingen | Admin | Alleen Admin |
| Wijziging registreren | Admin | Alleen Admin |
| Preview & integratiestatus | Admin | Alleen Admin |
| Accounts | Admin | Alleen Admin, behalve eenmalige bootstrap van het eerste adminaccount |

Dezelfde matrix wordt gebruikt voor navigatiezichtbaarheid, client-side redirects en server-side afscherming van beschermde HTML-pagina's.

## Profielvestiging

Accounts hebben een optionele vestiging. Voor een Manager is de vestiging verplicht. Deze koppeling bepaalt welke locatie op `staffing-standards.html` beschikbaar is. Een Admin kan via `create.html` rollen, vestigingen, actieve status en optioneel het wachtwoord beheren.

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
