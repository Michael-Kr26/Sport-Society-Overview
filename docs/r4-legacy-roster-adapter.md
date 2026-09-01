# R4 — Legacy roosteradapter

## Doel

R4 vormt de gecontroleerde overgang van het bestaande Excel-/legacy-rooster naar Rooster V2.

De vaste richting blijft:

**Excel / legacy → canonical draft → validatie → bewuste publicatie**

Excel of een legacy-import mag nooit rechtstreeks een gepubliceerde V2-versie wijzigen of aanmaken.

## Bronnen

De adapter leest niet opnieuw zelf het Excel-bestand. Eerst draait de bestaande, reeds geteste importketen. Daarna leest R4 het effectieve legacy-rooster uit:

- `roster_items`;
- plus `roster_overrides` uit het wijzigingsformulier;
- vanaf de betrouwbare planningsbaseline `2026-09-01`.

Hierdoor worden operationele wijzigingen die via het goedgekeurde wijzigingsformulier zijn gedaan ook meegenomen in de overgangsweergave.

## Mapping

Legacy diensten worden gekoppeld aan:

- een canonieke `employee_id` uit R1;
- een canonieke `location_id` uit R1;
- een ISO locatie/week-period;
- lokale `Europe/Amsterdam` tijden die naar UTC worden geconverteerd;
- diensttype `floor`, omdat het oude Excel-bestand geen betrouwbaar onderscheid vloer/administratie/stage bevat;
- een stabiele `LEGACY:*` shift UID;
- `legacy_source_hash` voor herleidbaarheid naar de legacybron.

De adapter verzint geen medewerker- of locatiegegevens. Niet oplosbare regels worden als unresolved vastgelegd.

## Niet-shift items

Ziekte, vakantie, TVT en andere legacy niet-shiftitems worden niet in `roster_shifts` gepropt. R2 heeft bewust nog geen canonical verlofmodel.

R4 bewaart deze regels daarom in `roster_legacy_nonshift_items`, inclusief de oorspronkelijke payload. Daarmee blijft de broninformatie beschikbaar voor een latere afwezigheids-/verloflaag.

## Draftveiligheid

Per locatie/week gelden de volgende regels:

1. Bestaat nog geen canonical versie, dan wordt een draft uit de legacybron gemaakt.
2. Bestaat een volledig door de legacy-adapter beheerde draft, dan mag die idempotent worden gereconcilieerd.
3. Is dezelfde bron al gelijk aan de draft, dan gebeurt niets.
4. Is dezelfde bron gelijk aan de nieuwste published versie en bestaat geen draft, dan wordt geen overbodige draft gemaakt.
5. Wijkt Excel af van published, dan wordt een nieuwe draft gemaakt met `based_on_version_id` naar de published versie.
6. Published shifts/versies worden nooit aangepast.
7. Zodra een bestaande draft handmatige shifts, patternshifts of patternexceptions bevat, krijgt die status `protected_draft` en wordt hij niet door Excel overschreven.
8. Als een eerder geïmporteerde legacy-dienst uit Excel verdwijnt, wordt die verwijdering in de import-draft gereconcilieerd; historische published data blijft bestaan.

## Parityrapport

Elke import krijgt een persistente batch in `roster_legacy_import_batches` met:

- bronitemaantal;
- aantal bronshifts;
- aantal gestagede niet-shiftitems;
- aantal naar canonical gemapte shifts;
- aantal canonical shifts;
- unresolved items;
- protected drafts;
- per locatie/week de uitgevoerde actie;
- publicatieveiligheidsverklaring.

Status:

- `match`: geen unresolved items en geen protected drafts;
- `attention`: de import is technisch gelukt, maar bevat onderdelen die bewust gecontroleerd moeten worden;
- `failed`: gereserveerd voor een mislukte importbatch.

Een `attention`-rapport publiceert niets en is geen reden om brondata te verzinnen.

CLI:

```bash
npm run report:roster-parity
```

## Importketen

`npm run import:roster` voert nu na de bestaande Excel-/uren-/naamnormalisatie ook `import-roster-canonical.js` uit.

Los uitvoeren kan met:

```bash
npm run import:canonical-roster
```

## Buiten scope R4

R4:

- publiceert niet;
- vervangt de huidige rooster-UI nog niet;
- schakelt het wijzigingsformulier nog niet volledig van legacy overrides naar canonical drafts;
- implementeert geen nieuwe verlofmodule;
- maakt Excel nog niet read-only.

Die operationele omschakeling volgt via R5/R6 en uiteindelijk R10/R11.
