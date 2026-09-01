# R2 — Nieuwe rooster-datalaag

## Status

**R2 afgerond — CI groen.**

R2 bouwt de relationele roosterfundering bovenop R1. De bestaande V1.5-roosterbusinesslogica blijft voorlopig actief; R2 introduceert nog geen nieuwe planner of publicatieservice.

## Vaste functionele keuzes

### Diensttypes

Rooster V2 kent uitsluitend:

- `floor` — vloer;
- `administration` — administratie;
- `internship` — stage.

Een dienst heeft één type. Er is geen aparte pauzelogica in R2; gewerkte duur is de concrete dienstduur.

### Open diensten

Een shift mag `employee_id = NULL` hebben. Een vrije notitie kan context of voorkeur bevatten. Er komt in R2 nog geen skill-engine.

### Patterns

- patterns zijn generatoren, geen historische waarheid;
- `repeat_interval_weeks` ondersteunt ieder positief aantal weken;
- patterns hebben een verplichte ingangsdatum en optionele einddatum;
- structurele wijzigingen worden effective-dated en houden historie intact;
- contractmedewerkers zullen relatief stabiele patterns hebben; flexpatterns mogen vaker wijzigen;
- `revision` + `source_pattern_revision` maken zichtbaar welke gegenereerde shifts achterlopen;
- patternwijzigingen worden via `roster_pattern_sync_queue` voorbereid voor automatische verwerking in R3.

### Automatische patternpropagatie

Doel is zo weinig mogelijk handwerk:

- toekomstige concepten/onuitgegeven weken worden automatisch bijgewerkt;
- een patternwijziging die al gepubliceerde toekomstige weken raakt, mag bij een Admin-wijziging als één samengestelde actie nieuwe versies maken en opnieuw publiceren;
- eerdere gepubliceerde versies blijven immutable en dus volledig historisch controleerbaar.

Dit combineert “direct toepassen” met de vaste architectuurregel dat gepubliceerde shifts nooit achteraf worden overschreven.

### Beschikbaarheid

Beschikbaarheid wordt in vaste categorieën opgeslagen, niet als vrije tijden. De categorieën zijn:

- Ochtend 07:00–12:00;
- Ochtend 08:30–12:00;
- Middag 16:00–21:30;
- Avond 18:30–21:30;
- Weekend 08:30–12:00.

Geen beschikbaarheidsrecord betekent **onbekend**, niet beschikbaar of beschikbaar wordt dus nooit afgeleid.

Structurele beschikbaarheid staat in `employee_availability_patterns`. Incidentele, met de werknemer afgestemde afwijkingen staan in `employee_availability_exceptions`. Een exception kan zowel extra beschikbaarheid als tijdelijke onbeschikbaarheid zijn.

Vakantie, ziekte en andere verlofvormen blijven aparte bedrijfsgebeurtenissen en worden niet als beschikbaarheid gemodelleerd.

Beschikbaarheid is een structurele planningsrichtlijn, geen absoluut juridisch/technisch verbod. Een medewerker kan na overleg incidenteel buiten het normale patroon werken. Daarom wordt een beschikbaarheidsconflict in R3 een waarschuwing in plaats van een harde blokkade.

### Vestigingsinzetbaarheid

Ook `employee_location_eligibility` wordt een waarschuwing en geen hard block. Een medewerker kan na expliciet overleg incidenteel op een andere vestiging worden ingezet. Structurele inzetbaarheid blijft wel in R1-masterdata staan.

### Horizon

- harde bedrijfsregel: rooster minimaal **6 weken vooruit gepubliceerd**;
- normale streefgrens: **12 weken**;
- technische/generatiehorizon: **24 weken**.

Genereren gebeurt on demand. Het systeem hoeft dus niet continu rolling alle 24 weken te materialiseren.

### Perioden en versies

Roosterperiode = `locatie + ISO-week`, maandag t/m zondag.

Per periode:

- maximaal één actieve `draft`;
- meerdere historische `published` versies mogelijk;
- oude concepts kunnen `abandoned` worden;
- published versies en hun shifts zijn database-technisch immutable;
- optimistic locking gebruikt `roster_versions.revision`.

### Publiceren

Alleen **Admin** mag publiceren.

Een publicatie kan in één handeling meerdere locaties én meerdere weken bevatten via `roster_publication_versions`.

Open diensten en staffingtekorten blokkeren publicatie niet; ze worden later als waarschuwingen behandeld.

### Uren

Contracturen zijn geen harde roosterlimiet. Over- en minuren worden later richting urenbank verwerkt. R3/R8 mogen contractafwijkingen daarom niet blokkeren.

### Conflicten

- dubbele/overlappende diensten van dezelfde medewerker: hard conflict in R3;
- buiten structurele beschikbaarheid: waarschuwing;
- buiten standaard inzetbare locatie: waarschuwing;
- over-/minuren contract: geen block, richting urenbank;
- onderbezetting: waarschuwing.

### CML

`roster_publication_changes` en `audit_events.cml_visible` vormen de data-hook voor directe zichtbaarheid van roosterwijzigingen in CML. Bij wijzigingen ten opzichte van een reeds gepubliceerd rooster is een reden verplicht in de R3/R6-service-laag. De bestaande CML-UI wordt in R2 nog niet aangepast.

## Nieuwe tabellen

- `roster_settings`
- `availability_slots`
- `employee_availability_patterns`
- `employee_availability_exceptions`
- `roster_patterns`
- `roster_periods`
- `roster_versions`
- `roster_shifts`
- `roster_publications`
- `roster_publication_versions`
- `roster_publication_changes`
- `audit_events`
- `roster_pattern_sync_queue`

## R2 acceptatie

R2 is gereed wanneer:

- [x] schema en instellingen idempotent kunnen worden aangemaakt;
- [x] beschikbaarheidscategorieën zijn geseed zonder daadwerkelijke medewerkerbeschikbaarheid te verzinnen;
- [x] maximaal één actieve draft per locatie-week database-technisch wordt afgedwongen;
- [x] published versions/shifts immutable zijn;
- [x] optimistic locking testbaar is;
- [x] patterns onbeperkte weekintervallen en revisions ondersteunen;
- [x] automatische patternpropagatie een persistente queue heeft;
- [x] batch-publicaties meerdere locaties en weken kunnen koppelen;
- [x] CML-zichtbaarheid een expliciete data-hook heeft;
- [x] GitHub Actions groen op de R2-implementatie.
