[CmdletBinding()]
param(
  [string]$DatabaseUrl = $env:SUPABASE_DB_URL,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../backups/supabase-migration')
)

$ErrorActionPreference = 'Stop'

if (-not $DatabaseUrl) {
  throw 'Defina SUPABASE_DB_URL com a connection string PostgreSQL do Supabase.'
}

foreach ($command in @('pg_dump', 'pg_restore', 'psql')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatório não encontrado: $command"
  }
}

$resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($resolvedOutputDirectory) | Out-Null

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$baseName = "supabase-preservation-$timestamp"
$temporaryDump = Join-Path $resolvedOutputDirectory "$baseName.dump.partial"
$dumpPath = Join-Path $resolvedOutputDirectory "$baseName.dump"
$checksumPath = "$dumpPath.sha256"
$inventoryPath = Join-Path $resolvedOutputDirectory "$baseName.inventory.csv"

$previousDatabase = $env:PGDATABASE
$env:PGDATABASE = $DatabaseUrl

try {
  & pg_dump `
    --format=custom `
    --compress=6 `
    --no-owner `
    --no-acl `
    --schema=public `
    --schema=auth `
    --schema=codex_private `
    --schema=supabase_migrations `
    --file=$temporaryDump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou; nenhum backup foi publicado.' }

  & pg_restore --list $temporaryDump | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore não conseguiu validar o dump.' }

  $inventorySql = @'
copy (
  select schemaname || '.' || relname as object,
         n_live_tup::bigint as estimated_rows
  from pg_stat_user_tables
  where schemaname in ('public', 'auth', 'codex_private')
  order by schemaname, relname
) to stdout with csv header;
'@
  $inventorySql | & psql --no-psqlrc --set ON_ERROR_STOP=1 | Set-Content -LiteralPath $inventoryPath -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o inventário; o dump não será publicado.' }

  Move-Item -LiteralPath $temporaryDump -Destination $dumpPath
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpPath).Hash.ToLowerInvariant()
  "$hash  $([IO.Path]::GetFileName($dumpPath))" | Set-Content -LiteralPath $checksumPath -Encoding ascii

  Write-Host "Dump validado: $dumpPath"
  Write-Host "Checksum: $checksumPath"
  Write-Host "Inventário: $inventoryPath"
  Write-Warning 'Copie estes três arquivos para armazenamento fora desta máquina antes de continuar.'
} finally {
  if (Test-Path -LiteralPath $temporaryDump) {
    Remove-Item -LiteralPath $temporaryDump -Force
  }
  $env:PGDATABASE = $previousDatabase
}
