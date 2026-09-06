import type { SupportedOS } from "../active-session/OSSelector";

export type GuideId = "quick" | "manual";

export interface GuideEnvironment {
  origin: string;
  endpoint: string;
  label: "local" | "online";
  labelText: string;
}

export interface GuideOsOption {
  id: SupportedOS;
  name: string;
  terminalName: string;
  icon: string;
  location: string;
  backupLocation: string;
  runInstruction: string;
}

export const CODEX_CLI_URL = "https://learn.chatgpt.com/docs/codex/cli";
export const CODEX_APP_URL = "https://learn.chatgpt.com/docs/app";

export const GUIDE_OS_OPTIONS: GuideOsOption[] = [
  {
    id: "powershell",
    name: "Windows PowerShell",
    terminalName: "PowerShell ou Windows Terminal",
    icon: "ph-windows-logo",
    location: "%USERPROFILE%\\.codex\\config.toml",
    backupLocation: "%USERPROFILE%\\.codex\\config.toml.bak",
    runInstruction: "Abra o PowerShell ou o Windows Terminal e cole o comando abaixo.",
  },
  {
    id: "cmd",
    name: "Windows CMD",
    terminalName: "Prompt de Comando",
    icon: "ph-windows-logo",
    location: "%USERPROFILE%\\.codex\\config.toml",
    backupLocation: "%USERPROFILE%\\.codex\\config.toml.bak",
    runInstruction: "Abra o Prompt de Comando. O comando usa o PowerShell instalado no Windows.",
  },
  {
    id: "macos",
    name: "macOS",
    terminalName: "Terminal (zsh ou bash)",
    icon: "ph-apple-logo",
    location: "~/.codex/config.toml",
    backupLocation: "~/.codex/config.toml.bak",
    runInstruction: "Abra o Terminal do macOS e cole o comando abaixo.",
  },
  {
    id: "linux",
    name: "Linux",
    terminalName: "Terminal (bash ou zsh)",
    icon: "ph-linux-logo",
    location: "~/.codex/config.toml",
    backupLocation: "~/.codex/config.toml.bak",
    runInstruction: "Abra o Terminal da sua distribuição e cole o comando abaixo.",
  },
];

const CONFIG_MARKER = "# FECART_MANAGED_CONFIG";

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function getGuideEnvironment(origin: string): GuideEnvironment {
  const normalizedOrigin = normalizeOrigin(origin);
  let hostname = "";

  try {
    hostname = new URL(normalizedOrigin).hostname;
  } catch {
    // Keep the origin usable when an embedded host provides a non-standard URL.
  }

  const local = isLocalHostname(hostname);
  return {
    origin: normalizedOrigin,
    endpoint: normalizedOrigin + "/api/codex/v1",
    label: local ? "local" : "online",
    labelText: local ? "Ambiente local" : "Ambiente online",
  };
}

export function configTomlForEndpoint(endpoint: string): string {
  return [
    CONFIG_MARKER,
    "# Este arquivo pode ser restaurado por meio do Guia rápido do FECART.",
    "model = \"gpt-5.6-sol\"",
    "model_provider = \"fecart\"",
    "web_search = \"live\"",
    "",
    "[features]",
    "standalone_web_search = true",
    "",
    "[model_providers.fecart]",
    "name = \"FECART Codex\"",
    "base_url = \"" + endpoint + "\"",
    "env_key = \"FECART_CODEX_TOKEN\"",
    "wire_api = \"responses\"",
    "supports_websockets = false",
    "supports_standalone_web_search = true",
  ].join("\n");
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function powershellActivationCommand(endpoint: string): string {
  const config = configTomlForEndpoint(endpoint);
  return [
    "$dir=\"$HOME\\.codex\"; $cfg=\"$dir\\config.toml\"; $bak=\"$dir\\config.toml.bak\"; ",
    "New-Item -ItemType Directory -Force $dir | Out-Null; ",
    "if (Test-Path $cfg) { ",
    "if (-not (Test-Path $bak)) { Copy-Item $cfg $bak -Force; Write-Host \"Backup criado em $bak\" -ForegroundColor Yellow } ",
    "else { Write-Host \"Backup existente preservado em $bak\" -ForegroundColor Yellow } ",
    "} else { Write-Host \"Nenhum config.toml anterior encontrado.\" -ForegroundColor Gray }; ",
    "@'\n",
    config,
    "\n'@ | Set-Content -Path $cfg -Encoding UTF8; ",
    "Write-Host \"Configuração FECART aplicada em $cfg\" -ForegroundColor Green",
  ].join("");
}

function cmdActivationCommand(endpoint: string): string {
  const encodedConfig = base64Utf8(configTomlForEndpoint(endpoint));
  return [
    "REM Endpoint usado: " + endpoint + "\n",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"",
    "$dir=Join-Path $HOME '.codex';",
    "$cfg=Join-Path $dir 'config.toml';",
    "$bak=Join-Path $dir 'config.toml.bak';",
    "New-Item -ItemType Directory -Force $dir | Out-Null;",
    "if((Test-Path $cfg)-and -not(Test-Path $bak)){Copy-Item $cfg $bak -Force;Write-Host 'Backup criado em' $bak -ForegroundColor Yellow}",
    "elseif(Test-Path $bak){Write-Host 'Backup existente preservado em' $bak -ForegroundColor Yellow};",
    "[IO.File]::WriteAllText($cfg,[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('",
    encodedConfig,
    "')));",
    "Write-Host 'Configuração FECART aplicada em' $cfg -ForegroundColor Green\"",
  ].join("");
}

function posixActivationCommand(endpoint: string): string {
  const config = configTomlForEndpoint(endpoint);
  return [
    "mkdir -p \"$HOME/.codex\"\n",
    "cfg=\"$HOME/.codex/config.toml\"\n",
    "bak=\"$HOME/.codex/config.toml.bak\"\n",
    "if [ -f \"$cfg\" ]; then\n",
    "  if [ ! -f \"$bak\" ]; then\n",
    "    cp \"$cfg\" \"$bak\"\n",
    "    echo \"Backup criado em $bak\"\n",
    "  else\n",
    "    echo \"Backup existente preservado em $bak\"\n",
    "  fi\n",
    "else\n",
    "  echo \"Nenhum config.toml anterior encontrado.\"\n",
    "fi\n",
    "cat > \"$cfg\" <<'FECART_CONFIG'\n",
    config,
    "\nFECART_CONFIG\n",
    "echo \"Configuração FECART aplicada em $cfg\"",
  ].join("");
}

function powershellRestoreCommand(): string {
  return [
    "$dir=\"$HOME\\.codex\"; $cfg=\"$dir\\config.toml\"; $bak=\"$dir\\config.toml.bak\"; ",
    "if (Test-Path $bak) { Move-Item $bak $cfg -Force; Write-Host \"Backup restaurado de $bak\" -ForegroundColor Green } ",
    "elseif ((Test-Path $cfg) -and ((Get-Content $cfg -Raw) -match [regex]::Escape(\"",
    CONFIG_MARKER,
    "\"))) { Remove-Item $cfg -Force; Write-Host \"Configuração FECART removida de $cfg\" -ForegroundColor Green } ",
    "else { Write-Host \"Nenhum backup FECART encontrado; nenhum arquivo foi removido.\" -ForegroundColor Yellow }",
  ].join("");
}

function cmdRestoreCommand(): string {
  return [
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"",
    "$dir=Join-Path $HOME '.codex';",
    "$cfg=Join-Path $dir 'config.toml';",
    "$bak=Join-Path $dir 'config.toml.bak';",
    "if(Test-Path $bak){Move-Item $bak $cfg -Force;Write-Host 'Backup restaurado de' $bak -ForegroundColor Green}",
    "elseif((Test-Path $cfg)-and((Get-Content $cfg -Raw)-match 'FECART_MANAGED_CONFIG')){Remove-Item $cfg -Force;Write-Host 'Configuração FECART removida de' $cfg -ForegroundColor Green}",
    "else{Write-Host 'Nenhum backup FECART encontrado; nenhum arquivo foi removido.' -ForegroundColor Yellow}\"",
  ].join("");
}

function posixRestoreCommand(): string {
  return [
    "cfg=\"$HOME/.codex/config.toml\"\n",
    "bak=\"$HOME/.codex/config.toml.bak\"\n",
    "if [ -f \"$bak\" ]; then\n",
    "  mv \"$bak\" \"$cfg\"\n",
    "  echo \"Backup restaurado de $bak\"\n",
    "elif [ -f \"$cfg\" ] && grep -q \"^",
    CONFIG_MARKER,
    "$\" \"$cfg\"; then\n",
    "  rm \"$cfg\"\n",
    "  echo \"Configuração FECART removida de $cfg\"\n",
    "else\n",
    "  echo \"Nenhum backup FECART encontrado; nenhum arquivo foi removido.\"\n",
    "fi",
  ].join("");
}

export function buildActivationCommand(os: SupportedOS, endpoint: string): string {
  if (os === "powershell") return powershellActivationCommand(endpoint);
  if (os === "cmd") return cmdActivationCommand(endpoint);
  return posixActivationCommand(endpoint);
}

export function buildRestoreCommand(os: SupportedOS): string {
  if (os === "powershell") return powershellRestoreCommand();
  if (os === "cmd") return cmdRestoreCommand();
  return posixRestoreCommand();
}

export function manualRestoreInstructions(os: SupportedOS): string {
  if (os === "powershell" || os === "cmd") {
    return "Feche o Codex, apague o config.toml gerenciado e renomeie config.toml.bak para config.toml.";
  }
  return "Feche o Codex, remova o config.toml gerenciado e renomeie config.toml.bak para config.toml.";
}

export function markerForTesting(): string {
  return CONFIG_MARKER;
}
