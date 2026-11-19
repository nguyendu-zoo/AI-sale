param(
  [switch]$CheckOnly,
  [switch]$SkipInfrastructure
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousDirectory = Get-Location

function Test-SupportedNode([string]$Executable) {
  if (-not (Test-Path -LiteralPath $Executable)) { return $false }
  try {
    $versionText = (& $Executable --version).TrimStart('v')
    $nodeVersion = [version]$versionText
    return ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 12) -or
      ($nodeVersion.Major -ge 24 -and $nodeVersion.Major % 2 -eq 0)
  } catch { return $false }
}

function Invoke-ProjectPnpm([string[]]$Arguments) {
  & $script:nodeExecutable $script:pnpmEntry @Arguments
  if ($LASTEXITCODE -ne 0) { throw "pnpm command failed (exit $LASTEXITCODE)." }
}

try {
  Set-Location -LiteralPath $projectRoot
  $selectedNode = Get-Command node.exe -ErrorAction SilentlyContinue
  $script:nodeExecutable = if ($selectedNode) { $selectedNode.Source } else { '' }
  if (-not (Test-SupportedNode $script:nodeExecutable)) {
    $nvmRoot = $env:NVM_HOME
    if (-not $nvmRoot) { $nvmRoot = Join-Path $env:LOCALAPPDATA 'nvm' }
    $script:nodeExecutable = ''
    if (Test-Path -LiteralPath $nvmRoot) {
      $installedVersions = Get-ChildItem -LiteralPath $nvmRoot -Directory |
        Where-Object { $_.Name -match '^v\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_.Name.TrimStart('v') } -Descending
      foreach ($installed in $installedVersions) {
        $candidateNode = Join-Path $installed.FullName 'node.exe'
        if (Test-SupportedNode $candidateNode) { $script:nodeExecutable = $candidateNode; break }
      }
    }
  }
  if (-not $script:nodeExecutable) { throw 'Install supported Node.js 22.12+ or a newer even-numbered LTS release first. See docs/WINDOWS.md.' }
  $nodeDirectory = Split-Path -Parent $script:nodeExecutable
  $env:PATH = "$nodeDirectory;$env:PATH"
  $script:pnpmEntry = Join-Path $nodeDirectory 'node_modules/corepack/dist/pnpm.js'
  if (-not (Test-Path -LiteralPath $script:pnpmEntry)) { throw 'Corepack is missing from this Node installation. Install Corepack or use pnpm manually as described in README.md.' }
  $env:COREPACK_HOME = Join-Path $projectRoot '.tools/corepack'
  # Workspace-only shims let nested package scripts find pnpm without global installation.
  $toolBin = Join-Path $projectRoot '.tools/bin'
  New-Item -ItemType Directory -Path $toolBin -Force | Out-Null
  $corepackEntry = Join-Path $nodeDirectory 'node_modules/corepack/dist/corepack.js'
  & $script:nodeExecutable $corepackEntry enable --install-directory $toolBin pnpm
  if ($LASTEXITCODE -ne 0) { throw 'Could not create workspace pnpm shims.' }
  $env:PATH = "$toolBin;$env:PATH"
  Write-Output "Node executable: $script:nodeExecutable"
  & $script:nodeExecutable --version
  Invoke-ProjectPnpm -Arguments @('--version')
  if ($CheckOnly) {
    & docker compose version
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose is unavailable.' }
    $dockerServerVersion = & docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0 -or "$dockerServerVersion" -notmatch '^\d+\.\d+\.\d+') { throw 'Docker Desktop is not ready or access is denied.' }
    Write-Output "Docker Engine: $dockerServerVersion"
    Write-Output 'Environment check passed. The default system Node version was not changed.'
    return
  }
  Invoke-ProjectPnpm -Arguments @('install', '--frozen-lockfile')
  if (-not (Test-Path -LiteralPath '.env')) { Invoke-ProjectPnpm -Arguments @('setup:env') }
  if (-not $SkipInfrastructure) { Invoke-ProjectPnpm -Arguments @('infra:up') }
  Invoke-ProjectPnpm -Arguments @('db:generate')
  Invoke-ProjectPnpm -Arguments @('db:migrate')
  Invoke-ProjectPnpm -Arguments @('db:seed')
  Write-Output 'Dashboard: http://localhost:5173 | Mailpit: http://localhost:8025'
  Write-Output 'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD locally in .env, then seed again to create your initial admin.'
  Write-Output 'Existing .env values are preserved. External integrations stay in their configured mode.'
  Invoke-ProjectPnpm -Arguments @('dev')
} finally {
  Set-Location -LiteralPath $previousDirectory
}
