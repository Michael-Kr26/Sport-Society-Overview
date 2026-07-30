param(
    [Parameter(Mandatory = $true)]
    [string]$WorkbookPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$metricMap = @{
    'minstens' = 'minimumHours'
    'overuren deze maand' = 'overtimeThisMonth'
    'overuren vorige maand' = 'overtimePreviousMonth'
    'overuren na deze maand' = 'overtimeAfterMonth'
}

$monthMap = [ordered]@{
    1 = @('januari', 'jan')
    2 = @('februari', 'feb')
    3 = @('maart', 'mrt', 'maa')
    4 = @('april', 'apr')
    5 = @('mei')
    6 = @('juni', 'jun')
    7 = @('juli', 'jul')
    8 = @('augustus', 'aug')
    9 = @('september', 'sept', 'sep')
    10 = @('oktober', 'okt')
    11 = @('november', 'nov')
    12 = @('december', 'dec')
}

function Release-ComObject {
    param([object]$ComObject)
    if ($null -ne $ComObject) {
        try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($ComObject) } catch {}
    }
}

function Clean-Text {
    param([object]$Value)
    if ($null -eq $Value) { return '' }
    $text = ([string]$Value).Replace([char]0x00A0, ' ')
    $text = $text -replace '\s+', ' '
    return $text.Trim()
}

function Normalize-Text {
    param([object]$Value)
    return (Clean-Text $Value).ToLowerInvariant()
}

function Parse-PeriodKey {
    param([string]$SheetName)
    $base = (Clean-Text $SheetName) -replace '\s*\(\d+\)\s*$', ''
    $yearMatches = [regex]::Matches($base, '\d{2,4}')
    if ($yearMatches.Count -eq 0) { return $null }
    $yearToken = $yearMatches[$yearMatches.Count - 1].Value
    if ($yearToken.Length -eq 2) { $year = 2000 + [int]$yearToken }
    elseif ($yearToken.Length -eq 4) { $year = [int]$yearToken }
    else { return $null }
    if ($year -lt 2000 -or $year -gt 2100) { return $null }

    $compact = $base.ToLowerInvariant() -replace "[’']", '' -replace '[.\s_-]+', ''
    foreach ($entry in $monthMap.GetEnumerator()) {
        foreach ($alias in $entry.Value) {
            if ($compact.StartsWith($alias)) {
                return ('{0}-{1:D2}' -f $year, [int]$entry.Key)
            }
        }
    }
    return $null
}

function Convert-HourValue {
    param([object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or
        $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
        return [math]::Round([double]$Value, 2)
    }

    $text = (Clean-Text $Value).Replace(',', '.')
    if (-not $text) { return $null }
    $number = 0.0
    if ([double]::TryParse($text, [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return [math]::Round($number, 2)
    }
    return $null
}

function Get-ArrayValue {
    param(
        [object]$Array,
        [int]$Row,
        [int]$Column,
        [int]$RowCount,
        [int]$ColumnCount
    )
    if ($RowCount -eq 1 -and $ColumnCount -eq 1) { return $Array }
    return $Array[$Row, $Column]
}

function Get-ColumnLetter {
    param([int]$Column)
    $result = ''
    $value = $Column
    while ($value -gt 0) {
        $value--
        $result = [char](65 + ($value % 26)) + $result
        $value = [math]::Floor($value / 26)
    }
    return $result
}

function Wait-ForCalculation {
    param([object]$Excel, [int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($Excel.CalculationState -ne 0) {
        if ((Get-Date) -gt $deadline) {
            throw "Excelberekening duurde langer dan $TimeoutSeconds seconden."
        }
        Start-Sleep -Milliseconds 250
    }
}

$resolvedWorkbook = (Resolve-Path $WorkbookPath -ErrorAction Stop).Path
$outputDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

$excel = $null
$workbook = $null
$periods = @()

try {
    Write-Host "Excel-formules rechtstreeks berekenen en uitlezen: $resolvedWorkbook"
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.EnableEvents = $false

    $workbook = $excel.Workbooks.Open($resolvedWorkbook, 3, $false)
    $excel.Calculation = -4105
    try { $workbook.ForceFullCalculation = $true } catch {}
    try { $workbook.FullCalculationOnLoad = $true } catch {}
    $workbook.RefreshAll()
    try { $excel.CalculateUntilAsyncQueriesDone() } catch {}
    $excel.CalculateFullRebuild()
    Wait-ForCalculation -Excel $excel
    $workbook.Save()

    foreach ($worksheet in $workbook.Worksheets) {
        $periodKey = Parse-PeriodKey ([string]$worksheet.Name)
        if (-not $periodKey) {
            Release-ComObject $worksheet
            continue
        }

        $used = $worksheet.UsedRange
        $firstRow = [int]$used.Row
        $firstColumn = [int]$used.Column
        $rowCount = [int]$used.Rows.Count
        $columnCount = [int]$used.Columns.Count
        $lastRow = $firstRow + $rowCount - 1
        $lastColumn = $firstColumn + $columnCount - 1
        $values = $used.Value2
        $formulas = $used.Formula

        $getValue = {
            param([int]$AbsoluteRow, [int]$AbsoluteColumn)
            $relativeRow = $AbsoluteRow - $firstRow + 1
            $relativeColumn = $AbsoluteColumn - $firstColumn + 1
            if ($relativeRow -lt 1 -or $relativeRow -gt $rowCount -or
                $relativeColumn -lt 1 -or $relativeColumn -gt $columnCount) { return $null }
            return Get-ArrayValue -Array $values -Row $relativeRow -Column $relativeColumn -RowCount $rowCount -ColumnCount $columnCount
        }
        $getFormula = {
            param([int]$AbsoluteRow, [int]$AbsoluteColumn)
            $relativeRow = $AbsoluteRow - $firstRow + 1
            $relativeColumn = $AbsoluteColumn - $firstColumn + 1
            if ($relativeRow -lt 1 -or $relativeRow -gt $rowCount -or
                $relativeColumn -lt 1 -or $relativeColumn -gt $columnCount) { return $null }
            $formula = Get-ArrayValue -Array $formulas -Row $relativeRow -Column $relativeColumn -RowCount $rowCount -ColumnCount $columnCount
            $text = Clean-Text $formula
            return $(if ($text.StartsWith('=')) { $text } else { $null })
        }

        $blocks = @()
        $employeeName = $null
        $startColumn = $null
        for ($column = [math]::Max(3, $firstColumn); $column -le $lastColumn; $column++) {
            $raw = & $getValue 1 $column
            $text = Clean-Text $raw
            $normalized = Normalize-Text $raw
            if ($normalized -eq 'uren') {
                if ($employeeName) {
                    $blocks += [pscustomobject]@{
                        employeeName = $employeeName
                        startColumn = $startColumn
                        hoursColumn = $column
                    }
                }
                $employeeName = $null
                $startColumn = $null
                continue
            }
            if ($text -and -not $metricMap.ContainsKey($normalized)) {
                $numeric = 0.0
                $isNumeric = [double]::TryParse($text.Replace(',', '.'), [Globalization.NumberStyles]::Float,
                    [Globalization.CultureInfo]::InvariantCulture, [ref]$numeric)
                if (-not $isNumeric) {
                    $employeeName = $text
                    $startColumn = $column
                }
            }
        }

        $summaries = @()
        foreach ($block in $blocks) {
            $fields = [ordered]@{
                scheduledHours = $null
                minimumHours = $null
                overtimeThisMonth = $null
                overtimePreviousMonth = $null
                overtimeAfterMonth = $null
            }
            $sourceCells = [ordered]@{}
            $minimumRow = $null

            for ($row = [math]::Max(2, $firstRow); $row -le $lastRow; $row++) {
                for ($column = $block.startColumn; $column -lt $block.hoursColumn; $column++) {
                    $label = Normalize-Text (& $getValue $row $column)
                    if (-not $metricMap.ContainsKey($label)) { continue }
                    $field = $metricMap[$label]
                    if ($null -ne $sourceCells[$field]) { continue }
                    $value = Convert-HourValue (& $getValue $row $block.hoursColumn)
                    $address = '{0}{1}' -f (Get-ColumnLetter $block.hoursColumn), $row
                    $fields[$field] = $value
                    $sourceCells[$field] = [ordered]@{
                        address = $address
                        formula = (& $getFormula $row $block.hoursColumn)
                        rawValue = (& $getValue $row $block.hoursColumn)
                    }
                    if ($field -eq 'minimumHours') { $minimumRow = $row }
                }
            }

            if ($minimumRow -and $minimumRow -gt 1) {
                $scheduledRow = $minimumRow - 1
                $fields.scheduledHours = Convert-HourValue (& $getValue $scheduledRow $block.hoursColumn)
                $sourceCells.scheduledHours = [ordered]@{
                    address = ('{0}{1}' -f (Get-ColumnLetter $block.hoursColumn), $scheduledRow)
                    formula = (& $getFormula $scheduledRow $block.hoursColumn)
                    rawValue = (& $getValue $scheduledRow $block.hoursColumn)
                }
            }

            $summaries += [pscustomobject]@{
                employeeName = [string]$block.employeeName
                sourceColumn = Get-ColumnLetter $block.hoursColumn
                scheduledHours = $fields.scheduledHours
                minimumHours = $fields.minimumHours
                overtimeThisMonth = $fields.overtimeThisMonth
                overtimePreviousMonth = $fields.overtimePreviousMonth
                overtimeAfterMonth = $fields.overtimeAfterMonth
                sourceCells = $sourceCells
            }
        }

        $periods += [pscustomobject]@{
            periodKey = $periodKey
            sheetName = [string]$worksheet.Name
            summaries = $summaries
        }

        Release-ComObject $used
        Release-ComObject $worksheet
    }
}
finally {
    if ($null -ne $workbook) { try { $workbook.Close($false) } catch {} }
    if ($null -ne $excel) { try { $excel.Quit() } catch {} }
    Release-ComObject $workbook
    Release-ComObject $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$workbookHash = (Get-FileHash -Path $resolvedWorkbook -Algorithm SHA256).Hash.ToLowerInvariant()
$snapshot = [ordered]@{
    schemaVersion = 1
    sourceFile = [System.IO.Path]::GetFileName($resolvedWorkbook)
    workbookSha256 = $workbookHash
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    periods = $periods
}

$snapshot | ConvertTo-Json -Depth 12 | Set-Content -Path $resolvedOutput -Encoding UTF8
Write-Host "Berekende Excel-snapshot opgeslagen: $resolvedOutput"
Write-Host ("Maandpagina's: {0}; medewerkerblokken: {1}" -f $periods.Count, (($periods | ForEach-Object { $_.summaries.Count } | Measure-Object -Sum).Sum))
