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
- directe HealthPlanner-ingang vanaf het rolgebonden startdashboard.

### Bewuste grenzen

- de PDF wordt gebruikt om de bronstructuur te definiëren, niet als stille productie-import;
- percentages, duurwaarden en momentopnamen worden niet als gewone aantallen opgeteld;
- salaris, payroll, medische diagnoses en individuele zorggegevens blijven uitgesloten.

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
