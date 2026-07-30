# HealthPlanner-importprofiel V1.5

## Bron die is vastgesteld

Het aangeleverde dagelijkse managementrapport bevat per vestiging twee kolommen:

- `Gisteren`: dagwaarde van de dag vóór de rapportdatum;
- `Maand`: maand-tot-datumwaarde op de rapportdatum.

De vestigingen in het rapport zijn Voorthuizen, Achterveld, Barneveld, Wekerom en Harskamp. Het rapport bevat geaggregeerde KPI's en geen individueel leden- of zorgdossier.

## Waarom de PDF niet rechtstreeks de productiebron is

De doorgestuurde PDF is geschikt om het gegevenscontract en de metriekmapping vast te leggen, maar tabellen en duurwaarden worden bij PDF-extractie niet altijd stabiel in kolommen uitgelezen. De eerste betrouwbare productie-import gebruikt daarom een genormaliseerd CSV- of XLSX-bestand.

Een toekomstige e-mail- of API-koppeling mag dezelfde canonieke importer voeden, maar mag de validatieregels niet omzeilen.

## Bestandsstructuur

Verplichte kolommen:

| Kolom | Betekenis |
|---|---|
| `rapportdatum` | Datum bovenaan het HealthPlanner-rapport |
| `vestiging` | Eén geldige Sport Society-vestiging |
| `periodevenster` | `Gisteren` of `Maand` |
| `metric` | Canonieke sleutel of exact bronlabel uit het metriekregister |
| `waarde` | Expliciete bronwaarde, inclusief geldige nul |
| `opmerking` | Optioneel |

## Periodebetekenis

- `Gisteren` wordt opgeslagen als `day`, met `periodDate = rapportdatum - 1 dag`.
- `Maand` wordt opgeslagen als `month_to_date`, met de rapportdatum als peildatum.
- Een maand-tot-datumwaarde is geen afgesloten maandtotaal en mag niet bij een eerdere maand-tot-datumwaarde worden opgeteld.

## Waardetypen

- aantallen: gehele getallen;
- ledengroei: mag negatief zijn;
- percentages: `37,5`, `37.5` of `37,5%`;
- ratio's zoals bezoekersfrequentie: decimaal getal;
- duur: seconden, `UU:MM:SS` of tekst met dagen/uren/minuten/seconden.

Een expliciete nul wordt als waarde `0` opgeslagen. Een lege of ongeldige waarde veroorzaakt een importfout en wordt niet stilzwijgend naar nul omgezet.

## Preview en opslag

Preview zonder databasewijziging:

```powershell
npm run preview:healthplanner -- ".\data\imports\HealthPlanner.csv" "Michael"
```

Definitief opslaan na een foutloze preview:

```powershell
npm run import:healthplanner -- ".\data\imports\HealthPlanner.csv" "Michael"
```

De importer weigert hetzelfde bronbestand tweemaal. Wanneer dezelfde metriek voor dezelfde periode, vestiging en peildatum later een andere waarde krijgt, wordt de oude waarde eerst in `healthplanner_metric_revisions` vastgelegd.

## Dashboardregels

- Manager: uitsluitend de aan het account gekoppelde vestiging.
- Admin: alle vestigingen en importhistorie.
- Totaalregels worden nooit automatisch opgeteld bij vestigingsregels.
- Percentages, ratio's en momentopnamen worden niet als gewone aantallen geaggregeerd.
- Salaris, payroll, medische diagnoses en individuele zorggegevens blijven uitgesloten.
