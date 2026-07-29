param(
  [string]$HtmlInput = "tests/fixtures/complex-effects-stress.html",
  [string]$OutputDir = ".tmp/stress-suite"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$inputPath = [System.IO.Path]::GetFullPath((Join-Path $root $HtmlInput))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDir))
$pptxPath = Join-Path $outputPath "deck.pptx"
$htmlDir = Join-Path $outputPath "html"
$powerPointDir = Join-Path $outputPath "powerpoint"
$diffDir = Join-Path $outputPath "diff"
$evidencePath = Join-Path $outputPath "evidence.json"
$scorecardPath = Join-Path $outputPath "scorecard.json"
$tsx = Join-Path $root "node_modules\.bin\tsx.cmd"

New-Item -ItemType Directory -Force -Path $outputPath, $htmlDir, $powerPointDir, $diffDir | Out-Null

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

Push-Location $root
try {
  Invoke-Checked "npm.cmd" @("run", "--silent", "pptx:validate", "--", $inputPath)
  Invoke-Checked "npm.cmd" @("run", "--silent", "pptx:export", "--", $inputPath, $pptxPath)
  Invoke-Checked "npm.cmd" @("run", "--silent", "pptx:render-html", "--", $inputPath, $htmlDir)

  $powerpointAvailable = $true
  $powerpointOpenOk = $false
  try {
    Invoke-Checked "powershell.exe" @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", (Join-Path $root "src\validate\powerpoint-validator.ps1"),
      "-Pptx", $pptxPath,
      "-OutputDir", $powerPointDir
    )
    $powerpointOpenOk = $true
  }
  catch {
    if ($_.Exception.Message -match "Class not registered|ActiveX component|COM object") {
      $powerpointAvailable = $false
    }
    else {
      Write-Warning $_.Exception.Message
    }
  }

  $validationPath = $pptxPath -replace "\.pptx$", ".validation.json"
  $manifestPath = $pptxPath -replace "\.pptx$", ".conversion-manifest.json"
  $validation = Get-Content -LiteralPath $validationPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $htmlFiles = @(Get-ChildItem -LiteralPath $htmlDir -Filter "slide-*.png" -File | Sort-Object Name)
  $powerpointFiles = if ($powerpointOpenOk) {
    @(Get-ChildItem -LiteralPath $powerPointDir -Filter "slide-*.png" -File | Sort-Object Name)
  }
  else { @() }

  if ($powerpointOpenOk -and $htmlFiles.Count -ne $powerpointFiles.Count) {
    throw "HTML/PowerPoint render count differs: $($htmlFiles.Count) vs $($powerpointFiles.Count)"
  }

  $typographyEvidence = & $tsx "src/validate/stress-evidence.ts" $validationPath
  if ($LASTEXITCODE -ne 0) {
    throw "Validation report does not provide required typography evidence."
  }
  $undersizedTextBoxes = @(
    (($typographyEvidence -join "`n" | ConvertFrom-Json).undersizedTextBoxes) |
      Where-Object { $null -ne $_ }
  )

  $stackRecords = @($manifest.records | Where-Object { $_.slide -eq 4 })
  $imageIndex = -1
  $captionIndex = -1
  for ($index = 0; $index -lt $stackRecords.Count; $index++) {
    if ($stackRecords[$index].selector -eq "#stack-image") { $imageIndex = $index }
    if ($stackRecords[$index].selector -eq "#stack-caption" -and $stackRecords[$index].pptxOutputType -eq "native-text") {
      $captionIndex = $index
    }
  }
  $stackFailure = if ($imageIndex -ge 0 -and $captionIndex -ge 0 -and $imageIndex -lt $captionIndex) { 0 } else { 1 }

  $slides = @()
  for ($index = 0; $index -lt $htmlFiles.Count; $index++) {
    $slideNumber = $index + 1
    $diffRatio = 0.0
    if ($powerpointOpenOk) {
      $diffFile = Join-Path $diffDir $htmlFiles[$index].Name
      $raw = & $tsx "src/cli.ts" "compare" $htmlFiles[$index].FullName $powerpointFiles[$index].FullName $diffFile
      if ($LASTEXITCODE -ne 0) { throw "Image comparison failed for slide $slideNumber" }
      $diffRatio = [double](($raw -join "`n" | ConvertFrom-Json).ratio)
    }
    $slides += [ordered]@{
      slide = $slideNumber
      diffRatio = $diffRatio
      missingText = @($validation.missingProtectedText | Where-Object { $_.slide -eq $slideNumber }).Count
      layerFailures = if ($slideNumber -eq 4) { $stackFailure } else { 0 }
      typographyFailures = @($undersizedTextBoxes | Where-Object { $_.slide -eq $slideNumber }).Count
    }
  }

  $evidence = [ordered]@{
    structuralOk = [bool]$validation.ok
    unauthorizedRasterCount = @($validation.unauthorizedRasterRecords).Count
    fullSlideRasterCount = [int]$validation.fullSlideRasterCount
    undersizedTextBoxCount = $undersizedTextBoxes.Count
    powerpointAvailable = $powerpointAvailable
    powerpointOpenOk = $powerpointOpenOk
    slides = $slides
  }
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText(
    $evidencePath,
    ($evidence | ConvertTo-Json -Depth 8),
    $utf8
  )
  Invoke-Checked $tsx @("src/validate/stress-scorecard.ts", $evidencePath, $scorecardPath)
  Get-Content -LiteralPath $scorecardPath -Raw -Encoding UTF8
}
finally {
  Pop-Location
}
