# Déploiement depuis votre PC : git push + mise à jour sur le VPS.
# Prérequis : deploy/vps.local.env (voir vps.local.env.example)
#
# Usage :
#   .\deploy\deploy-local.ps1
#   .\deploy\deploy-local.ps1 -SkipPush    # si vous avez déjà poussé sur GitHub

param(
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $PSScriptRoot "vps.local.env"

if (-not (Test-Path $EnvFile)) {
    Write-Host "Fichier manquant : deploy\vps.local.env" -ForegroundColor Red
    Write-Host "  copy deploy\vps.local.env.example deploy\vps.local.env"
    Write-Host "  puis renseignez VPS_HOST, VPS_USER et VPS_SSH_KEY (recommandé)."
    exit 1
}

Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        $name = $Matches[1]
        $value = $Matches[2].Trim().Trim('"').Trim("'")
        Set-Item -Path "Env:$name" -Value $value
    }
}

$hostName = $env:VPS_HOST
$user = $env:VPS_USER
if (-not $hostName -or -not $user) {
    Write-Host "VPS_HOST et VPS_USER sont obligatoires dans vps.local.env" -ForegroundColor Red
    exit 1
}

$port = if ($env:VPS_PORT) { $env:VPS_PORT } else { "22" }
$appDir = if ($env:VPS_APP_DIR) { $env:VPS_APP_DIR } else { "/var/www/vouchernet" }
$branch = if ($env:VOUCHERNET_BRANCH) { $env:VOUCHERNET_BRANCH } else { "main" }

Set-Location $RepoRoot

if (-not $SkipPush) {
    Write-Host "==> git push origin $branch"
    git push origin $branch
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$sshArgs = @(
    "-p", $port,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new"
)
if ($env:VPS_SSH_KEY -and (Test-Path $env:VPS_SSH_KEY)) {
    $sshArgs += @("-i", $env:VPS_SSH_KEY)
}

$remoteCmd = "cd '$appDir' && sudo bash deploy/update-vps.sh"
$target = "${user}@${hostName}"

Write-Host "==> SSH $target (mise à jour VPS)"
& ssh @sshArgs $target $remoteCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Échec SSH. Vérifiez :" -ForegroundColor Yellow
    Write-Host "  - Clé SSH : ssh-copy-id ou copie manuelle de votre clé publique vers le VPS"
    Write-Host "  - VPS_SSH_KEY dans deploy\vps.local.env"
    Write-Host "  - Accès : ssh ${user}@${hostName}"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Déploiement terminé — https://nanovoucher.com" -ForegroundColor Green
