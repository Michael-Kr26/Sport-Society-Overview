# Urenanalyse en Excel-maandstanden

## Primaire bron

Voor medewerkers met vaste uren gebruikt de urenanalyse voortaan de vier samenvattingsvelden onderaan iedere Excel-maandpagina als bron van waarheid:

- `Minstens`;
- `Overuren deze maand`;
- `Overuren vorige maand`;
- `Overuren na deze maand`.

De weergegeven waarden zijn:

| Applicatie | Excelbron |
|---|---|
| Maandnorm | Exact `Minstens` |
| Ingepland | `Minstens + Overuren deze maand` |
| Overuren deze maand | Exact `Overuren deze maand` |
| Vorige stand | Exact `Overuren vorige maand` |
| Urenbank | Exact `Overuren na deze maand` |

De contracturen per week blijven als administratieve contractinformatie zichtbaar, maar worden niet meer gebruikt om de Excel-maandnorm opnieuw te berekenen.

## Periode en weekaantal

Een maand in de applicatie verwijst naar de volledige gelijknamige Excelpagina. Alle datums die op die pagina staan tellen mee, ook wanneer de eerste of laatste dagen formeel in een aangrenzende kalendermaand vallen.

Het aantal weken wordt bepaald met de geldige datumregels in kolom A:

`weekaantal = aantal datumregels / 7`

Daarmee geldt bijvoorbeeld:

- 28 datumregels = 4 weken;
- 35 datumregels = 5 weken.

Een datumregel is geldig wanneer kolom A een datum bevat en kolom B een Nederlandse weekdag bevat. Een niet-volledig veelvoud van zeven wordt als structuurprobleem aan admins gemeld.

## Importketen

`npm run import:roster` voert achtereenvolgens uit:

1. `import-roster.js` voor diensten, afwezigheden en locaties;
2. `normalize-roster-headers.js` om numerieke tussenkoppen niet als medewerkersnaam te behandelen;
3. `link-roster-hours.js` voor de koppeling van diensten, Uren-cellen en locatiekleuren;
4. `import-hour-summaries.js` voor de vier maandvelden en het weekaantal;
5. `migrate-employee-names.js` voor de samenvoeging van `Lucas V` naar `Lucas Veenendaal`.

De tabellen `excel_hour_periods` en `excel_hour_summaries` worden bij iedere import opnieuw opgebouwd. Handmatige admincorrecties staan afzonderlijk in `excel_hour_overrides` en blijven daardoor behouden bij een nieuwe import.

## Ontbrekende of afwijkende waarden

Een leeg of ongeldig Excelveld wordt nooit automatisch als nul behandeld.

De applicatie zoekt bij een onvolledige medewerkerregel naar de meest recente eerdere maand waarin alle vier velden wel leesbaar zijn. Die maand wordt tijdelijk gebruikt en duidelijk als terugvalbron gemarkeerd.

Admins zien op de urenpagina onder `Datakwaliteit`:

- welke maandpagina ontbreekt;
- welke medewerker één of meer velden mist;
- uit welke eerdere maand tijdelijk gegevens worden gebruikt;
- of de totaalcel afwijkt van `Minstens + Overuren deze maand`;
- of een Excelmedewerker niet als actieve contractmedewerker staat ingesteld.

Een admin kan per medewerker en maand één of meer waarden handmatig overschrijven, met een toelichting. Lege correctievelden blijven uit Excel komen. De correctie kan later worden verwijderd zodat de applicatie weer volledig de geïmporteerde Excelwaarde gebruikt.

## Validatievoorbeeld Jul 26

Voor Leroy levert de aangeleverde pagina `Jul 26`:

| Veld | Waarde |
|---|---:|
| Datumregels | 35 |
| Weken | 5 |
| Minstens | 175 |
| Overuren deze maand | 9,5 |
| Ingepland | 184,5 |
| Overuren vorige maand | -23 |
| Overuren na deze maand | -13,5 |

De formulecontrole is:

`175 + 9,5 = 184,5`

## Flexmedewerkers

Flexmedewerkers hebben niet noodzakelijk de vier vaste maandvelden. Hun vergelijking blijft gebaseerd op de geïmporteerde diensten, de vorige maand en het flexgemiddelde.

## Medewerkers en contractperiodes

De adminpagina `employee-settings.html` blijft bedoeld voor:

- activeren en deactiveren van medewerkers;
- contractperiodes met start- en stopdatum;
- contracturen per week;
- historische contractinformatie.

Contractperiodes mogen elkaar niet overlappen. De Excelwaarde `Minstens` is echter leidend voor de norm van een geïmporteerde maandpagina.
