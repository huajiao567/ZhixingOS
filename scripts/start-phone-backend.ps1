$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lanAddress = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress

if (!$lanAddress) { throw 'No LAN IPv4 address was found.' }

Write-Host "Backend LAN URL: http://${lanAddress}:3001"
Write-Host 'Keep the phone and computer on the same network. Allow Node.js on private networks if Windows Firewall asks.'
Write-Host 'Demo account: demo@zhixingos.com / demo1234'

$env:HOST = '0.0.0.0'
$env:BACKUP_ENABLED = 'false'
npm --prefix (Join-Path $projectRoot 'backend') run dev
