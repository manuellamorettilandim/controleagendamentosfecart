[CmdletBinding()]
param(
  [string]$TailscalePath = "",
  [string]$LocalHost = "127.0.0.1",
  [ValidateRange(1, 65535)]
  [int]$LocalPort = 10000,
  [ValidateRange(5, 300)]
  [int]$StartupTimeoutSeconds = 90,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$managedProcesses = New-Object System.Collections.Generic.List[object]
$logDirectory = Join-Path $env:TEMP "fecart-local-tunnel"
$logSuffix = "{0}-{1}" -f $PID, (Get-Date -Format "yyyyMMdd-HHmmss")
$localOutputPath = Join-Path $logDirectory "local-$logSuffix.out.log"
$localErrorPath = Join-Path $logDirectory "local-$logSuffix.err.log"
$tailscaleOutputPath = Join-Path $logDirectory "tailscale-$logSuffix.out.log"
$tailscaleErrorPath = Join-Path $logDirectory "tailscale-$logSuffix.err.log"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Resolve-Executable {
  param(
    [string]$RequestedPath,
    [string]$CommandName,
    [string[]]$FallbackPaths
  )

  if ($RequestedPath) {
    if (Test-Path -LiteralPath $RequestedPath -PathType Leaf) {
      return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $requestedCommand = Get-Command $RequestedPath -ErrorAction SilentlyContinue
    if ($requestedCommand) {
      return $requestedCommand.Path
    }

    throw "Executavel nao encontrado: $RequestedPath"
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Path
  }

  foreach ($fallbackPath in $FallbackPaths) {
    if (Test-Path -LiteralPath $fallbackPath -PathType Leaf) {
      return $fallbackPath
    }
  }

  throw "$CommandName nao foi encontrado. Informe o caminho com -TailscalePath."
}

function Test-LocalRelay {
  try {
    $response = Invoke-WebRequest -Uri "http://${LocalHost}:${LocalPort}/healthz" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-ManagedProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string]$Arguments,
    [string]$StandardOutputPath,
    [string]$StandardErrorPath
  )

  $process = Start-Process -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $StandardOutputPath `
    -RedirectStandardError $StandardErrorPath `
    -WindowStyle Hidden `
    -PassThru
  $managedProcesses.Add([pscustomobject]@{ Name = $Name; Process = $process })
  return $process
}

function Invoke-Tailscale {
  param([string[]]$Arguments)

  $output = @(& $tailscale @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $details = ($output | ForEach-Object { [string]$_ }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($details)) {
      $details = "sem detalhes adicionais"
    }
    throw "Tailscale falhou: $details"
  }
  return $output
}

function Start-TailscaleFunnel {
  Write-Host "[tailscale] Habilite/aprove o Funnel se o Tailscale solicitar no navegador."
  Write-Host "[tailscale] Aguardando a configuracao terminar por ate $StartupTimeoutSeconds segundos..."

  $process = Start-Process -FilePath $tailscale `
    -ArgumentList "funnel --bg --yes $LocalPort" `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $tailscaleOutputPath `
    -RedirectStandardError $tailscaleErrorPath `
    -WindowStyle Hidden `
    -PassThru
  $managedProcesses.Add([pscustomobject]@{ Name = "tailscale"; Process = $process })

  $approvalOpened = $false
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $tailscaleText = ((@($tailscaleOutputPath, $tailscaleErrorPath) |
        Where-Object { Test-Path -LiteralPath $_ } |
        ForEach-Object { Get-Content -LiteralPath $_ -Raw -ErrorAction SilentlyContinue } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n")
    $approvalMatch = [regex]::Match($tailscaleText, "https://login\.tailscale\.com/f/funnel\?node=[^\s]+", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($approvalMatch.Success -and -not $approvalOpened) {
      $approvalOpened = $true
      Write-Host "[tailscale] Aprovacao necessaria. Abrindo: $($approvalMatch.Value)"
      Start-Process -FilePath $approvalMatch.Value | Out-Null
    }

    if ($process.HasExited) {
      if ($process.ExitCode -ne 0) {
        # Algumas versoes do Tailscale exibem "Funnel started" e deixam a
        # configuracao ativa, mas ainda retornam um exit code diferente de
        # zero. Nesse caso, o estado real do Funnel e a fonte de verdade.
        try {
          $configuredUrl = Get-FunnelUrl
          if ($configuredUrl) {
            Write-Host "[tailscale] Funnel ativo em $configuredUrl."
            return
          }
        } catch {
          # Sem uma URL ativa, trataremos o encerramento como falha abaixo.
        }

        throw "O Tailscale recusou a configuracao do Funnel. Conclua a aprovacao no navegador e tente novamente."
      }
      return
    }
    Start-Sleep -Milliseconds 250
  }

  Stop-ManagedProcess -Process $process
  if ($approvalOpened) {
    throw "A aprovacao do Funnel nao foi concluida dentro do prazo. Conclua-a no navegador e execute o startup novamente."
  }
  throw "O Tailscale ficou aguardando aprovacao. Execute o startup novamente e conclua a aprovacao quando ela aparecer."
}

function Get-FunnelUrl {
  $statusOutput = @(Invoke-Tailscale -Arguments @("funnel", "status"))
  $statusText = ($statusOutput | ForEach-Object { [string]$_ }) -join "`n"
  $match = [regex]::Match($statusText, "https://[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $match.Success) {
    throw "O Tailscale Funnel nao informou uma URL publica. Saida do status:`n$statusText"
  }
  return $match.Value.TrimEnd("/")
}

function Show-LogTail {
  param([string[]]$LogPaths)

  foreach ($logPath in $LogPaths) {
    if (-not (Test-Path -LiteralPath $logPath)) {
      continue
    }

    Write-Host "--- $logPath ---"
    Get-Content -LiteralPath $logPath -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object {
      Write-Host $_
    }
  }
}

function Stop-ManagedProcess {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return
  }

  try {
    if ($Process.HasExited) {
      return
    }

    $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
    if (Test-Path -LiteralPath $taskkill) {
      & $taskkill /PID $Process.Id /T /F 2>$null | Out-Null
    } else {
      $Process.Kill()
    }
  } catch {
    # O processo pode ter encerrado entre a verificacao e o encerramento.
  }
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  throw "npm.cmd nao foi encontrado no PATH."
}

$tailscale = Resolve-Executable -RequestedPath $TailscalePath -CommandName "tailscale" -FallbackPaths @(
  (Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"),
  (Join-Path $env:ProgramFiles "Tailscale IPN\tailscale.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Tailscale\tailscale.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Tailscale IPN\tailscale.exe")
)

$localProcess = $null

try {
  if (Test-LocalRelay) {
    Write-Host "[local] Relay ja esta respondendo em http://${LocalHost}:${LocalPort}. Vou reutiliza-lo."
  } else {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      throw "A porta $LocalPort ja esta ocupada, mas nao parece ser o relay local."
    }

    $npmArguments = '/d /s /c ""{0}" run local"' -f $npmCommand.Path
    $localProcess = Start-ManagedProcess `
      -Name "local" `
      -FilePath $env:ComSpec `
      -Arguments $npmArguments `
      -StandardOutputPath $localOutputPath `
      -StandardErrorPath $localErrorPath
    Write-Host "[local] Aguardando o relay ficar disponivel..."

    $localDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $localDeadline) {
      if ($localProcess.HasExited) {
        throw "npm run local encerrou antes de iniciar o relay."
      }
      if (Test-LocalRelay) {
        break
      }
      Start-Sleep -Milliseconds 500
    }

    if (-not (Test-LocalRelay)) {
      throw "O relay nao respondeu em http://${LocalHost}:${LocalPort} dentro do tempo esperado."
    }
  }

  Write-Host "[tailscale] Configurando Funnel na porta $LocalPort..."
  Start-TailscaleFunnel

  $publicUrl = $null
  $urlDeadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $urlDeadline -and -not $publicUrl) {
    try {
      $publicUrl = Get-FunnelUrl
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $publicUrl) {
    throw "O Funnel foi configurado, mas o Tailscale ainda nao informou uma URL publica. Rode 'tailscale funnel status' para conferir."
  }
  $siteUrl = "$publicUrl/login"
  Write-Host ""
  Write-Host "Pronto."
  Write-Host "URL publica: $publicUrl"
  Write-Host "Site:        $siteUrl"
  Write-Host ""
  Write-Host "O dashboard vai montar o comando usando essa URL (wss://)."
  Write-Host ('Modelo: $env:CODEX_REMOTE_TOKEN = "TOKEN_DA_SESSAO"; codex --remote {0} --remote-auth-token-env CODEX_REMOTE_TOKEN' -f $publicUrl.Replace("https://", "wss://"))

  if (-not $NoBrowser) {
    Start-Process -FilePath $siteUrl | Out-Null
    Write-Host "O site foi aberto no navegador."
  }

  Write-Host ""
  Write-Host "Mantenha esta janela aberta. Pressione Ctrl+C para encerrar o local."
  Write-Host "O Funnel permanece configurado no Tailscale; use 'tailscale funnel off' para desativa-lo."
  while ($true) {
    if ($localProcess -and $localProcess.HasExited) {
      throw "npm run local encerrou."
    }
    Start-Sleep -Seconds 1
  }
} catch {
  Write-Host ""
  Write-Host "Falha no startup: $($_.Exception.Message)" -ForegroundColor Red
  Show-LogTail -LogPaths @($localOutputPath, $localErrorPath, $tailscaleOutputPath, $tailscaleErrorPath)
  throw
} finally {
  for ($index = $managedProcesses.Count - 1; $index -ge 0; $index -= 1) {
    Stop-ManagedProcess -Process $managedProcesses[$index].Process
  }
  foreach ($logPath in @($localOutputPath, $localErrorPath, $tailscaleOutputPath, $tailscaleErrorPath)) {
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  }
}
