[CmdletBinding()]
param(
    [string]$Destination = 'C:\Users\itr_l\Downloads\Login_final\itr_corrigido\APLICACAO_PORTAL_ITRengenharia'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$SourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path

function Assert-Portal([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label não encontrado: $Path" }
    foreach ($required in @('server.js','package.json','public')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $required))) { throw "$Label inválido: item ausente $required" }
    }
}

Assert-Portal $SourceRoot 'Release final'
Assert-Portal $Destination 'Projeto parcialmente atualizado'
$Destination = (Resolve-Path -LiteralPath $Destination).Path

if (-not (Test-Path -LiteralPath (Join-Path $Destination '.env'))) {
    throw 'O .env preservado não foi encontrado. Interrompido sem alterações.'
}
if (-not (Test-Path -LiteralPath (Join-Path $Destination '.git'))) {
    throw 'A pasta .git não foi encontrada. Interrompido sem alterações.'
}

$Branch = (& git -C $Destination branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or -not $Branch) { throw 'Não foi possível identificar a branch atual.' }
if ($Branch -in @('main','master')) {
    throw 'A retomada foi recusada porque o projeto está em main/master. Use o rollback ou a branch de validação criada pelo instalador.'
}

Write-Host '[resume] Verificando o release final...' -ForegroundColor Cyan
& node (Join-Path $SourceRoot 'scripts\verify-release-manifest.js')
if ($LASTEXITCODE -ne 0) { throw 'Manifesto do release final falhou.' }

$Parent = Split-Path -Parent $Destination
$PartialBackup = Join-Path $Parent ('PARCIAL_PORTAL_ITR_V2_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $PartialBackup -Force | Out-Null
Write-Host "[resume] Preservando o estado parcial em: $PartialBackup" -ForegroundColor Cyan
& robocopy $Destination $PartialBackup /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "Backup do estado parcial falhou (robocopy $LASTEXITCODE)." }

Write-Host '[resume] Aplicando somente o release final. .env, .git, .vscode e node_modules são preservados.' -ForegroundColor Cyan
& robocopy $SourceRoot $Destination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /XD .git node_modules .vscode /XF .env /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "Cópia do hotfix falhou (robocopy $LASTEXITCODE)." }

Push-Location $Destination
try {
    Write-Host '[resume] Conferindo manifesto após a cópia...'
    node scripts/verify-release-manifest.js
    if ($LASTEXITCODE -ne 0) { throw 'Integridade do release final divergiu após a cópia.' }

    Write-Host '[resume] Confirmando as chaves de segurança no .env preservado...'
    node scripts/ensure-security-env.js
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao validar as chaves de segurança.' }

    Write-Host '[resume] Reinstalando dependências de forma determinística...'
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }

    Write-Host '[resume] Auditando dependências HIGH/CRITICAL...'
    npm audit --omit=dev --audit-level=high
    if ($LASTEXITCODE -ne 0) { throw 'npm audit encontrou vulnerabilidade HIGH/CRITICAL ou não pôde concluir.' }

    Write-Host '[resume] Verificação estrutural...'
    npm run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verificação estrutural falhou.' }

    Write-Host '[resume] Testes automatizados...'
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Testes automatizados falharam.' }

    $env:NODE_ENV = 'development'
    $env:PORTAL_SAFE_MODE = 'true'
    $env:PORTAL_WRITE_ENABLED = 'false'
    $env:TRUST_PROXY_HOPS = '0'

    Write-Host '[resume] Preflight antes da migration...'
    npm run preflight
    if ($LASTEXITCODE -ne 0) { throw 'Preflight falhou. Nenhuma migration foi executada.' }

    Write-Host '[resume] Migration aditiva/idempotente...'
    npm run migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migration falhou.' }

    Write-Host '[resume] Gerando/rotacionando a credencial do único Diretor...' -ForegroundColor Yellow
    npm run bootstrap:director
    if ($LASTEXITCODE -ne 0) { throw 'Preparação da credencial do Diretor falhou.' }

    Write-Host '[resume] Preflight final...'
    npm run preflight
    if ($LASTEXITCODE -ne 0) { throw 'Preflight final falhou.' }
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' PORTAL ITR FINAL — SEGURANÇA + DESIGN ORIGINAL APLICADOS' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host " Branch: $Branch"
Write-Host ' .env e .git: preservados'
Write-Host ' Modo local: SAFE MODE / escrita operacional bloqueada'
Write-Host ''
Write-Host 'Inicie o localhost com:' -ForegroundColor Cyan
Write-Host "& '$Destination\scripts\windows\start-local.ps1'" -ForegroundColor White
