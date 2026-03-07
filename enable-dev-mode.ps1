# Run this script as Administrator to enable Windows Developer Mode
# This allows creating symlinks without admin privileges

Write-Host "Enabling Windows Developer Mode..." -ForegroundColor Green

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell -> Run as Administrator, then run this script." -ForegroundColor Yellow
    exit 1
}

# Enable Developer Mode
$regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"
$regName = "AllowDevelopmentWithoutDevLicense"

if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}

Set-ItemProperty -Path $regPath -Name $regName -Value 1

# Also enable symlinks for non-admins
$regName2 = "AllowAllTrustedApps"
Set-ItemProperty -Path $regPath -Name $regName2 -Value 1

Write-Host "✓ Developer Mode enabled successfully!" -ForegroundColor Green
Write-Host "Please restart your terminal/VS Code for changes to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "After restart, run: bun run dev" -ForegroundColor Cyan
