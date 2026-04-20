param(
  [int]$Port = 3000,
  [string]$HostAddr = '127.0.0.1'
)

$env:PORT = $Port
$env:HOST = $HostAddr

Write-Host "Starting MAGI runtime... preferred port=$Port host=$HostAddr" -ForegroundColor Cyan
node .\server.mjs
