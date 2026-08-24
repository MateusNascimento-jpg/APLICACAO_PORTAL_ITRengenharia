[CmdletBinding()]
param(
    [string]$Message = 'Portal: hardening de seguranca com design original preservado'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $Project
try {
    $Branch = (& git branch --show-current).Trim()
    if (-not $Branch) { throw 'Não foi possível identificar a branch atual.' }
    if ($Branch -in @('main','master')) { throw 'Publicação recusada: use a branch de validação, não main/master.' }

    npm run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verificação falhou.' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }
    & git diff --check
    if ($LASTEXITCODE -ne 0) { throw 'git diff --check encontrou problemas.' }

    & git add -A
    $Staged = & git diff --cached --name-only
    if ($Staged -match '(^|/)\.env($|\.)' -or $Staged -match '(^|/)node_modules/' -or $Staged -match '(^|/)Diagnosticos/') {
        & git reset
        throw 'Arquivo sensível/indevido seria enviado ao GitHub. Stage desfeito.'
    }

    $Diff = (& git diff --cached --no-ext-diff -U0) -join "`n"
    $SecretPattern = '(?i)(AIRTABLE_TOKEN\s*=\s*[^<\s][^\s]{12,}|PORTAL_SECURITY_PEPPER\s*=\s*[^<\s][^\s]{12,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\bpat[A-Za-z0-9_\-]{20,})'
    if ($Diff -match $SecretPattern) {
        & git reset
        throw 'Possível segredo detectado no conteúdo staged. Stage desfeito para revisão.'
    }

    Write-Host '[git] Arquivos preparados:' -ForegroundColor Cyan
    $Staged | ForEach-Object { Write-Host "  $_" }
    & git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw 'Commit falhou.' }
    & git push -u origin $Branch
    if ($LASTEXITCODE -ne 0) { throw 'Push falhou.' }
    Write-Host "[git] Branch publicada: $Branch" -ForegroundColor Green
    Write-Host '[git] Nenhum merge em main/master foi executado.' -ForegroundColor Yellow
}
finally { Pop-Location }
