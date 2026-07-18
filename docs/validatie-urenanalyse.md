# Validatie urenanalyse en toegang

- `npm test` controleert alle server- en browser-JavaScriptbestanden met `node --check`, inclusief `access-bootstrap.js`, `create.js` en `employee-settings.js`.
- `access-bootstrap.js` migreert bestaande accounts met de optionele kolom `location` en levert de centrale profiel- en toegangs-API's.
- De rolhiërarchie wordt identiek gebruikt voor navigatie, client-side paginabescherming en server-side afscherming van beschermde HTML-pagina's.
- Managers moeten aan een vestiging gekoppeld zijn om bezettingsstandaarden te openen; zij ontvangen alleen de standaarden van die locatie.
- Admins kunnen accounts, rollen, vestigingen, actieve status en optioneel wachtwoorden beheren.
- Manager en Admin kunnen de urenanalyse bekijken; alleen Admin kan medewerkers, contracten en correcties wijzigen.
- Een toekomstige medewerker telt pas vanaf de ingestelde startmaand mee.
- `responsive.css` wordt centraal op alle pagina's geladen en bevat de mobiele formulier-, kaart-, navigatie- en tabelweergave.
- De eerste versie rekent met ingeplande roosteruren. Afwezigheids- en verlofuren moeten als urencorrectie worden toegevoegd totdat werkelijk gewerkte of verloonde uren beschikbaar zijn.
- De beginstand van de urenbank is voorlopig 0 per januari 2026 en moet worden aangepast wanneer bestaande banksaldi beschikbaar zijn.

Een volledige runtime- en visuele test moet lokaal worden uitgevoerd met `npm install`, `npm test` en `npm start`, omdat de Node-dependencies en een browserruntime niet in de beschikbare uitvoeromgeving aanwezig zijn.
