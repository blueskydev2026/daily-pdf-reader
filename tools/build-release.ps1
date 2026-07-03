param(
  [Parameter(Mandatory = $true)]
  [string]$WebAppUrl,
  [string]$OutputRoot = "dist"
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "build-extension.ps1") -OutputRoot $OutputRoot -WebAppUrl $WebAppUrl
& (Join-Path $PSScriptRoot "build-web-app.ps1") -OutputRoot $OutputRoot -WebAppUrl $WebAppUrl

Write-Host "Release build is ready."
Write-Host "Upload dist/web-app to HTTPS hosting."
Write-Host "Upload dist/daily-pdf-reader-extension.zip to Chrome/Edge extension stores."
