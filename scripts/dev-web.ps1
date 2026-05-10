# Démarre Postgres (Docker) + schéma DB + API + interface web pour développement local.
# Prérequis : Docker Desktop lancé (attends que Docker soit prêt).
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

function Invoke-Pnpm {
  param([string[]]$Args)
  & npx @("--yes", "pnpm@10.26.1") @Args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "=== Vérification Docker ===" -ForegroundColor Cyan
try {
  docker info 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "docker indisponible" }
} catch {
  Write-Host @"

Docker ne répond pas. Démarre Docker Desktop, attends la fin du démarrage,
puis relance :

  powershell -ExecutionPolicy Bypass -File scripts/dev-web.ps1

"@ -ForegroundColor Yellow
  exit 1
}

$ContainerName = "mikrotik-hotspot-pg-dev"
$DbUrl = "postgresql://postgres:dev@localhost:5432/vouchernet"

Write-Host "=== Postgres ($ContainerName) ===" -ForegroundColor Cyan
$exists = docker ps -a --filter "name=$ContainerName" --format "{{.Names}}"
if ($exists -eq $ContainerName) {
  docker start $ContainerName | Out-Null
} else {
  docker run -d `
    --name $ContainerName `
    -e POSTGRES_PASSWORD=dev `
    -e POSTGRES_DB=vouchernet `
    -p 5432:5432 `
    postgres:16-alpine | Out-Null
}

Write-Host "Attente de PostgreSQL..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  docker exec $ContainerName pg_isready -U postgres 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  Write-Host "PostgreSQL n'a pas démarré à temps." -ForegroundColor Red
  exit 1
}

$env:DATABASE_URL = $DbUrl
Write-Host "=== Schéma base (drizzle push) ===" -ForegroundColor Cyan
Invoke-Pnpm @("--filter", "@workspace/db", "run", "push-force")

Write-Host "=== Démarrage API (port 3001) en arrière-plan ===" -ForegroundColor Cyan
$apiJob = Start-Job -ScriptBlock {
  param($Root, $Db)
  $env:DATABASE_URL = $Db
  Set-Location $Root
  & npx @("--yes", "pnpm@10.26.1", "--filter", "@workspace/api-server", "dev") 2>&1
} -ArgumentList $RepoRoot, $DbUrl

Start-Sleep -Seconds 4
Receive-Job $apiJob -Keep | Select-Object -Last 15 | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "=== Web Vite : ouvre http://localhost:4173 ===" -ForegroundColor Green
Write-Host "API : http://localhost:3001  |  Ctrl+C arrête le web et l'API." -ForegroundColor Gray
Write-Host ""

try {
  Invoke-Pnpm @("--filter", "@workspace/app", "dev")
} finally {
  Stop-Job $apiJob -ErrorAction SilentlyContinue | Out-Null
  Receive-Job $apiJob -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $apiJob -Force -ErrorAction SilentlyContinue | Out-Null
}
