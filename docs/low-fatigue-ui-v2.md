# Low-Fatigue UI V2

Status: implementatiebranch, nog niet gemerged.

## Doel

Een rustige operationele interface voor langdurig dagelijks gebruik. De visuele bron van waarheid bestaat uit `sso-design-system.css`, `styles.css` voor globale basiscompatibiliteit en module-CSS voor layout.

## Design tokens

- pagina: `#F4F7FB`
- surfaces: wit / `#F8FAFD`
- primaire tekst: navy/grijs
- primaire interactie: `#0F66DF`
- sidebar: `#0B1D38`
- statuskleuren uitsluitend functioneel
- normale tekst weight 400; sectietitels circa 600

## Navigatie

Desktop gebruikt een vaste navy sidebar met Algemeen, Operationeel, Management en Admin. Role visibility blijft gekoppeld aan het bestaande autorisatiemodel. Onderaan staat de daadwerkelijk ingelogde gebruiker met initialen, naam en rol. Mobiel gebruikt dezelfde informatiestructuur als off-canvas navigatie.

## Medewerkers

`employee-settings.html` is het overzicht. Een medewerker opent op `employee.html?id=<employee-id>` wanneer een canonieke R1-ID beschikbaar is. Historische/legacy medewerkers kunnen gecontroleerd via `name=` worden geopend.

De detailpagina gebruikt uitsluitend bestaande business-API's voor medewerkerinstellingen, contractperioden en laatste werkdag. Contracten zijn standaard read-only; edit- en add-formulieren worden pas na gebruikersactie zichtbaar. De destructieve sectie gebruikt de bestaande soft-active/inactive semantiek: historie wordt niet verwijderd.

## CSS cleanup

- `quiet-blue.css` is geneutraliseerd tot tombstone en wordt nergens geladen.
- `planner-theme.css` bevat geen `!important` reparatielaag meer; planner visuals staan in `roster.css`.
- employee module definieert geen eigen donker componentthema meer.
- operationele en managementmodules gebruiken gedeelde tokens en lichte surfaces.

## Handmatige visuele QA

Controleer voor goedkeuring minimaal 1440+, 1280, 768–1024 en ongeveer 390 px. Prioriteit:

1. sidebar expanded/collapsed/off-canvas;
2. employee overview + Denise/Jamie/future employee detail;
3. contract edit/add/cancel states;
4. planner weekgrid + shift drawer;
5. rooster week- en maandexport controls;
6. CML read-only Manager versus Admin actions;
7. tabellen zonder horizontale formulier-scroll op mobiel;
8. focus-visible en 44px mobiele touch targets.

Geen productiecutover of merge hoort bij deze UI-implementatie.
