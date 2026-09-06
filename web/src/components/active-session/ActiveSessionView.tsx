import React, { useState } from "react";
import { SetupGuideBanner } from "./SetupGuideBanner";
import { OSSelector, SupportedOS } from "./OSSelector";
import { PlatformSelector, CodexPlatform } from "./PlatformSelector";
import { CommandBlock } from "./CommandBlock";
import { SessionUsage } from "./SessionUsage";
import { ModelUsageTable, SessionModelUsage } from "./ModelUsageTable";

export interface ActiveSessionViewProps {
  onBackToOverview: () => void;
  onOpenGuides: () => void;
  isActiveSession: boolean;
  isLoading?: boolean;
  errorMessage?: string | null;
  token?: string | null;
  reservationId?: string | null;
  accountLabel?: string;
  startTimeFormatted?: string;
  endTimeFormatted?: string;
  durationLabel?: string;
  remainingTimeFormatted?: string;
  timePercentage?: number;
  quotaRemainingPercent?: number | null;
  modelsCount?: number;
  totalTokensFormatted?: string;
  commandsCount?: number;
  statusLabel?: string;
  modelsUsed?: SessionModelUsage[];
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export function ActiveSessionView({
  onBackToOverview,
  onOpenGuides,
  isActiveSession,
  isLoading = false,
  errorMessage = null,
  token,
  reservationId,
  accountLabel,
  startTimeFormatted = "—",
  endTimeFormatted = "—",
  durationLabel = "—",
  remainingTimeFormatted = "—",
  timePercentage = 0,
  quotaRemainingPercent = null,
  modelsCount = 0,
  totalTokensFormatted = "0",
  commandsCount = 0,
  statusLabel = "Aguardando conexão",
  modelsUsed = [],
  onRefresh,
  isRefreshing = false,
}: ActiveSessionViewProps) {
  const [selectedOS, setSelectedOS] = useState<SupportedOS>("powershell");
  const [selectedPlatform, setSelectedPlatform] = useState<CodexPlatform>("cli");

  if (!isActiveSession) {
    return (
      <div className="active-session-empty" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onBackToOverview}
              style={{ padding: 0, color: "var(--text-brand)", fontSize: "13px" }}
            >
              Visão geral
            </button>
            <i className="ph ph-caret-right" style={{ fontSize: "12px" }} aria-hidden="true" />
            <span style={{ color: "var(--text-primary)" }}>Sessão ativa</span>
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Sessão ativa
          </h1>
        </div>

        <div className="ui-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <i
            className={`ph ${isLoading ? "ph-circle-notch icon-spinning" : "ph-plug"}`}
            style={{ fontSize: "42px", color: "var(--color-brand-primary)", marginBottom: "16px" }}
            aria-hidden="true"
          />
          <h2 style={{ fontSize: "20px", fontWeight: "750", color: "var(--text-primary)", marginBottom: "8px" }}>
            {isLoading ? "Carregando dados da sessão…" : "Nenhuma sessão ativa agora"}
          </h2>
          <p style={{ maxWidth: "520px", margin: "0 auto 20px", color: "var(--text-muted)", fontSize: "14px" }}>
            {errorMessage
              ? "Não foi possível consultar os dados reais agora. Atualize para tentar novamente."
              : isLoading
              ? "Estamos consultando a sua reserva e os dados capturados pelo servidor."
              : "Quando houver uma reserva em andamento, os dados reais de conexão e uso aparecerão aqui."}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
            {errorMessage && (
              <button type="button" className="btn btn-primary" onClick={onRefresh}>
                <i className="ph ph-arrows-clockwise" aria-hidden="true" />
                <span>Atualizar dados</span>
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onBackToOverview}>
              <i className="ph ph-arrow-left" aria-hidden="true" />
              <span>Voltar para a visão geral</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusIsPositive = statusLabel === "Conectada" || statusLabel === "Em andamento";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Breadcrumb & Heading */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onBackToOverview}
            style={{ padding: 0, cursor: "pointer", color: "var(--text-brand)", fontSize: "13px" }}
          >
            Visão geral
          </button>
          <i className="ph ph-caret-right" style={{ fontSize: "12px" }} aria-hidden="true" />
          <span style={{ color: "var(--text-primary)" }}>Sessão ativa</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Sessão ativa
          </h1>
          <span className={`badge ${statusIsPositive ? "badge-success" : "badge-warning"}`} style={{ fontSize: "12px", padding: "4px 12px" }}>
            <span className="badge-dot" />
            {statusLabel}
          </span>
        </div>
        {accountLabel && (
          <p style={{ marginTop: "8px", fontSize: "13px", color: "var(--text-muted)" }}>
            Conta conectada: <strong style={{ color: "var(--text-secondary)" }}>{accountLabel}</strong>
          </p>
        )}
      </div>

      {/* Required Configuration Banner */}
      <SetupGuideBanner onOpenGuide={onOpenGuides} />

      {/* 4 Step Indicators */}
      <div
        className="ui-card"
        style={{
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        {/* Step 1 */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "var(--color-brand-primary)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "700",
              fontSize: "14px",
            }}
          >
            1
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
              Escolha o sistema
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Selecione o sistema
            </div>
          </div>
        </div>

        <i className="ph ph-caret-right" style={{ color: "var(--text-muted)", fontSize: "18px" }} aria-hidden="true" />

        {/* Step 2 */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.15)",
              color: "var(--color-brand-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "700",
              fontSize: "14px",
            }}
          >
            2
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
              Escolha a plataforma
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Codex CLI ou App
            </div>
          </div>
        </div>

        <i className="ph ph-caret-right" style={{ color: "var(--text-muted)", fontSize: "18px" }} aria-hidden="true" />

        {/* Step 3 */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.15)",
              color: "var(--color-brand-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "700",
              fontSize: "14px",
            }}
          >
            3
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
              Copie o comando
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Clique para copiar
            </div>
          </div>
        </div>

        <i className="ph ph-caret-right" style={{ color: "var(--text-muted)", fontSize: "18px" }} aria-hidden="true" />

        {/* Step 4 */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(var(--color-brand-primary-rgb), 0.15)",
              color: "var(--color-brand-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "700",
              fontSize: "14px",
            }}
          >
            4
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)" }}>
              Execute o comando
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Cole e pressione Enter
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Steps & Right Usage */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: "24px",
          alignItems: "start",
        }}
        className="active-session-grid"
      >
        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <OSSelector selectedOS={selectedOS} onSelectOS={setSelectedOS} />
          <PlatformSelector selectedPlatform={selectedPlatform} onSelectPlatform={setSelectedPlatform} />
          <CommandBlock
            os={selectedOS}
            platform={selectedPlatform}
            token={token}
            reservationId={reservationId}
            onOpenQuickGuide={onOpenGuides}
          />
        </div>

        {/* Right Column */}
        <div>
          <SessionUsage
            remainingTimeFormatted={remainingTimeFormatted}
            timePercentage={timePercentage}
            quotaRemainingPercent={quotaRemainingPercent}
            startTimeFormatted={startTimeFormatted}
            endTimeFormatted={endTimeFormatted}
            durationLabel={durationLabel}
            modelsCount={modelsCount}
            totalTokensFormatted={totalTokensFormatted}
            commandsCount={commandsCount}
            statusLabel={statusLabel}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
          />
        </div>
      </div>

      {/* Models Used Table */}
      <ModelUsageTable models={modelsUsed} />
    </div>
  );
}
