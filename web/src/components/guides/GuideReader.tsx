import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SupportedOS } from "../active-session/OSSelector";
import {
  buildActivationCommand,
  buildRestoreCommand,
  CODEX_APP_URL,
  CODEX_CLI_URL,
  configTomlForEndpoint,
  getGuideEnvironment,
  GUIDE_OS_OPTIONS,
  manualRestoreInstructions,
  type GuideId,
  type GuideOsOption,
} from "./guideConfig";

export interface GuideReaderProps {
  guide: GuideId;
  onBack: () => void;
}

interface CopyButtonProps {
  copied: boolean;
  onClick: () => void;
  label?: string;
}

function CopyButton({ copied, onClick, label = "Copiar" }: CopyButtonProps) {
  return (
    <button type="button" className="btn btn-secondary guide-copy-button" onClick={onClick}>
      <i className={"ph " + (copied ? "ph-check" : "ph-copy")} aria-hidden="true" />
      <span>{copied ? "Copiado" : label}</span>
    </button>
  );
}

interface StepHeadingProps {
  number: string;
  title: string;
  description: string;
  id: string;
}

function StepHeading({ number, title, description, id }: StepHeadingProps) {
  return (
    <div className="guide-step-heading">
      <span className="guide-step-number" aria-hidden="true">{number}</span>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

interface SystemSelectorProps {
  selectedOS: SupportedOS;
  onSelectOS: (os: SupportedOS) => void;
}

function SystemSelector({ selectedOS, onSelectOS }: SystemSelectorProps) {
  return (
    <div className="guide-system-selector">
      <div className="guide-section-label">Seu sistema</div>
      <div className="guide-system-options" role="tablist" aria-label="Sistema operacional">
        {GUIDE_OS_OPTIONS.map((option) => {
          const selected = option.id === selectedOS;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={"guide-system-option" + (selected ? " is-selected" : "")}
              onClick={() => onSelectOS(option.id)}
            >
              <i className={"ph " + option.icon} aria-hidden="true" />
              <span>{option.name}</span>
              {selected && <i className="ph ph-check-circle guide-system-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CommandCardProps {
  title: string;
  description: string;
  terminalName: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
  tone?: "primary" | "neutral";
}

function CommandCard({
  title,
  description,
  terminalName,
  command,
  copied,
  onCopy,
  tone = "primary",
}: CommandCardProps) {
  return (
    <div className={"guide-command-card guide-command-card-" + tone}>
      <div className="guide-command-header">
        <div>
          <div className="guide-command-title">
            <i className="ph ph-terminal-window" aria-hidden="true" />
            <strong>{title}</strong>
          </div>
          <p>{description}</p>
        </div>
        <CopyButton copied={copied} onClick={onCopy} label="Copiar comando" />
      </div>
      <div className="guide-terminal-label">
        <i className="ph ph-terminal" aria-hidden="true" />
        <span>Executar no {terminalName}</span>
      </div>
      <pre className="guide-command-code"><code>{command}</code></pre>
    </div>
  );
}

interface DownloadLinksProps {
  compact?: boolean;
}

function DownloadLinks({ compact = false }: DownloadLinksProps) {
  return (
    <section className={"guide-downloads" + (compact ? " guide-downloads-compact" : "")} aria-labelledby="guide-downloads-title">
      <div className="guide-section-label">Ferramentas</div>
      <div className="guide-download-heading">
        <div>
          <h2 id="guide-downloads-title">Ainda não tem o Codex?</h2>
          <p>Instale a ferramenta que você vai usar para acessar o FECART.</p>
        </div>
      </div>
      <div className="guide-download-grid">
        <a className="guide-download-card" href={CODEX_CLI_URL} target="_blank" rel="noopener noreferrer">
          <span className="guide-download-icon guide-download-icon-blue">
            <i className="ph ph-terminal-window" aria-hidden="true" />
          </span>
          <span className="guide-download-copy">
            <strong>Codex CLI</strong>
            <small>Instalar para usar no terminal</small>
          </span>
          <i className="ph ph-arrow-square-out" aria-hidden="true" />
        </a>
        <a className="guide-download-card" href={CODEX_APP_URL} target="_blank" rel="noopener noreferrer">
          <span className="guide-download-icon guide-download-icon-green">
            <i className="ph ph-app-window" aria-hidden="true" />
          </span>
          <span className="guide-download-copy">
            <strong>Codex App</strong>
            <small>Baixar o app desktop oficial</small>
          </span>
          <i className="ph ph-arrow-square-out" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

interface ConfigPreviewProps {
  config: string;
  copied: boolean;
  onCopy: () => void;
}

function ConfigPreview({ config, copied, onCopy }: ConfigPreviewProps) {
  return (
    <div className="guide-config-preview">
      <div className="guide-config-header">
        <div>
          <span className="guide-section-label">Conteúdo do arquivo</span>
          <strong>config.toml</strong>
        </div>
        <CopyButton copied={copied} onClick={onCopy} label="Copiar TOML" />
      </div>
      <pre className="guide-code-block"><code>{config}</code></pre>
    </div>
  );
}

function PathCard({ option }: { option: GuideOsOption }) {
  return (
    <div className="guide-path-grid">
      <div className="guide-path-card">
        <span>Arquivo de configuração</span>
        <code>{option.location}</code>
      </div>
      <div className="guide-path-card">
        <span>Backup original</span>
        <code>{option.backupLocation}</code>
      </div>
    </div>
  );
}

export function GuideReader({ guide, onBack }: GuideReaderProps) {
  const [selectedOS, setSelectedOS] = useState<SupportedOS>("powershell");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const environment = useMemo(
    () => getGuideEnvironment(typeof window === "undefined" ? "http://localhost" : window.location.origin),
    [],
  );
  const selectedOption = GUIDE_OS_OPTIONS.find((option) => option.id === selectedOS) || GUIDE_OS_OPTIONS[0];
  const config = useMemo(() => configTomlForEndpoint(environment.endpoint), [environment.endpoint]);
  const activationCommand = useMemo(
    () => buildActivationCommand(selectedOS, environment.endpoint),
    [environment.endpoint, selectedOS],
  );
  const restoreCommand = useMemo(() => buildRestoreCommand(selectedOS), [selectedOS]);
  const restoreInstructions = manualRestoreInstructions(selectedOS);

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onBack();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  async function copyText(text: string, key: string) {
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
    }

    if (copied) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 2000);
    }
  }

  const isQuickGuide = guide === "quick";
  const title = isQuickGuide ? "Guia rápido" : "Manual passo a passo";
  const subtitle = isQuickGuide
    ? "Esta é a configuração inicial: ela prepara o Codex para se conectar ao FECART pelo terminal, sem apagar sua configuração original."
    : "Este é o mesmo processo, explicado passo a passo para você configurar o arquivo com segurança.";

  return (
    <div className="guide-reader" aria-labelledby="guide-reader-title">
      <header className="guide-reader-header">
        <div className="guide-reader-header-inner">
          <button ref={backButtonRef} type="button" className="btn btn-ghost guide-back-button" onClick={onBack}>
            <i className="ph ph-arrow-left" aria-hidden="true" />
            <span>Voltar para guias</span>
          </button>
          <div className="guide-reader-heading">
            <span className="kicker-tag">{isQuickGuide ? "CONFIGURAÇÃO RÁPIDA" : "CONFIGURAÇÃO MANUAL"}</span>
            <h1 id="guide-reader-title">{title}</h1>
          </div>
          <div className={"guide-environment-badge guide-environment-" + environment.label}>
            <i className="ph ph-globe-hemisphere-west" aria-hidden="true" />
            <span>{environment.labelText}</span>
          </div>
        </div>
      </header>

      <div className="guide-reader-body">
        <div className="guide-reader-intro">
          <p>{subtitle}</p>
          <code>{environment.endpoint}</code>
        </div>

        <SystemSelector selectedOS={selectedOS} onSelectOS={setSelectedOS} />

        {isQuickGuide ? (
          <>
            <DownloadLinks compact />

            <section className="guide-reader-section" aria-labelledby="quick-activate-title">
              <StepHeading
                number="1"
                id="quick-activate-title"
                title="Ative a configuração"
                description={selectedOption.runInstruction}
              />
              <CommandCard
                title="Ativar FECART"
                description="Este é o passo que conecta o Codex ao FECART: cria a pasta, preserva seu backup e grava a configuração correta sem salvar seu token no arquivo."
                terminalName={selectedOption.terminalName}
                command={activationCommand}
                copied={copiedKey === "activate"}
                onCopy={() => copyText(activationCommand, "activate")}
              />
            </section>

            <section className="guide-reader-section" aria-labelledby="quick-restore-title">
              <StepHeading
                number="2"
                id="quick-restore-title"
                title="Restaurar ou desinstalar"
                description="Se quiser desfazer o setup, use este comando para recuperar seu arquivo original com segurança."
              />
              <CommandCard
                title="Restaurar configuração"
                description="Recupera config.toml.bak. Sem backup, remove somente um config.toml identificado como criado pelo FECART."
                terminalName={selectedOption.terminalName}
                command={restoreCommand}
                copied={copiedKey === "restore"}
                onCopy={() => copyText(restoreCommand, "restore")}
                tone="neutral"
              />
              <div className="guide-note guide-note-warning">
                <i className="ph ph-info" aria-hidden="true" />
                <p>Depois, feche e abra novamente o Codex App. No CLI, abra uma nova sessão para carregar a conexão.</p>
              </div>
            </section>
          </>
        ) : (
          <>
            <DownloadLinks />

            <section className="guide-reader-section" aria-labelledby="manual-location-title">
              <StepHeading
                number="1"
                id="manual-location-title"
                title="Localize o arquivo"
                description={"Primeiro, localize o arquivo que guarda a conexão do Codex. No " + selectedOption.terminalName + ", use o caminho abaixo."}
              />
              <PathCard option={selectedOption} />
              <div className="guide-note">
                <i className="ph ph-shield-check" aria-hidden="true" />
                <p>Se o arquivo já existir, copie-o na mesma pasta e renomeie a cópia para <code>config.toml.bak</code>. Assim, você poderá voltar atrás.</p>
              </div>
            </section>

            <section className="guide-reader-section" aria-labelledby="manual-edit-title">
              <StepHeading
                number="2"
                id="manual-edit-title"
                title="Edite o config.toml"
                description="Substitua o conteúdo pelo modelo abaixo. Ele aponta o Codex para o FECART sem gravar seu token no arquivo."
              />
              <ConfigPreview
                config={config}
                copied={copiedKey === "toml"}
                onCopy={() => copyText(config, "toml")}
              />
            </section>

            <section className="guide-reader-section" aria-labelledby="manual-save-title">
              <StepHeading
                number="3"
                id="manual-save-title"
                title="Salve e reinicie"
                description="Salve como config.toml, sem adicionar .txt ao final. Depois, reinicie o Codex para carregar a conexão com o FECART."
              />
              <div className="guide-finish-grid">
                <div className="guide-finish-card">
                  <i className="ph ph-check-circle" aria-hidden="true" />
                  <div>
                    <strong>Codex CLI</strong>
                    <p>Abra uma nova sessão do Codex no terminal.</p>
                  </div>
                </div>
                <div className="guide-finish-card">
                  <i className="ph ph-app-window" aria-hidden="true" />
                  <div>
                    <strong>Codex App</strong>
                    <p>Feche o aplicativo completamente e abra-o de novo.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="guide-reader-section" aria-labelledby="manual-restore-title">
              <StepHeading
                number="4"
                id="manual-restore-title"
                title="Desinstale quando quiser"
                description={"Para desfazer essa configuração, " + restoreInstructions.charAt(0).toLowerCase() + restoreInstructions.slice(1)}
              />
              <div className="guide-note guide-note-warning">
                <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" />
                <p>Com o backup no lugar, a configuração pessoal anterior volta a funcionar normalmente.</p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
