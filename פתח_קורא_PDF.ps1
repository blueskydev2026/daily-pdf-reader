$ErrorActionPreference = "SilentlyContinue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5173
$Url = "http://127.0.0.1:$Port/"

Set-Location $Root

$Alive = $false
try {
  $Alive = ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200)
} catch {
  $Alive = $false
}

if (-not $Alive) {
  Start-Process -FilePath python -ArgumentList @("-m", "http.server", "$Port", "--bind", "127.0.0.1") -WorkingDirectory $Root -WindowStyle Hidden
  Start-Sleep -Milliseconds 700
}

Start-Process $Url
