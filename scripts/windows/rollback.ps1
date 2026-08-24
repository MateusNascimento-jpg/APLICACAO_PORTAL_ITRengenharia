[CmdletBinding()]
param(
    [string]$Destination = 'C:\Users\itr_l\Downloads\Login_final\itr_corrigido\APLICACAO_PORTAL_ITRengenharia',
    [string]$Backup = '',
    [switch]$ConfirmRollback
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ConfirmRollback) { throw 'Rollback exige -ConfirmRollback para evitar execução acidental.' }
$Destination = (Resolve-Path -LiteralPath $Destination).Path
$Parent = Split-Path -Parent $Destination

if (-not $Backup) {
    $Pointer = Join-Path $Parent 'LAST_BACKUP_PORTAL_ITR.txt'
    if (Test-Path -LiteralPath $Pointer) { $Backup = (Get-Content -LiteralPath $Pointer -Raw).Trim() }
}
if (-not $Backup -or -not (Test-Path -LiteralPath $Backup -PathType Container)) {
    $Candidate = Get-ChildItem -LiteralPath $Parent -Directory -Filter 'BACKUP_APLICACAO_PORTAL_ITR_*' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($Candidate) { $Backup = $Candidate.FullName }
}
if (-not $Backup -or -not (Test-Path -LiteralPath $Backup -PathType Container)) { throw 'Backup válido não encontrado.' }

foreach ($required in @('server.js','package.json','public')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Backup $required))) { throw "Backup inválido: item ausente $required" }
}

$Rejected = Join-Path $Parent ('REJEITADO_PORTAL_ITR_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $Rejected -Force | Out-Null
Write-Host "[rollback] Guardando a versão rejeitada em: $Rejected" -ForegroundColor Yellow
& robocopy $Destination $Rejected /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "Não foi possível preservar a versão rejeitada (robocopy $LASTEXITCODE)." }

Write-Host "[rollback] Restaurando exatamente: $Backup" -ForegroundColor Cyan
& robocopy $Backup $Destination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /XF BACKUP_INFO.txt /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "Rollback falhou (robocopy $LASTEXITCODE)." }

Write-Host '[rollback] Versão anterior restaurada integralmente.' -ForegroundColor Green
