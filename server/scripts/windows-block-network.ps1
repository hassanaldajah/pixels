# Blocks outbound internet for the Pixels backend (and so for its image decoder) with a Windows Firewall rule.
# Run once, in an elevated PowerShell:   powershell -ExecutionPolicy Bypass -File scripts\windows-block-network.ps1
# Remove it again with:                  powershell -ExecutionPolicy Bypass -File scripts\windows-block-network.ps1 -Remove
# Pass the backend program if it is not the dev one:  ... -Program "C:\path\to\pixels-server.exe"
# Pixels only talks to itself on 127.0.0.1, which the firewall does not filter, so nothing in the app changes.
param(
    [string]$Program = (Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"),
    [switch]$Remove
)
$name = "Pixels decoder: no network"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Error "Run this from an elevated (Administrator) PowerShell."; exit 1 }

netsh advfirewall firewall delete rule name="$name" | Out-Null
if ($Remove) { Write-Host "Rule removed."; exit 0 }

# A venv's python.exe starts the base interpreter, so the base one has to be blocked as well.
$exe = (Resolve-Path $Program).Path
$programs = @($exe)
if (-not $PSBoundParameters.ContainsKey("Program")) {
    $base = (& $exe -c "import sys; print(sys._base_executable)")
    if ($base) { $programs += $base.Trim() }
}
foreach ($p in ($programs | Select-Object -Unique)) {
    netsh advfirewall firewall add rule name="$name" dir=out action=block program="$p" enable=yes profile=any | Out-Null
    Write-Host "Rule added for $p"
}
Write-Host "Restart Pixels. The security popover should now say: OS network isolation for the decoder: on"
