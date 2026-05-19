# Deploiement automatique : git push + mise a jour VPS (mot de passe dans deploy/vps.local.env).
#
# Usage :
#   .\deploy\deploy-local.ps1
#   .\deploy\deploy-local.ps1 -SkipPush

param(
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $PSScriptRoot "vps.local.env"

function Read-VpsEnvFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "Env:$name" -Value $value
        }
    }
    return $true
}

function Ensure-PoshSshModule {
    if (Get-Module -ListAvailable -Name Posh-SSH) {
        Import-Module Posh-SSH -ErrorAction Stop
        return
    }
    Write-Host "==> Installation du module Posh-SSH (une seule fois)..."
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        throw "PowerShell 5.1+ requis."
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $repo = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
    if ($repo -and $repo.InstallationPolicy -ne "Trusted") {
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
    }
    Install-Module -Name Posh-SSH -Scope CurrentUser -Force -AllowClobber
    Import-Module Posh-SSH -ErrorAction Stop
}

function Invoke-VpsSshCommand {
    param(
        [string]$HostName,
        [int]$Port,
        [string]$User,
        [string]$Password,
        [string]$Command
    )
    Ensure-PoshSshModule
    $secure = ConvertTo-SecureString $Password -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($User, $secure)
    $session = New-SSHSession -ComputerName $HostName -Port $Port -Credential $cred -AcceptKey -ConnectionTimeout 30
    if (-not $session) {
        throw "Connexion SSH impossible vers ${User}@${HostName}:${Port}"
    }
    try {
        $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $Command -TimeOut 900
        if ($result.Output) { Write-Host $result.Output }
        if ($result.Error) { Write-Host $result.Error -ForegroundColor DarkYellow }
        if ($result.ExitStatus -ne 0) {
            throw "Commande distante echouee (code $($result.ExitStatus))"
        }
    } finally {
        Remove-SSHSession -SessionId $session.SessionId | Out-Null
    }
}

if (-not (Read-VpsEnvFile -Path $EnvFile)) {
    Write-Host "Fichier manquant : deploy\vps.local.env" -ForegroundColor Red
    Write-Host "  copy deploy\vps.local.env.example deploy\vps.local.env"
    Write-Host "  puis mettez uniquement VPS_SSH_PASSWORD=votre_mot_de_passe"
    exit 1
}

$hostName = $env:VPS_HOST
$user = $env:VPS_USER
$password = $env:VPS_SSH_PASSWORD

if (-not $hostName) { $hostName = "69.62.110.53" }
if (-not $user) { $user = "root" }
if (-not $password -or $password -eq "CHANGE_ME") {
    Write-Host "Renseignez VPS_SSH_PASSWORD dans deploy\vps.local.env" -ForegroundColor Red
    exit 1
}

$port = 22
if ($env:VPS_PORT -and $env:VPS_PORT -match '^\d+$') { $port = [int]$env:VPS_PORT }
$appDir = if ($env:VPS_APP_DIR) { $env:VPS_APP_DIR } else { "/var/www/vouchernet" }
$branch = if ($env:VOUCHERNET_BRANCH) { $env:VOUCHERNET_BRANCH } else { "main" }

Set-Location $RepoRoot

if (-not $SkipPush) {
    Write-Host "==> git push origin $branch"
    git push origin $branch
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$remoteCmd = "cd '$appDir' && sudo bash deploy/update-vps.sh"
Write-Host "==> Mise a jour VPS ${user}@${hostName} ..."
Invoke-VpsSshCommand -HostName $hostName -Port $port -User $user -Password $password -Command $remoteCmd

Write-Host ""
Write-Host "Deploiement termine - https://nanovoucher.com" -ForegroundColor Green
