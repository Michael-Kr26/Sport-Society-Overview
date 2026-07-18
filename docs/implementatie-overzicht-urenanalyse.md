# Implementatie-overzicht

De branch `agent/urenanalyse-urenbank` bevat vier samenhangende onderdelen:

1. urenanalyse en cumulatieve urenbank;
2. roosterwijzigingen als persistente rooster-overrides;
3. bezettingsanalyse en locatiegebonden standaarden;
4. centrale roltoegang, profielvestigingen, accountbeheer en mobiele weergave.

De opstartketen loopt via `access-bootstrap.js`, vervolgens `roster-sync-bootstrap.js`, `hours-bootstrap.js`, `staffing-bootstrap.js` en uiteindelijk `app.js`. De buitenste bootstrap voegt profielmigratie, centrale toegangs-API's en server-side paginabescherming toe zonder bestaande data te resetten.

De urenmodule bevat daarnaast automatische medewerkerdetectie, contractperiodes, toekomstige startdatums en handmatige correcties op meegetelde uren en urenbanksaldi.

Zie `docs/urenanalyse.md` voor de urenberekening en `docs/toegang-en-mobiele-weergave.md` voor de definitieve toegangsrechten en responsive uitgangspunten.
