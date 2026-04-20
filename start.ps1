param(
  [int]$Port = 3000
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$env:PORT = "$Port"
node .\server.mjs
