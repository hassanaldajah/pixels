<#
  Starts Pixels on Windows.

    .\start.ps1            build the web app if needed, start the backend, open the browser
    .\start.ps1 -Dev       backend + Vite dev server with hot reload (http://localhost:5173)
    .\start.ps1 -Lan       also allow other devices on your network (prints an access token)
    .\start.ps1 -Rebuild   rebuild the web app first
#>
param(
  [switch]$Dev,
  [switch]$Lan,
  [switch]$Rebuild,
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd was not found. $hint" }
}
Need 'uv' 'Install it with: py -m pip install --user uv   (or see https://docs.astral.sh/uv/)'
Need 'pnpm' 'Install it with: npm install -g pnpm   (needs Node.js 22+)'

Write-Host 'Installing dependencies...' -ForegroundColor Cyan
Push-Location "$root\server"; uv sync --frozen; Pop-Location
Push-Location $root; pnpm install --frozen-lockfile; Pop-Location

$serverArgs = @('run', 'python', '-m', 'app', '--port', $Port)
if ($Lan) { $serverArgs += '--lan' }
if ($Dev) { $serverArgs += '--dev' }

if ($Dev) {
  $env:PIXELS_BACKEND = "http://127.0.0.1:$Port"
  $backend = Start-Process uv -ArgumentList $serverArgs -WorkingDirectory "$root\server" -PassThru -NoNewWindow
  try {
    Start-Process 'http://localhost:5173'
    Push-Location "$root\apps\web"; pnpm run dev; Pop-Location
  } finally {
    if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
  }
  return
}

if ($Rebuild -or -not (Test-Path "$root\apps\web\dist\index.html")) {
  Write-Host 'Building the web app...' -ForegroundColor Cyan
  Push-Location "$root\apps\web"; pnpm run build; Pop-Location
}

Start-Job -ScriptBlock { Start-Sleep -Seconds 2; Start-Process "http://127.0.0.1:$using:Port" } | Out-Null
Push-Location "$root\server"
try { uv @serverArgs } finally { Pop-Location }
