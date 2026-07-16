# Validatie urenanalyse

- `hours-bootstrap.js`, `hours.js` en `auth-ui.js` zijn syntactisch gecontroleerd met `node --check`.
- De urenmodule start via `hours-bootstrap.js`, die eerst de bestaande bezettingsbootstrap en applicatie laadt.
- Manager en admin kunnen de analyse bekijken; alleen admin kan instellingen en correcties wijzigen.
- De eerste versie rekent met ingeplande roosteruren. Afwezigheids- en verlofuren moeten als urencorrectie worden toegevoegd totdat een bron met werkelijk gewerkte of verloonde uren beschikbaar is.
- De beginstand van de urenbank is voorlopig 0 per januari 2026 en moet worden aangepast wanneer bestaande banksaldi beschikbaar zijn.
