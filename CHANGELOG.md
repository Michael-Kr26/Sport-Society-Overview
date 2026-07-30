# Changelog

Alle relevante wijzigingen aan Sport Society Overview worden vanaf V1.5 hier vastgelegd.

## 1.5.0-alpha.2 — in ontwikkeling

### Toegevoegd

- canoniek register voor de KPI's uit de dagelijkse HealthPlanner-managementrapportage;
- gevalideerde CSV/XLSX-import met preview vóór definitieve opslag;
- expliciete verwerking van `Gisteren` en `Maand tot rapportdatum` als verschillende periodevensters;
- revisielog voor gewijzigde HealthPlanner-bronwaarden;
- manager/admin-API met vestigingsbegrenzing;
- HealthPlanner-dashboard met verkoop, leads, leden, bezoek, coaching en ledenbehoud;
- importtemplate en volledig metriekregister;
- directe HealthPlanner-ingang vanaf het rolgebonden startdashboard;
- directe uitlezing van door Excel berekende maandwaarden via een gecontroleerde snapshot;
- SHA-256-controle waardoor een oude Excel-snapshot niet op een gewijzigd rooster kan worden toegepast;
- afzonderlijke controleopdracht voor de rechtstreeks door Excel berekende urenwaarden;
- automatische PowerShell-syntaxiscontrole in GitHub Actions.

### Gewijzigd

- de volledige roosterverversing gebruikt voor formulecellen niet langer uitsluitend de cache in het `.xlsx`-bestand;
- `Ingepland`, `Minstens` en de drie overurenvelden worden bij de betrouwbare Windows-verversing rechtstreeks uit de lokale Excel-applicatie gelezen;
- de Excel-snapshot kan ontbrekende of onvolledig gedetecteerde medewerkerblokken aanvullen voordat de database wordt opgebouwd.

### Bewuste grenzen

- de PDF wordt gebruikt om de bronstructuur te definiëren, niet als stille productie-import;
- percentages, duurwaarden en momentopnamen worden niet als gewone aantallen opgeteld;
- salaris, payroll, medische diagnoses en individuele zorggegevens blijven uitgesloten;
- de directe Excel-uitlezing vereist Windows met een lokaal geïnstalleerde Excel-versie.

## 1.5.0-alpha.1 — in ontwikkeling

### Toegevoegd

- afzonderlijke werkbranch `agent/v1-5-operational-release`;
- formele V1.5-scope en acceptatiecriteria;
- centrale `release.json` met versie, kanaal en releasestatus;
- nieuw rolgebonden startdashboard voor Guest, Employee, Manager en Admin;
- bronbewuste KPI’s voor effectieve diensten en Excel-urenstatus;
- directe acties per rol;
- zichtbare ontwikkelstatus op het dashboard.

### Gewijzigd

- de startpagina is van een algemene welkomstpagina naar een operationeel dashboard omgebouwd;
- managerselecties gebruiken waar mogelijk de gekoppelde profielvestiging;
- ontbrekende bronnen worden zichtbaar als fout of lege toestand weergegeven.

### Geparkeerd

- persoonlijk plus-/minurenoverzicht (`V2-PROFILE-01`) totdat Michael expliciet opdracht geeft voor uitvoering.

### Buiten scope

- salaris, payroll, loonstroken en salarisexports.
