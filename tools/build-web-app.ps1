param(
  [string]$OutputRoot = "dist",
  [string]$WebAppUrl = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distRoot = Join-Path $projectRoot $OutputRoot
$webRoot = Join-Path $distRoot "web-app"

if (Test-Path $webRoot) {
  $resolvedWebRoot = Resolve-Path $webRoot
  if (-not $resolvedWebRoot.Path.StartsWith($projectRoot.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove output outside project: $resolvedWebRoot"
  }
  Remove-Item -LiteralPath $resolvedWebRoot.Path -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $webRoot | Out-Null

$items = @(
  "index.html",
  "styles.css",
  "app.js",
  "web-app-config.js",
  "service-worker.js",
  "manifest.webmanifest",
  "icons",
  "vendor"
)

foreach ($item in $items) {
  $source = Join-Path $projectRoot $item
  $target = Join-Path $webRoot $item
  if (Test-Path $source -PathType Container) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $target
  }
}

Set-Content -LiteralPath (Join-Path $webRoot ".nojekyll") -Value "" -Encoding UTF8

if ($WebAppUrl) {
  $escapedUrl = $WebAppUrl.Replace("\", "\\").Replace('"', '\"')
  $config = @"
(() => {
  globalThis.DAILY_PDF_READER_WEB_APP_URL = "$escapedUrl";
})();
"@
  Set-Content -LiteralPath (Join-Path $webRoot "web-app-config.js") -Value $config -Encoding UTF8
}

Write-Host "Built hosted PWA:"
Write-Host $webRoot
