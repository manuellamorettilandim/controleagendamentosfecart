import React, { useState } from "react";
import { SupportedOS } from "./OSSelector";
import { CodexPlatform } from "./PlatformSelector";

export interface CommandBlockProps {
  os: SupportedOS;
  platform: CodexPlatform;
  token?: string | null;
  reservationId?: string | null;
  onOpenQuickGuide: () => void;
}

export function CommandBlock({ os, platform, token, reservationId, onOpenQuickGuide }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);
  const [isTokenVisible, setIsTokenVisible] = useState(false);

  // Generate appropriate command per OS
  const hasToken = Boolean(token);
  const hiddenToken = "••••••••••••••••••••••••••••••••";
  const tokenForCommand = token || "";
  const tokenForDisplay = token && isTokenVisible ? token : hiddenToken;

  let osName = "Windows PowerShell";
  let osIcon = "ph-windows-logo";
  let commandCode = "";

  if (os === "powershell") {
    osName = "Windows PowerShell";
    osIcon = "ph-windows-logo";
    commandCode = platform === "app"
      ? `$env:FECART_CODEX_TOKEN = "${tokenForCommand}"; Start-Process "explorer.exe" "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"`
      : `$env:FECART_CODEX_TOKEN = "${tokenForCommand}"; codex`;
  } else if (os === "cmd") {
    osName = "Windows CMD";
    osIcon = "ph-windows-logo";
    commandCode = platform === "app"
      ? `setx FECART_CODEX_TOKEN "${tokenForCommand}" && start explorer.exe "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"`
      : `set "FECART_CODEX_TOKEN=${tokenForCommand}" && codex`;
  } else if (os === "macos") {
    osName = "macOS Terminal";
    osIcon = "ph-apple-logo";
    commandCode = platform === "app"
      ? `FECART_CODEX_TOKEN="${tokenForCommand}" open -a "ChatGPT"`
      : `export FECART_CODEX_TOKEN="${tokenForCommand}" && codex`;
  } else {
    osName = "Linux Terminal";
    osIcon = "ph-linux-logo";
    commandCode = platform === "app"
      ? `FECART_CODEX_TOKEN="${tokenForCommand}" chatgpt`
      : `export FECART_CODEX_TOKEN="${tokenForCommand}" && codex`;
  }

  if (!hasToken) {
    commandCode = "A credencial desta sessão ainda não está disponível. Atualize os dados para tentar novamente.";
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(commandCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)" }}>
            3. Copie o comando de acesso
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {hasToken ? `Cole no ${osName} selecionado e pressione Enter.` : "A credencial desta sessão ainda está sendo liberada."}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenQuickGuide}
          className="btn btn-ghost"
          style={{ padding: "4px 8px", fontSize: "12px", color: "var(--color-brand-primary)" }}
        >
          <i className="ph ph-question" aria-hidden="true" />
          <span>Ver guia rápido</span>
          <i className="ph ph-arrow-right" style={{ fontSize: "12px" }} aria-hidden="true" />
        </button>
      </div>

      {/* Terminal Block */}
      <div
        className="terminal-command-container"
        style={{
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          border: "1px solid var(--border-card)",
          backgroundColor: "#0d1117",
          boxShadow: "var(--shadow-md)",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            backgroundColor: "#161b22",
            borderBottom: "1px solid #30363d",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#c9d1d9", fontSize: "13px", fontWeight: "600" }}>
            <i className={`ph ${osIcon}`} aria-hidden="true" />
            <span>{osName}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-icon-only"
              onClick={() => setIsTokenVisible((visible) => !visible)}
              disabled={!hasToken}
              aria-label={isTokenVisible ? "Ocultar token" : "Mostrar token"}
              aria-pressed={isTokenVisible}
              title={isTokenVisible ? "Ocultar token" : "Mostrar token"}
              style={{ color: "#c9d1d9", borderColor: "#30363d", backgroundColor: "#21262d" }}
            >
              <i className={`ph ${isTokenVisible ? "ph-eye-slash" : "ph-eye"}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
              disabled={!hasToken}
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: copied ? "var(--color-success)" : "var(--color-brand-primary)",
                transition: "all var(--transition-fast)",
              }}
            >
              <i className={`ph ${copied ? "ph-check" : "ph-copy"}`} aria-hidden="true" />
              <span>{copied ? "Copiado!" : "Copiar comando"}</span>
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div style={{ padding: "16px", overflowX: "auto" }}>
          <pre
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              lineHeight: "1.6",
              color: "#58a6ff",
              margin: 0,
              whiteSpace: "pre",
            }}
          >
            <code>{hasToken ? commandCode.replace(tokenForCommand, tokenForDisplay) : commandCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
