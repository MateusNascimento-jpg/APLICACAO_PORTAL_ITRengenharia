[CmdletBinding()]
param(
    [int]$Port = 3000,
    [switch]$EnableWrites
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path

$env:NODE_ENV = 'development'
$env:PORT = [string]$Port
$env:PUBLIC_APP_ORIGIN = "http://localhost:$Port"
$env:TRUST_PROXY_HOPS = '0'

if ($EnableWrites) {
    Write-Host 'ATENÇÃO: este modo permite alterar a aprovação real no Airtable.' -ForegroundColor Red
    $Confirm = Read-Host 'Digite HABILITAR para continuar'
    if ($Confirm -cne 'HABILITAR') { throw 'Escrita não habilitada.' }
    $env:PORTAL_SAFE_MODE = 'false'
    $env:PORTAL_WRITE_ENABLED = 'true'
} else {
    $env:PORTAL_SAFE_MODE = 'true'
    $env:PORTAL_WRITE_ENABLED = 'false'
}

Push-Location $Project
try {
    npm run preflight
    if ($LASTEXITCODE -ne 0) { throw 'Preflight falhou; o servidor não será iniciado.' }
    Write-Host "[local] Abrindo http://localhost:$Port" -ForegroundColor Cyan
    $WriteMode = 'BLOQUEADO'
    if ($EnableWrites) { $WriteMode = 'HABILITADO' }
    Write-Host "[local] Modo de escrita: $WriteMode" -ForegroundColor Yellow
    npm start
}
finally { Pop-Location }
