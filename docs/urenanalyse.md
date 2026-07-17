# Urenanalyse en urenbank

## Bronnen

De roosterimport verwerkt iedere dienst samen met de bijbehorende Excel-kolom `Uren`. Wanneer een geldige Uren-waarde aanwezig is, wordt die waarde gebruikt voor de urenanalyse. Alleen wanneer deze waarde ontbreekt, blijft `eindtijd − begintijd` de terugvalberekening.

De locatie wordt gekoppeld via de locatiekleur van de dienstcel. Wanneer de kleur op de naastliggende Uren-cel staat, wordt die kleur eveneens gebruikt. Daardoor blijven de gedeclareerde uren en de bijbehorende vestiging onderdeel van dezelfde roosterregel.

Na een roosterimport voert `import-roster-linked.js` automatisch eerst `import-roster.js` en daarna `link-roster-hours.js` uit. De linker voegt de kolom `declared_hours` veilig toe aan bestaande databases en toont na afloop apart een controleoverzicht voor Lucas V.

## Contractmedewerkers

De maandnorm is:

`contracturen per week × 4,33`

De maandmutatie is:

`gekoppelde Excel-uren + urencorrecties − maandnorm + directe bankcorrecties`

De cumulatieve urenbank begint bij de ingestelde startstand en telt iedere maandmutatie vanaf de gekozen startmaand op.

## Flexmedewerkers

Flexmedewerkers krijgen geen maandnorm of urenbank. Zij worden vergeleken op ingeplande en meegetelde uren, het verschil met de vorige maand en het verschil met het flexgemiddelde.

## Filters en medewerkersbeheer

De urenpagina kan worden gefilterd op alle medewerkers, vaste uren of flexcontract. De filter werkt door in de samenvatting, tabellen en urencorrecties.

Medewerkerinstellingen staan op de afzonderlijke adminpagina `employee-settings.html`. Daar kan een admin:

- een medewerker vooraf toevoegen met een toekomstige startmaand;
- de startstand en startmaand van de urenbank beheren;
- een medewerker veilig deactiveren of herstellen;
- meerdere contractperiodes vastleggen;
- per contractperiode uren per week, contractstart en optionele contractstop instellen.

Contractperiodes mogen elkaar niet overlappen. Na de stopdatum wordt de medewerker in maanden zonder andere contractperiode als flexmedewerker behandeld. Historische periodes, uren en correcties blijven bewaard.

## Ingevoerde contracturen

| Medewerker | Uren per week | Geldigheid |
|---|---:|---|
| Leroy | 36 | Vanaf januari 2026 |
| Leon | 38 | Vanaf januari 2026 |
| Mario | 32 | Vanaf januari 2026 |
| Koen | 21 | Vanaf januari 2026 |
| Lucas V | 36 | Vanaf januari 2026 |
| Dysianne | 34 | Vanaf januari 2026 |
| Michael | 28 | Vanaf januari 2026 |
| Tristan | 15 | Tot en met 31 mei 2026 |
| Tristan | 8 | Vanaf 1 juni 2026 |
| Denise | 22 | Vanaf januari 2026 |

De beginstand van de urenbank staat voorlopig op `0` per januari 2026. Een admin kan bestaande beginstanden en handmatige correcties via de beheerpagina toevoegen.
