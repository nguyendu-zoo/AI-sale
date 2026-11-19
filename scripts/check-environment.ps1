$ErrorActionPreference = 'Continue'
Write-Output "Windows: $([System.Environment]::OSVersion.VersionString)"
Write-Output "PowerShell: $($PSVersionTable.PSVersion)"
foreach ($tool in @('node', 'pnpm', 'docker', 'git', 'wsl')) {
  $command = Get-Command $tool -ErrorAction SilentlyContinue
  if ($null -eq $command) { Write-Output "MISSING: $tool" } else { Write-Output "$tool : $($command.Source)" }
}
node --version
pnpm --version
docker --version
docker compose version
docker info --format '{{.ServerVersion}}'
wsl --status
Write-Output 'Required: Node.js 22.12+ (22.x) or 24 LTS; pnpm 10; running Docker Desktop Linux containers / WSL2.'
Write-Output 'If Node16 is selected with nvm-windows: nvm list; nvm use 22.15.0 (or install current supported LTS).'
