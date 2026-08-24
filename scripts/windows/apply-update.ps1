[CmdletBinding()]
param(
    [string]$Destination = 'C:\Users\itr_l\Downloads\Login_final\itr_corrigido\APLICACAO_PORTAL_ITRengenharia',
    [string]$Branch = '',
    [switch]$SkipExtraBackup
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

Assert-Portal $SourceRoot 'Release extraído'
Assert-Portal $Destination 'Projeto atual'
$Destination = (Resolve-Path -LiteralPath $Destination).Path

if ($SourceRoot.TrimEnd('\') -ieq $Destination.TrimEnd('\')) {
    throw 'O release precisa estar extraído em outra pasta. Não execute a atualização usando a própria pasta de destino como fonte.'
}
if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot '.itr-release.json'))) {
    throw 'Manifesto .itr-release.json ausente. Não é seguro aplicar este diretório como release.'
}

try {
    $NodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
} catch {
    throw 'Node.js não foi encontrado no PATH. Instale Node 20+ antes de atualizar.'
}
if ($LASTEXITCODE -ne 0 -or $NodeMajor -lt 20) {
    throw "Node.js 20+ é obrigatório. Versão principal detectada: $NodeMajor"
}
& npm --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'npm não foi encontrado no PATH.' }

Write-Host '[update] Verificando a integridade SHA-256 do release extraído...' -ForegroundColor Cyan
& node (Join-Path $SourceRoot 'scripts\verify-release-manifest.js')
if ($LASTEXITCODE -ne 0) { throw 'A integridade do release falhou. Não houve alteração no projeto atual.' }

if (-not (Test-Path -LiteralPath (Join-Path $Destination '.env'))) {
    throw 'O .env atual não foi encontrado. A atualização foi interrompida antes de alterar arquivos.'
}
if (-not (Test-Path -LiteralPath (Join-Path $Destination '.git'))) {
    throw 'A pasta .git não foi encontrada. A atualização foi interrompida para não perder o vínculo com o GitHub.'
}

$Dirty = (& git -C $Destination status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível consultar o estado do Git.' }
if ($Dirty) {
    Write-Host '[update] O repositório possui alterações não commitadas:' -ForegroundColor Yellow
    $Dirty | ForEach-Object { Write-Host "  $_" }
    throw 'Faça commit/stash das alterações atuais antes de trocar a versão. O backup já pode ser feito normalmente.'
}

$Parent = Split-Path -Parent $Destination
if (-not $SkipExtraBackup) {
    $Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $Backup = Join-Path $Parent "BACKUP_APLICACAO_PORTAL_ITR_$Stamp"
    New-Item -ItemType Directory -Path $Backup -Force | Out-Null
    Write-Host "[update] Backup adicional: $Backup" -ForegroundColor Cyan
    & robocopy $Destination $Backup /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP
    if ($LASTEXITCODE -ge 8) { throw "Backup adicional falhou (robocopy $LASTEXITCODE)." }
    $Backup | Set-Content -LiteralPath (Join-Path $Parent 'LAST_BACKUP_PORTAL_ITR.txt') -Encoding UTF8
}

if (-not $Branch) { $Branch = 'portal-security-original-' + (Get-Date -Format 'yyyyMMdd-HHmm') }
& git -C $Destination show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) { $Branch = $Branch + '-' + (Get-Date -Format 'ss') }

Write-Host "[update] Criando branch de validação: $Branch" -ForegroundColor Cyan
& git -C $Destination switch -c $Branch
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar a branch de validação.' }

Write-Host '[update] Substituindo arquivos da aplicação. .env, .git e .vscode são preservados.' -ForegroundColor Cyan
& robocopy $SourceRoot $Destination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /XD .git node_modules .vscode /XF .env /NFL /NDL /NP
$CopyCode = $LASTEXITCODE
if ($CopyCode -ge 8) { throw "Substituição falhou (robocopy $CopyCode). Use o backup para rollback." }

$NodeModules = Join-Path $Destination 'node_modules'
if (Test-Path -LiteralPath $NodeModules) {
    Write-Host '[update] Removendo dependências antigas para instalação limpa...'
    Remove-Item -LiteralPath $NodeModules -Recurse -Force
}

Push-Location $Destination
try {
    Write-Host '[update] Garantindo as novas chaves de segurança no .env preservado...'
    node scripts/ensure-security-env.js
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o .env.' }

    Write-Host '[update] Instalando dependências exatamente pelo package-lock.json...'
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou.' }

    Write-Host '[update] Auditando vulnerabilidades HIGH/CRITICAL das dependências de produção...'
    npm audit --omit=dev --audit-level=high
    if ($LASTEXITCODE -ne 0) { throw 'npm audit encontrou vulnerabilidade HIGH/CRITICAL ou não conseguiu concluir a auditoria. Revise antes de continuar.' }

    Write-Host '[update] Conferindo novamente o manifesto após a cópia...'
    node scripts/verify-release-manifest.js
    if ($LASTEXITCODE -ne 0) { throw 'A integridade dos arquivos copiados divergiu do release.' }

    Write-Host '[update] Executando verificação estrutural...'
    npm run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verificação estrutural falhou.' }

    Write-Host '[update] Executando testes automatizados...'
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Testes automatizados falharam.' }

    Write-Host '[update] Testando conexões atuais antes da migration...'
    $env:NODE_ENV = 'development'
    $env:PORTAL_SAFE_MODE = 'true'
    $env:PORTAL_WRITE_ENABLED = 'false'
    $env:TRUST_PROXY_HOPS = '0'
    npm run preflight
    if ($LASTEXITCODE -ne 0) { throw 'Preflight falhou. Nenhuma migration foi executada.' }

    Write-Host '[update] Aplicando migration aditiva/idempotente de segurança...'
    npm run migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migration falhou. Consulte o erro antes de iniciar a aplicação.' }

    Write-Host '[update] Gerando/rotacionando a credencial do único Diretor...' -ForegroundColor Yellow
    npm run bootstrap:director
    if ($LASTEXITCODE -ne 0) { throw 'Preparação da credencial do Diretor falhou.' }

    Write-Host '[update] Preflight final...'
    npm run preflight
    if ($LASTEXITCODE -ne 0) { throw 'Preflight final falhou.' }
}
finally {
    Pop-Location
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' PORTAL ITR SEGURO + DESIGN ORIGINAL APLICADO' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host " Branch: $Branch"
Write-Host ' .env e .git: preservados'
Write-Host ' Airtable: mutações operacionais BLOQUEADAS no modo local seguro'
Write-Host ''
Write-Host 'Agora inicie o localhost com:' -ForegroundColor Cyan
Write-Host "& '$Destination\scripts\windows\start-local.ps1'" -ForegroundColor White
Write-Host ''
Write-Host 'Se reprovar esta versão, restaure com:' -ForegroundColor Yellow
Write-Host "& '$Destination\scripts\windows\rollback.ps1' -ConfirmRollback" -ForegroundColor White
