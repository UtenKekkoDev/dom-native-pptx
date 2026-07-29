param(
  [string]$OutputDir = ".tmp/release/v0.2.0-beta.1"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Version = "0.2.0-beta.1"
$Tag = "v$Version"
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$tmpRoot = [System.IO.Path]::GetFullPath((Join-Path $root ".tmp"))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDir))
$workRelative = ".tmp/release-work/$Tag"
$workPath = [System.IO.Path]::GetFullPath((Join-Path $root $workRelative))
$fixture = "examples/10-full-business-deck/slides.html"
$fixturePath = Join-Path $root $fixture
$workDeck = Join-Path $workPath "demo.pptx"
$releaseDeck = Join-Path $outputPath "dom-native-pptx-v0.2.0-beta.1-demo.pptx"
$releaseManifest = Join-Path $outputPath "demo.conversion-manifest.json"
$releaseValidationJson = Join-Path $outputPath "demo.validation.json"
$releaseValidationHtml = Join-Path $outputPath "demo.validation.html"
$releaseScorecard = Join-Path $outputPath "stress-scorecard.json"
$packReport = Join-Path $outputPath "npm-pack-dry-run.json"
$releaseNotes = Join-Path $outputPath "RELEASE_NOTES.md"
$checksums = Join-Path $outputPath "SHA256SUMS.txt"
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Assert-SafeTmpChild {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $prefix = $tmpRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the repository .tmp directory."
  }
}

function Reset-SafeDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)

  Assert-SafeTmpChild -Path $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
  }
}

function Copy-RequiredFile {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Required prerelease artifact is missing: $([System.IO.Path]::GetFileName($Source))"
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

Push-Location $root
try {
  $package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($package.version -ne $Version) {
    throw "package.json version must be $Version, found $($package.version)."
  }

  Reset-SafeDirectory -Path $outputPath
  Reset-SafeDirectory -Path $workPath

  Invoke-Checked "npm.cmd" @("run", "test:package")
  Invoke-Checked "npm.cmd" @("run", "--silent", "pptx:validate", "--", $fixturePath)
  Invoke-Checked "npm.cmd" @("run", "--silent", "pptx:export", "--", $fixturePath, $workDeck)
  Invoke-Checked "powershell.exe" @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $root "src/validate/powerpoint-validator.ps1"),
    "-Pptx", $workDeck,
    "-OutputDir", (Join-Path $workPath "powerpoint")
  )
  Invoke-Checked "powershell.exe" @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $root "scripts/run-stress-suite.ps1"),
    "-OutputDir", "$workRelative/stress"
  )

  Copy-RequiredFile -Source $workDeck -Destination $releaseDeck
  Copy-RequiredFile -Source ($workDeck -replace "\.pptx$", ".conversion-manifest.json") -Destination $releaseManifest
  Copy-RequiredFile -Source ($workDeck -replace "\.pptx$", ".validation.json") -Destination $releaseValidationJson
  Copy-RequiredFile -Source ($workDeck -replace "\.pptx$", ".validation.html") -Destination $releaseValidationHtml
  Copy-RequiredFile -Source (Join-Path $workPath "stress/scorecard.json") -Destination $releaseScorecard

  $packJson = & "npm.cmd" @("pack", "--dry-run", "--json", "--ignore-scripts")
  if ($LASTEXITCODE -ne 0) {
    throw "npm pack dry-run failed with exit code $LASTEXITCODE."
  }
  [System.IO.File]::WriteAllText($packReport, ($packJson -join "`n"), $utf8)

  $sourceCommit = (& "git.exe" "rev-parse" "HEAD").Trim()
  if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch "^[0-9a-f]{40}$") {
    throw "Unable to resolve the exact source commit."
  }
  $notes = @"
# dom-native-pptx $Tag

GitHub prerelease for the fail-closed HTML DOM to native editable PowerPoint converter and Agent Skill.

- Source commit: ``$sourceCommit``
- Security default: safe mode
- Native protected text, tables, charts, and layer order are structurally validated.
- Real Microsoft PowerPoint rendering and the eight-slide stress scorecard passed on the release builder.
- The npm package is not published by this release.

See ``CHANGELOG.md`` and the repository README for usage, limitations, and the bilingual Agent conversion prompt.
"@
  [System.IO.File]::WriteAllText($releaseNotes, $notes, $utf8)

  $requiredArtifacts = @(
    $releaseDeck,
    $releaseManifest,
    $releaseValidationJson,
    $releaseValidationHtml,
    $releaseScorecard,
    $packReport,
    $releaseNotes
  )
  foreach ($artifact in $requiredArtifacts) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf) -or (Get-Item -LiteralPath $artifact).Length -eq 0) {
      throw "Prerelease artifact is missing or empty: $([System.IO.Path]::GetFileName($artifact))"
    }
  }

  $checksumLines = Get-ChildItem -LiteralPath $outputPath -File |
    Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
    Sort-Object Name |
    ForEach-Object {
      $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      "$hash  $($_.Name)"
    }
  [System.IO.File]::WriteAllText($checksums, (($checksumLines -join "`n") + "`n"), $utf8)

  [ordered]@{
    version = $Version
    sourceCommit = $sourceCommit
    outputDirectory = $outputPath
    artifacts = @(Get-ChildItem -LiteralPath $outputPath -File | Sort-Object Name | Select-Object -ExpandProperty Name)
  } | ConvertTo-Json -Depth 4
}
finally {
  Pop-Location
}
