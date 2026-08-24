[CmdletBinding()]
param(
    [string]$Project = 'C:\Users\itr_l\Downloads\Login_final\itr_corrigido\APLICACAO_PORTAL_ITRengenharia'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Project([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "Projeto não encontrado: $Path" }
    foreach ($required in @('server.js','package.json','public')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $required))) {
            throw "O diretório não parece ser o Portal ITR. Item ausente: $required"
        }
    }
}

Assert-Project $Project
$Project = (Resolve-Path -LiteralPath $Project).Path
$Parent = Split-Path -Parent $Project
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = Join-Path $Parent "BACKUP_APLICACAO_PORTAL_ITR_$Stamp"

New-Item -ItemType Directory -Path $Backup -Force | Out-Null
Write-Host "[backup] Copiando versão atual para:`n$Backup" -ForegroundColor Cyan
& robocopy $Project $Backup /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP
$Code = $LASTEXITCODE
if ($Code -ge 8) { throw "Robocopy falhou com código $Code." }

$Manifest = @(
    "Criado em: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "Origem: $Project"
    "Backup: $Backup"
)
$Manifest | Set-Content -LiteralPath (Join-Path $Backup 'BACKUP_INFO.txt') -Encoding UTF8
$Backup | Set-Content -LiteralPath (Join-Path $Parent 'LAST_BACKUP_PORTAL_ITR.txt') -Encoding UTF8

if (Test-Path -LiteralPath (Join-Path $Project '.git')) {
    $Head = (& git -C $Project rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $Head) { Add-Content -LiteralPath (Join-Path $Backup 'BACKUP_INFO.txt') -Value "Git HEAD: $Head" }
}

Write-Host '[backup] Backup integral concluído.' -ForegroundColor Green
Write-Host "[backup] NÃO apague esta pasta até concluir a validação da nova versão." -ForegroundColor Yellow
Write-Host $Backup
