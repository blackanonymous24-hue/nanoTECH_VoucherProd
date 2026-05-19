# Deploiement : git push + mise a jour VPS (mot de passe dans deploy/vps.local.env).
# Usage : .\deploy\deploy-local.ps1
#         .\deploy\deploy-local.ps1 -SkipPush

param(
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$branch = "main"
if (-not $SkipPush) {
    Write-Host "==> git push origin $branch"
    git push origin $branch
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "Python introuvable. Installez Python 3 ou utilisez: py deploy/deploy-remote.py" -ForegroundColor Red
    exit 1
}

& $python.Source (Join-Path $PSScriptRoot "deploy-remote.py")
exit $LASTEXITCODE
