param(
  [string]$OutputRoot = "dist",
  [string]$WebAppUrl = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distRoot = Join-Path $projectRoot $OutputRoot
$packageRoot = Join-Path $distRoot "chrome-edge-extension"
$zipPath = Join-Path $distRoot "daily-pdf-reader-extension.zip"

if (Test-Path $distRoot) {
  $resolvedDist = Resolve-Path $distRoot
  if (-not $resolvedDist.Path.StartsWith($projectRoot.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove output outside project: $resolvedDist"
  }
  Remove-Item -LiteralPath $resolvedDist.Path -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null

$items = @(
  "manifest.json",
  "index.html",
  "styles.css",
  "app.js",
  "web-app-config.js",
  "service-worker.js",
  "manifest.webmanifest",
  "icons",
  "vendor",
  "extension"
)

foreach ($item in $items) {
  $source = Join-Path $projectRoot $item
  $target = Join-Path $packageRoot $item
  if (Test-Path $source -PathType Container) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $target
  }
}

if ($WebAppUrl) {
  $escapedUrl = $WebAppUrl.Replace("\", "\\").Replace('"', '\"')
  $config = @"
(() => {
  globalThis.DAILY_PDF_READER_WEB_APP_URL = "$escapedUrl";
})();
"@
  Set-Content -LiteralPath (Join-Path $packageRoot "web-app-config.js") -Value $config -Encoding UTF8
}

Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

Write-Host "Built extension package:"
Write-Host $packageRoot
Write-Host $zipPath
