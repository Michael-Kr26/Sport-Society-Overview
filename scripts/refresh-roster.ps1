param(
    [Parameter(Position = 0)]
    [string]$WorkbookPath = ".\data\imports\Rooster.xlsx",

    [Parameter(Position = 1)]
    [string]$Month = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Release-ComObject {
    param([object]$ComObject)
    if ($null -ne $ComObject) {
        try {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($ComObject)
        } catch {
            # Opruimen mag het hoofdproces niet laten mislukken.
        }
    }
}

if ($Month -and $Month -notmatch '^\d{4}-(0[1-9]|1[0-2])$') {
    throw "Maand moet het formaat JJJJ-MM hebben, bijvoorbeeld 2026-10."
}

$resolvedWorkbook = (Resolve-Path $WorkbookPath -ErrorAction Stop).Path
if ([System.IO.Path]::GetExtension($resolvedWorkbook) -notin @('.xlsx', '.xlsm')) {
    throw "Gebruik een .xlsx- of .xlsm-bestand."
}

$runningExcel = Get-Process EXCEL -ErrorAction SilentlyContinue
if ($runningExcel) {
    throw "Sluit Excel volledig voordat je het rooster ververst. Er draait nog minstens één Excel-proces."
}

$backupDirectory = Join-Path $projectRoot 'data\backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupDirectory ("Rooster-before-refresh-{0}{1}" -f $timestamp, [System.IO.Path]::GetExtension($resolvedWorkbook))
Copy-Item $resolvedWorkbook $backupPath -Force
Write-Host "Back-up gemaakt: $backupPath"

$excel = $null
$workbook = $null
try {
    Write-Host "Excel volledig herberekenen: $resolvedWorkbook"
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.EnableEvents = $false

    # 3 = externe koppelingen bij openen bijwerken; false = niet alleen-lezen.
    $workbook = $excel.Workbooks.Open($resolvedWorkbook, 3, $false)

    # -4105 = automatische berekening.
    $excel.Calculation = -4105
    $workbook.RefreshAll()

    try {
        $excel.CalculateUntilAsyncQueriesDone()
    } catch {
        Write-Host "Geen asynchrone gegevensverbindingen om af te wachten."
    }

    $excel.CalculateFullRebuild()
    $workbook.Save()
    Write-Host "Excel is volledig herberekend en opgeslagen."
}
finally {
    if ($null -ne $workbook) {
        try { $workbook.Close($false) } catch {}
    }
    if ($null -ne $excel) {
        try { $excel.Quit() } catch {}
    }
    Release-ComObject $workbook
    Release-ComObject $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

Write-Host "`nRooster en Excel-maandvelden opnieuw importeren..."
& node (Join-Path $projectRoot 'import-roster-linked.js') $resolvedWorkbook
if ($LASTEXITCODE -ne 0) {
    throw "De roosterimport is mislukt met exitcode $LASTEXITCODE."
}

Write-Host "`nBronnen controleren..."
$reportArguments = @((Join-Path $projectRoot 'report-hour-sources.js'))
if ($Month) { $reportArguments += $Month }
& node @reportArguments
if ($LASTEXITCODE -ne 0) {
    throw "De broncontrole is mislukt met exitcode $LASTEXITCODE."
}

Write-Host "`nVerversing voltooid. Herlaad hours.html met Ctrl+Shift+R wanneer de server al draait."
