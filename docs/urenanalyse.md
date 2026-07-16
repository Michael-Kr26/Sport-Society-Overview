# Urenanalyse en urenbank

## Bronnen

De eerste versie gebruikt de diensten uit `roster_items`. Een dienst telt mee wanneer het itemtype `shift` is en een geldige begin- en eindtijd heeft. De berekening gebruikt daardoor momenteel ingeplande uren. Een latere klok- of salariskoppeling kan dezelfde API vullen met werkelijk gewerkte uren.

## Contractmedewerkers

De maandnorm is:

`contracturen per week × 4,33`

De maandmutatie is:

`roosteruren + urencorrecties − maandnorm + directe bankcorrecties`

De cumulatieve urenbank begint bij de ingestelde startstand en telt iedere maandmutatie vanaf de gekozen startmaand op.

## Flexmedewerkers

Flexmedewerkers krijgen geen maandnorm of urenbank. Zij worden vergeleken op:

- ingeplande uren;
- meegetelde uren na correcties;
- verschil met de vorige maand;
- verschil met het gemiddelde van de flexgroep.

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
