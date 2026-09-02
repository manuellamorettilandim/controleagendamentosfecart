[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
  [string]$IpAddress,

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [string]$RemoteUser = 'ubuntu',
  [string]$PublicHost,
  [string]$EnvironmentFile = '.env',
  [string]$ExpectedSupabaseProjectRef = 'rjvgcqijrffoflensyau',
  [switch]$Bootstrap,
  [switch]$SkipLocalTests
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) {
  $EnvironmentFile
} else {
  Join-Path $projectRoot $EnvironmentFile
}
$resolvedKeyPath = (Resolve-Path -LiteralPath $KeyPath).Path
$resolvedEnvironmentPath = (Resolve-Path -LiteralPath $environmentPath).Path

if (-not $PublicHost) {
  $PublicHost = "fecart.$($IpAddress.Replace('.', '-')).sslip.io"
}
if ($PublicHost -notmatch '^[a-zA-Z0-9.-]+$') {
  throw 'PublicHost invalido.'
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
    $parts = $trimmed.Split('=', 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$name] = $value
  }
  return $values
}

function Quote-SystemdValue([string]$Value) {
  return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatorio nao encontrado: $Name"
  }
}

Assert-Command 'ssh'
Assert-Command 'scp'
Assert-Command 'tar'

if (-not $SkipLocalTests) {
  Write-Host '==> Executando suite completa de testes locais antes do deploy...'
  Push-Location $projectRoot
  try {
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Os testes locais falharam. Deploy abortado para protecao do ambiente.' }
  } finally {
    Pop-Location
  }
}

$environment = Read-DotEnv $resolvedEnvironmentPath
$required = @('RELAY_AGENT_TOKEN')
foreach ($name in $required) {
  if (-not $environment[$name]) { throw "Variavel ausente no .env: $name" }
}

$usingPostgres = [bool]$environment['DATABASE_URL']
if (-not $usingPostgres) {
  foreach ($name in @('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY')) {
    if (-not $environment[$name]) { throw "Variavel ausente no .env de transicao: $name" }
  }
  $supabaseUri = $null
  if (-not [Uri]::TryCreate($environment['SUPABASE_URL'], [UriKind]::Absolute, [ref]$supabaseUri)) {
    throw 'SUPABASE_URL invalida no arquivo de ambiente.'
  }
  $actualSupabaseProjectRef = $supabaseUri.Host.Split('.')[0]
  if ($ExpectedSupabaseProjectRef -and $actualSupabaseProjectRef -ne $ExpectedSupabaseProjectRef) {
    throw "Deploy abortado: o arquivo '$resolvedEnvironmentPath' aponta para o Supabase '$actualSupabaseProjectRef', mas este ambiente exige '$ExpectedSupabaseProjectRef'."
  }
  Write-Host "==> Supabase de transicao confirmado: $actualSupabaseProjectRef ($resolvedEnvironmentPath)"
} else {
  Write-Host "==> PostgreSQL local selecionado por DATABASE_URL ($resolvedEnvironmentPath)"
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $tokenBytes = [Text.Encoding]::UTF8.GetBytes($environment['RELAY_AGENT_TOKEN'])
  $relayTokenHash = ([BitConverter]::ToString($sha256.ComputeHash($tokenBytes)) -replace '-', '').ToLowerInvariant()
} finally {
  $sha256.Dispose()
}

$relayValues = [ordered]@{
  HOST = '127.0.0.1'
  PORT = '10000'
  SITE_DIR = '/opt/fecart/current/site'
  RELAY_AGENT_TOKEN_SHA256 = $relayTokenHash
  TRUST_PROXY = 'true'
  RATE_LIMIT_GLOBAL_MAX = '1200'
  ANTIGRAVITY_ENABLED = 'false'
}
if ($usingPostgres) {
  $relayValues['DATABASE_URL'] = $environment['DATABASE_URL']
} else {
  $relayValues['SUPABASE_URL'] = $environment['SUPABASE_URL']
  $relayValues['SUPABASE_PUBLISHABLE_KEY'] = $environment['SUPABASE_PUBLISHABLE_KEY']
}
$hostValues = [ordered]@{
  RELAY_URL = 'ws://127.0.0.1:10000/tunnel'
  RELAY_AGENT_TOKEN = $environment['RELAY_AGENT_TOKEN']
  RELAY_HOST_ID = 'aws-lightsail-main'
  CODEX_BIN = '/usr/bin/codex'
  APP_SERVER_PORT = '4500'
  CODEX_HOME = '/var/lib/fecart-host/primary-codex'
  REMOTE_CODEX_STATE_DIR = '/var/lib/fecart-host'
  CODEX_ACCOUNT_REGISTRY = '/var/lib/fecart-host/accounts.json'
  CODEX_ACCOUNTS_DIR = '/var/lib/fecart-host/accounts'
  CODEX_APP_SERVER_TOKEN_FILE = '/var/lib/fecart-host/app-server-tokens/primary.token'
  HOST_SKIP_PRIMARY_ACCOUNT = '1'
  CODEX_SSH_AUTHORIZED_KEYS_FILE = '/var/lib/fecart-host/.ssh/authorized_keys'
  CODEX_SSH_SESSION_COMMAND = '/usr/bin/node /opt/fecart/current/dist/src/ssh-session.js'
  CODEX_SSH_PUBLIC_HOST = $PublicHost
  CODEX_SSH_PUBLIC_PORT = '22'
  CODEX_SSH_PUBLIC_USER = 'fecart-host'
  CODEX_SSH_WORKSPACE_ROOT = '/var/lib/fecart-host/workspaces'
  ACCOUNT_REFRESH_INTERVAL_MS = '60000'
  ACCESS_SYNC_INTERVAL_MS = '1000'
  RELAY_HEARTBEAT_INTERVAL_MS = '5000'
  ANTIGRAVITY_ENABLED = 'false'
}
if ($usingPostgres) {
  $hostValues['DATABASE_URL'] = $environment['DATABASE_URL']
} else {
  $hostValues['SUPABASE_URL'] = $environment['SUPABASE_URL']
  $hostValues['SUPABASE_SECRET_KEY'] = $environment['SUPABASE_SECRET_KEY']
}

$relayEnv = ($relayValues.GetEnumerator() | ForEach-Object { "$($_.Key)=$(Quote-SystemdValue ([string]$_.Value))" }) -join "`n"
$hostEnv = ($hostValues.GetEnumerator() | ForEach-Object { "$($_.Key)=$(Quote-SystemdValue ([string]$_.Value))" }) -join "`n"
$relayEnvBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($relayEnv + "`n"))
$hostEnvBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($hostEnv + "`n"))

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("fecart-aws-" + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
$archivePath = Join-Path $temporaryDirectory 'fecart-app.tar.gz'

try {
  $gitCommit = (& git rev-parse --short HEAD 2>$null)
  if (-not $gitCommit) { $gitCommit = 'release' }
  $releaseId = "$(Get-Date -Format 'yyyyMMddHHmmss')-$gitCommit"

  Write-Host "==> Empacotando release $releaseId sem .env, Git ou dependencias locais..."
  & tar -czf $archivePath `
    --exclude='.git' `
    --exclude='.env' `
    --exclude='node_modules' `
    --exclude='dist' `
    --exclude='site' `
    --exclude='backups' `
    --exclude='*.log' `
    -C $projectRoot .
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o projeto.' }

  $destination = "${RemoteUser}@${IpAddress}"
  Write-Host "==> Enviando pacote para $destination..."
  & scp -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $archivePath "${destination}:/tmp/fecart-app.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar o pacote.' }

  if ($Bootstrap) {
    Write-Host '==> Modo Bootstrap: Provisionando servidor, pacotes de sistema e configuracao inicial...'
    $bootstrapContent = [IO.File]::ReadAllText((Join-Path $projectRoot 'deploy/aws/bootstrap.sh')).Replace("`r`n", "`n")
    $remoteBootstrap = Join-Path $temporaryDirectory 'fecart-bootstrap.sh'
    [IO.File]::WriteAllBytes($remoteBootstrap, [Text.Encoding]::UTF8.GetBytes($bootstrapContent))

    & scp -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $remoteBootstrap "${destination}:/tmp/fecart-bootstrap.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar o bootstrap.' }

    & ssh -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $destination "sed -i 's/\r$//' /tmp/fecart-bootstrap.sh && sudo bash /tmp/fecart-bootstrap.sh '$PublicHost'"
    if ($LASTEXITCODE -ne 0) { throw 'Falha no bootstrap remoto.' }
  } else {
    Write-Host '==> Modo Rotina: Executando publicacao versionada com rollback automatico...'
    $routineContent = [IO.File]::ReadAllText((Join-Path $projectRoot 'deploy/aws/routine-deploy.sh')).Replace("`r`n", "`n")
    $remoteRoutine = Join-Path $temporaryDirectory 'fecart-routine-deploy.sh'
    [IO.File]::WriteAllBytes($remoteRoutine, [Text.Encoding]::UTF8.GetBytes($routineContent))

    & scp -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $remoteRoutine "${destination}:/tmp/fecart-routine-deploy.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar script de deploy de rotina.' }

    & ssh -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $destination "sed -i 's/\r$//' /tmp/fecart-routine-deploy.sh && sudo bash /tmp/fecart-routine-deploy.sh '$PublicHost' '$releaseId'"
    if ($LASTEXITCODE -ne 0) { throw 'Falha no deploy remoto.' }
  }

  Write-Host '==> Transmitindo variaveis de ambiente protegidas...'
  ($relayEnvBase64 + "`n" + $hostEnvBase64 + "`n") | & ssh -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $destination 'sudo /usr/local/sbin/fecart-install-env'
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar variaveis de ambiente remotas.' }

  Write-Host '==> Verificando integridade final dos servicos...'
  & ssh -i $resolvedKeyPath -o StrictHostKeyChecking=accept-new $destination "curl -fsS http://127.0.0.1:10000/healthz && echo && systemctl is-active fecart-relay fecart-host caddy"
  if ($LASTEXITCODE -ne 0) { throw 'A verificacao final de integridade falhou.' }

  Write-Host ''
  Write-Host "=========================================================="
  Write-Host "   DEPLOY FINALIZADO COM SUCESSO: Release $releaseId"
  Write-Host "   Public URL : https://$PublicHost"
  Write-Host "   Painel Adm : https://$PublicHost/admin"
  Write-Host "=========================================================="
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
