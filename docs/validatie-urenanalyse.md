# Validatie urenanalyse

- `npm test` controleert alle server- en browser-JavaScriptbestanden met `node --check`.
- `hours.js` bevat nu de volledige urenfrontend; het losse reparatiebestand is verwijderd.
- `migrate-hours.js` voegt bij oudere databases de startdatumkolom toe en behoudt bestaande instellingen.
- Manager en admin kunnen de analyse bekijken; alleen admin kan medewerkers, contracten en correcties wijzigen.
- Een toekomstige medewerker telt pas vanaf de ingestelde startmaand mee.
- De eerste versie rekent met ingeplande roosteruren. Afwezigheids- en verlofuren moeten als urencorrectie worden toegevoegd totdat werkelijk gewerkte of verloonde uren beschikbaar zijn.
- De beginstand van de urenbank is voorlopig 0 per januari 2026 en moet worden aangepast wanneer bestaande banksaldi beschikbaar zijn.

Een volledige runtime-test moet lokaal worden uitgevoerd met `npm install`, `npm test` en `npm start`, omdat de Node-dependencies niet in de beschikbare uitvoeromgeving aanwezig zijn.
