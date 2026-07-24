param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = "Stop"
$resolvedPptx = (Resolve-Path -LiteralPath $Pptx).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDir).Path
Get-ChildItem -LiteralPath $resolvedOutput -Filter "slide-*.png" -File |
  Remove-Item -Force

$powerPoint = $null
$presentation = $null
$rendered = @()

try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $presentation = $powerPoint.Presentations.Open(
    $resolvedPptx,
    -1,
    0,
    0
  )
  # PowerPoint can return from Open before fonts and complex native shapes
  # have finished their first layout pass. Exporting immediately may produce
  # transiently clipped text even though the slide XML is correct.
  Start-Sleep -Seconds 5

  for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
    $slide = $null
    try {
      $slide = $presentation.Slides.Item($index)
      $fileName = "slide-{0:D3}.png" -f $index
      $outputFile = Join-Path $resolvedOutput $fileName
      $slide.Export($outputFile, "PNG", 1920, 1080)
      # Slide.Export can return before PowerPoint has completely flushed the
      # render pipeline. Serializing exports avoids partially laid-out text on
      # later slides in complex decks.
      Start-Sleep -Seconds 1
      $rendered += $outputFile
    }
    finally {
      if ($null -ne $slide) {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($slide) | Out-Null
      }
    }
  }

  [pscustomobject]@{
    ok = $true
    renderer = "Microsoft PowerPoint"
    pptx = $resolvedPptx
    outputDir = $resolvedOutput
    slideCount = $presentation.Slides.Count
    files = $rendered
  } | ConvertTo-Json -Depth 4
}
finally {
  if ($null -ne $presentation) {
    $presentation.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
  }
  if ($null -ne $powerPoint) {
    $powerPoint.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
