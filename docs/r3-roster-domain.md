# R3 — Roosterdomainservices

## Status

**R3 afgerond — implementatie en testset groen in GitHub Actions. Rechtenbeleid later aangescherpt in R7.**

R3 maakt van de relationele roosterfundering uit R2 een werkende domeinlaag. R3 introduceert nog geen nieuwe weekplanner en schakelt de bestaande Excel-/overrideworkflow nog niet om naar de nieuwe bron van waarheid. Die overgang wordt bewust later uitgevoerd zodat er tijdens de migratie geen twee concurrerende roosterbronnen ontstaan.

## Vaste architectuur

De hoofdregel blijft:

> patterns zijn generatoren; concrete gepubliceerde shifts zijn de officiële waarheid.

Patterns mogen toekomstige concepten automatisch bijwerken. Een bestaande gepubliceerde versie wordt nooit achteraf overschreven. Wanneer een structurele wijziging een reeds gepubliceerde toekomstige week raakt, maakt R3 een nieuwe draft klaar; R6 kan die vervolgens als samengestelde Admin-actie opnieuw publiceren.

## Domainservices

### AuthorizationService

- Employee, Manager en Admin mogen het volledige gepubliceerde organisatierooster lezen;
- R3 introduceerde technisch vestigingsgebonden Manager-scopes;
- **R7 heeft het operationele rechtenbeleid daarna aangescherpt: Managers mogen niet plannen en geen drafts wijzigen; de Planner is uitsluitend Admin**;
- Admin mag organisatiebreed wijzigen;
- alleen Admin mag publiceren;
- `user_employee_links` kan een ingelogde gebruiker aan het employee-record koppelen.

De R3-domainprimitieven blijven onderdeel van de interne service-laag. De actuele server-/Planner-policy uit R7 is leidend voor producttoegang en neutraliseert Manager-roosterflags naar `0`.

### DraftService

- roosterperioden zijn `locatie + ISO-week`;
- een nieuwe week wordt on demand aangemaakt;
- als al een draft bestaat, wordt die hergebruikt;
- de eerste wijziging na publicatie kloont de nieuwste published versie naar een nieuwe draft;
- `shift_uid` blijft bij het klonen stabiel;
- pattern-exceptions worden meegekopieerd;
- shift add/update/remove gebruikt optimistic locking op `roster_versions.revision`;
- een verouderde editor krijgt `ROSTER_VERSION_CONFLICT` en kan een nieuwere wijziging niet stil overschrijven.

Sinds R7 worden deze mutaties vanuit de operationele Planner uitsluitend met een Admin-account uitgevoerd.

### PatternService

- genereert concrete shifts uit effective-dated patterns;
- ondersteunt ieder positief `repeat_interval_weeks`;
- gebruikt lokale tijd in `Europe/Amsterdam` en materialiseert shifts naar UTC;
- pattern-shifts krijgen een stabiele UID op basis van pattern + datum;
- structurele wijzigingen sluiten het oude pattern af en starten een opvolgend pattern;
- bestaande toekomstige drafts worden direct gesynchroniseerd;
- een reeds gepubliceerde toekomstige week krijgt een nieuwe draft en wordt als `requiresRepublish` teruggegeven;
- nog niet gematerialiseerde toekomstige weken gebruiken automatisch het nieuwste geldige pattern zodra die week wordt geopend.

### Handmatige weekuitzonderingen

R3 voegt `roster_pattern_exceptions` toe.

Deze tabel voorkomt dat een bewuste incidentele wijziging later door automatische pattern-sync wordt teruggedraaid:

- `override` — gegenereerde dienst is in deze week bewust aangepast;
- `suppress` — gegenereerde dienst is in deze week bewust verwijderd.

Structurele patternwijzigingen blijven daardoor automatisch doorwerken, terwijl incidentele uitzonderingen per week intact blijven.

### ValidationService

Blokkerende fouten:

- overlappende diensten van dezelfde medewerker, ook over verschillende vestigingen;
- medewerker heeft op de dienstdatum geen geldig dienstverband in de masterdata.

Waarschuwingen:

- open dienst;
- dienst buiten structurele vestigingsinzetbaarheid;
- medewerker staat structureel als niet beschikbaar voor het betreffende beschikbaarheidsblok;
- beschikbaarheid is nog onbekend.

Een beschikbaarheidsexception wint van het structurele availability-pattern.

Contracturen zijn geen validatieblokkade. De verwachte over-/minuren worden als urenbankinformatie teruggegeven.

Staffing is in R3 bewust nog geen volledig domeinresultaat: `staffing: null`. Coverage rules en de definitieve staffing-engine horen bij R8 en worden hier niet verzonnen.

### HoursService

- rekent geplande minuten organisatiebreed over alle vestigingen;
- vergelijkt met de effective-dated contractterm;
- geeft `hourBankDeltaMinutes` terug;
- open diensten tellen niet mee als medewerkeruren;
- ondersteunt ook gepubliceerde uren per medewerker over een datumbereik.

### QueryService

Geeft één canonieke leeslaag voor:

- actuele draft per locatie/week;
- nieuwste gepubliceerde versie per locatie/week;
- volledig gepubliceerde rooster over een periode;
- rooster van één medewerker;
- open diensten.

Historische published versies blijven beschikbaar, maar normale queries selecteren alleen de nieuwste gepubliceerde versie van een periode zodat diensten niet dubbel worden weergegeven.

### PublicationService

R3 bevat de domeinkern voor publiceren:

- alleen Admin;
- één atomaire batch kan meerdere locatie-weken bevatten;
- alle drafts worden eerst gevalideerd;
- warnings blokkeren niet, errors wel;
- diff op stabiele `shift_uid`: `added`, `modified`, `removed`;
- `roster_publication_changes` wordt gevuld;
- audit-events delen een correlation id;
- een wijziging van een eerder gepubliceerde week vereist een reden;
- gepubliceerde historie blijft immutable door de R2-databasetriggers.

R6 blijft nodig voor de volledige publicatie-orkestratie: API/UI, horizonbewaking, changed-since-last-publication, CML-projectie/notificaties en de éénklik-flow voor urgente/structurele republish-acties.

## Change-form en CML

De door de gebruiker goedgekeurde nieuwe frontend van het wijzigingsformulier blijft behouden.

De gewenste eindflow is:

`wijzigingsformulier → R3 draft/mutatie → validatie → publicatie → CML/audit`

Op dit moment schrijft het formulier tijdens de transitie nog naar de bestaande effectieve legacy override-laag en de bestaande `changes`-tabel. R3 levert nu de canonical domeindoelstructuur. De daadwerkelijke omschakeling wordt bewust pas gedaan wanneer de legacy importadapter en de nieuwe planner/publicatieflow daarop zijn aangesloten. Zo voorkomen we dat Excel/legacy-overrides en Rooster V2 tegelijk als officiële waarheid optreden.

## R3 acceptatie

- [x] R3-migratie is idempotent;
- [x] lokale `Europe/Amsterdam`-tijd wordt correct naar UTC gematerialiseerd;
- [x] AuthorizationService ondersteunt organisatiebreed published lezen en Admin-publicatie;
- [x] R7 bepaalt aanvullend dat operationele draftmutaties uitsluitend Admin zijn;
- [x] on-demand drafts worden aangemaakt of uit published gekloond;
- [x] optimistic locking voorkomt silent overwrites;
- [x] patterns genereren stabiele concrete shifts;
- [x] structurele patternwijzigingen propagateren naar bestaande toekomstige drafts;
- [x] gepubliceerde toekomstige weken worden bij patternwijziging als nieuwe draft klaargezet;
- [x] handmatige weekuitzonderingen overleven pattern-sync;
- [x] overlap is een hard conflict;
- [x] beschikbaarheid en vestigingsinzetbaarheid zijn waarschuwingen;
- [x] beschikbaarheidsexceptions winnen van structurele beschikbaarheid;
- [x] contractafwijkingen worden urenbankprojectie en blokkeren niet;
- [x] QueryService gebruikt alleen de nieuwste published versie als actueel rooster;
- [x] PublicationService ondersteunt atomaire batchpublicatie en diff;
- [x] wijziging na publicatie vereist reden;
- [x] gepubliceerde historie blijft immutable;
- [x] R3-domeintests zijn opgenomen in `npm test`;
- [x] GitHub Actions is groen op de R3-implementatie.
