// Exportadores de Relatório de Telemetria e Utilização (PDF, XLSX, CSV)
// Suporte a múltiplas abas no Excel, proteção contra formula injection e geração de PDF executivo completo multi-páginas.

import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import type { UsageReportData } from "./report-aggregator.js";

function formatDateDisplay(iso: string, timeZone = "America/Sao_Paulo"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(iso: string, timeZone = "America/Sao_Paulo"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatCompactTokens(tokens: number): string {
  if (tokens === 0 || !Number.isFinite(tokens)) return "0";
  const abs = Math.abs(tokens);
  if (abs >= 1_000_000_000) {
    const val = (tokens / 1_000_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return `${val} B`;
  }
  if (abs >= 1_000_000) {
    const val = (tokens / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return `${val} M`;
  }
  if (abs >= 1_000) {
    const val = (tokens / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${val} k`;
  }
  return tokens.toLocaleString("pt-BR");
}

export function sanitizeFormula(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function buildReportFilename(fromIso: string, toIso: string, extension: "pdf" | "xlsx" | "csv", timeZone = "America/Sao_Paulo"): string {
  const fromStr = formatDateOnly(fromIso, timeZone);
  const toStr = formatDateOnly(toIso, timeZone);
  const genStr = formatDateOnly(new Date().toISOString(), timeZone);
  return `relatorio-fecart_${fromStr}_a_${toStr}_gerado_${genStr}.${extension}`;
}

export async function exportReportToPdf(report: UsageReportData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 36,
        bufferPages: true,
        info: {
          Title: "Fecart AI Share - Relatório Operacional de Utilização",
          Author: "Fecart AI Share",
          CreationDate: new Date(report.generatedAt),
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => {
        const result = Buffer.concat(chunks);
        if (result.length < 100 || !result.subarray(0, 5).toString().startsWith("%PDF-")) {
          reject(new Error("Falha na validação do PDF gerado."));
          return;
        }
        resolve(result);
      });
      doc.on("error", (err) => reject(err));

      const pageWidth = 595.28 - 72; // Largura útil A4 com margem 36 (523.28pt)
      const startX = 36;

      // ========================================================================
      // PÁGINA 1: RESUMO EXECUTIVO, DESTAQUES E RECONCILIAÇÃO AUDITÁVEL
      // ========================================================================
      doc.rect(startX, 36, pageWidth, 4).fill("#2563eb");

      // Cabeçalho Principal
      doc.fontSize(15).font("Helvetica-Bold").fillColor("#0f172a").text("FECART AI SHARE — RELATÓRIO OPERACIONAL", startX, 48);
      doc.fontSize(8.5).font("Helvetica").fillColor("#475569").text("Consolidação auditável de contas, cotas semanais, sessões, horas, tokens e modelos", startX, 66);

      // Metadados do Relatório
      doc.fontSize(7.5).font("Helvetica").fillColor("#64748b").text(
        `Período Avaliado: ${formatDateDisplay(report.period.from, report.period.timeZone)} até ${formatDateDisplay(report.period.to, report.period.timeZone)}   |   Fuso: ${report.period.timeZone}   |   Emissão: ${formatDateDisplay(report.generatedAt, report.period.timeZone)}`,
        startX,
        80,
      );

      doc.rect(startX, 94, pageWidth, 1).fill("#cbd5e1");

      // 1. Panorama Geral do Período (4 Cards em Destaque)
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text("1. Panorama geral do período", startX, 104);

      const cardWidth = (pageWidth - 18) / 4;
      const cardY = 120;
      const cardHeight = 52;

      const drawCard = (x: number, title: string, mainVal: string, subVal: string, barColor: string): void => {
        doc.rect(x, cardY, cardWidth, cardHeight).fillAndStroke("#f8fafc", "#e2e8f0");
        doc.rect(x, cardY, cardWidth, 3).fill(barColor);
        doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#475569").text(title.toUpperCase(), x + 6, cardY + 7, { width: cardWidth - 12, lineBreak: false });
        doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text(mainVal, x + 6, cardY + 18, { width: cardWidth - 12, lineBreak: false });
        doc.fontSize(6.5).font("Helvetica").fillColor("#64748b").text(subVal, x + 6, cardY + 34, { width: cardWidth - 12, lineBreak: false });
      };

      drawCard(startX, "Cota Semanal Usada", `${report.summary.totalWeeklyQuotaUsedPercent} p.p.`, `${report.summary.completedQuotaWindows + report.summary.openQuotaWindows} janelas observadas`, "#2563eb");
      drawCard(startX + cardWidth + 6, "Desperdício nos Resets", `${report.summary.totalWeeklyQuotaWastedPercent} p.p.`, `Saldo aberto: ${report.summary.totalWeeklyQuotaRemainingPercent}%`, "#dc2626");
      drawCard(startX + (cardWidth + 6) * 2, "Horas Reservadas/Reais", `${report.summary.totalReservedHours}h`, `Conectado: ${report.summary.totalConnectedHours}h | Proc: ${report.summary.totalProcessingHours}h`, "#059669");
      drawCard(startX + (cardWidth + 6) * 3, "Tokens Totais Auditados", formatCompactTokens(report.summary.grandTotalTokens), `${formatCompactTokens(report.summary.totalAttributedTokens)} atribuídos aos grupos`, "#7c3aed");

      // 2. Destaques Operacionais
      let currentY = 180;
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text("2. Destaques operacionais da plataforma", startX, currentY);
      currentY += 15;

      const hlWidth = (pageWidth - 6) / 2;
      const hlHeight = 38;

      const drawHlCard = (x: number, y: number, label: string, title: string, subtitle: string): void => {
        doc.rect(x, y, hlWidth, hlHeight).fillAndStroke("#ffffff", "#e2e8f0");
        doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#2563eb").text(label.toUpperCase(), x + 8, y + 5, { lineBreak: false });
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#0f172a").text(title, x + 8, y + 15, { width: hlWidth - 16, lineBreak: false });
        doc.fontSize(6.8).font("Helvetica").fillColor("#64748b").text(subtitle, x + 8, y + 26, { width: hlWidth - 16, lineBreak: false });
      };

      const topConsumerText = report.highlights.topConsumer ? `${report.highlights.topConsumer.groupName.slice(0, 30)}` : "Sem consumo registrado";
      const topConsumerSub = report.highlights.topConsumer ? `${formatCompactTokens(report.highlights.topConsumer.totalTokens)} tokens (${report.highlights.topConsumer.sharePercent}% do volume total atribuído)` : "—";
      drawHlCard(startX, currentY, "Maior Consumo de Tokens", topConsumerText, topConsumerSub);

      const topCacheText = report.highlights.topCacheSaver ? `${report.highlights.topCacheSaver.groupName.slice(0, 30)}` : "Sem reaproveitamento de cache";
      const topCacheSub = report.highlights.topCacheSaver ? `${formatCompactTokens(report.highlights.topCacheSaver.cachedTokens)} tokens em cache (${report.highlights.topCacheSaver.efficiencyPercent}% de eficiência)` : "—";
      drawHlCard(startX + hlWidth + 6, currentY, "Maior Eficiência de Cache", topCacheText, topCacheSub);

      currentY += hlHeight + 6;

      const topActiveText = report.highlights.topActive ? `${report.highlights.topActive.groupName.slice(0, 30)}` : "Sem atividades aprovadas";
      const topActiveSub = report.highlights.topActive ? `${report.highlights.topActive.hours}h reservadas em ${report.highlights.topActive.sessions} sessões ativadas` : "—";
      drawHlCard(startX, currentY, "Maior Carga Horária", topActiveText, topActiveSub);

      const peakText = `Pico de ${report.highlights.peakConcurrentSessions} sessões simultâneas`;
      const peakSub = `Faixa com maior demanda de agendamento: ${report.highlights.busiestHourWindow || "Distribuído"}`;
      drawHlCard(startX + hlWidth + 6, currentY, "Simultaneidade e Demanda", peakText, peakSub);

      currentY += hlHeight + 12;

      // 3. Reconciliação Auditável de Tokens e Qualidade dos Dados
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text("3. Reconciliação auditável e cobertura de dados", startX, currentY);
      currentY += 15;

      doc.rect(startX, currentY, pageWidth, 54).fillAndStroke("#f1f5f9", "#cbd5e1");
      doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#0f172a").text(
        `Equação de Reconciliação: ${formatCompactTokens(report.summary.totalAttributedTokens)} (Atribuídos aos grupos) + ${formatCompactTokens(report.summary.totalUnattributedTokens)} (Não atribuídos) = ${formatCompactTokens(report.summary.grandTotalTokens)} tokens auditados`,
        startX + 8,
        currentY + 7,
        { lineBreak: false },
      );
      doc.fontSize(7).font("Helvetica").fillColor("#334155").text(
        `• Composição dos tokens atribuídos: ${formatCompactTokens(report.summary.totalInputTokens)} entrada (prompt) | ${formatCompactTokens(report.summary.totalCachedInputTokens)} cache lido (${report.highlights.overallCacheEfficiencyPercent}% economia) | ${formatCompactTokens(report.summary.totalOutputTokens)} saída (completion) | ${formatCompactTokens(report.summary.totalReasoningTokens)} raciocínio (thinking).`,
        startX + 8,
        currentY + 19,
        { width: pageWidth - 16, lineBreak: false },
      );
      doc.fontSize(7).font("Helvetica").fillColor("#334155").text(
        `• Cobertura de telemetria: ${report.dataQuality.modelAttributionCoveragePercent}% dos tokens com modelo rastreado | ${report.dataQuality.sessionCoveragePercent}% das sessões com snapshot validado.`,
        startX + 8,
        currentY + 30,
        { width: pageWidth - 16, lineBreak: false },
      );
      doc.fontSize(7).font("Helvetica").fillColor("#334155").text(
        `• Integridade de infraestrutura: Conexão do host central ativa (${report.dataQuality.hostConnected ? "OK" : "Pendente"}) | Snapshots obsoletos: ${report.dataQuality.staleSnapshotsCount} | Amostras de cota: ${report.dataQuality.quotaSamplesCount}.`,
        startX + 8,
        currentY + 41,
        { width: pageWidth - 16, lineBreak: false },
      );

      currentY += 64;

      // 4. Critérios Metodológicos de Leitura
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f172a").text("4. Critérios metodológicos de leitura", startX, currentY);
      currentY += 15;

      doc.fontSize(7).font("Helvetica").fillColor("#475569");
      doc.text(`• Consumo médio por equipe participante: ${formatCompactTokens(report.highlights.averageTokensPerGroup)} tokens.`, startX, currentY, { width: pageWidth, lineBreak: false });
      currentY += 12;
      doc.text(`• Intensidade de uso por hora aprovada: ${report.summary.totalApprovedHours > 0 ? `${formatCompactTokens(report.highlights.averageTokensPerHour)} tokens/h` : "não calculável"}.`, startX, currentY, { width: pageWidth, lineBreak: false });
      currentY += 12;
      doc.text(`• Horas consolidadas: ${report.summary.totalReservedHours}h reservadas | ${report.summary.totalConnectedHours}h conectadas | ${report.summary.totalProcessingHours}h em processamento (${report.summary.processingEfficiencyPercent}% de eficiência).`, startX, currentY, { width: pageWidth, lineBreak: false });
      currentY += 12;
      doc.text(`• Taxa de presença: ${report.summary.totalSessionsApproved > 0 ? `${Math.round((report.summary.totalSessionsActivated / report.summary.totalSessionsApproved) * 100)}% confirmadas` : "sem sessões aprovadas"} (${report.summary.totalNoShowSessions} no-show).`, startX, currentY, { width: pageWidth, lineBreak: false });
      currentY += 12;

      // ========================================================================
      // PÁGINA 2: CLASSIFICAÇÃO OFICIAL POR GRUPO E MODELOS GLOBAIS
      // ========================================================================
      doc.addPage();
      currentY = 40;

      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("5. Ranking geral de utilização por grupo", startX, currentY);
      doc.fontSize(8).font("Helvetica").fillColor("#64748b").text("Ordenação oficial por tokens totais, acompanhada das 3 métricas de horas e cotas atribuídas.", startX, currentY + 15);
      currentY += 28;

      // Colunas rebalanceadas com largura generosa para Grupo (155pt) e Login (60pt)
      const colWidths = [18, 155, 60, 28, 54, 38, 34, 34, 32, 34, 36];
      const headers = ["Pos.", "Grupo Escolar", "Login", "Sess.", "Horas R/C/P", "Tokens", "Entrada", "Cache", "Saída", "Thinking", "Cota†"];

      const drawGroupHeader = (): void => {
        doc.rect(startX, currentY, pageWidth, 17).fill("#1e293b");
        doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#ffffff");
        let curX = startX;
        headers.forEach((h, i) => {
          doc.text(h, curX + 2, currentY + 4.5, { width: colWidths[i] - 4, align: i <= 2 ? "left" : "right" });
          curX += colWidths[i];
        });
        currentY += 17;
      };

      drawGroupHeader();

      doc.font("Helvetica").fontSize(6.8);
      report.groups.forEach((g, idx) => {
        if (currentY > 730) {
          doc.addPage();
          currentY = 40;
          drawGroupHeader();
          doc.font("Helvetica").fontSize(6.8);
        }

        const isEven = idx % 2 === 0;
        if (isEven) doc.rect(startX, currentY, pageWidth, 14).fill("#f8fafc");

        let curX = startX;
        const rowData = [
          `${g.rank}º`,
          g.groupName.slice(0, 36),
          g.username.slice(0, 14),
          `${g.sessionsActivated}/${g.sessionsApproved}`,
          `${g.reservedHours}/${g.connectedHours}/${g.processingHours}h`,
          formatCompactTokens(g.totalTokens),
          formatCompactTokens(g.inputTokens),
          formatCompactTokens(g.cachedInputTokens),
          formatCompactTokens(g.outputTokens),
          formatCompactTokens(g.reasoningTokens),
          `${g.weeklyQuotaUsedPercent.toLocaleString("pt-BR")}%`,
        ];

        doc.fillColor("#0f172a");
        rowData.forEach((val, i) => {
          doc.text(val, curX + 2, currentY + 3.5, { width: colWidths[i] - 4, align: i <= 2 ? "left" : "right" });
          curX += colWidths[i];
        });

        currentY += 14;
      });

      // Linha de Totais da Tabela
      doc.rect(startX, currentY, pageWidth, 15).fill("#f1f5f9");
      doc.font("Helvetica-Bold").fontSize(6.8).fillColor("#0f172a");
      let curX = startX;
      const totalRow = [
        "",
        `TOTAL (${report.summary.activeGroups} equipes)`,
        "—",
        `${report.summary.totalSessionsActivated}/${report.summary.totalSessionsApproved}`,
        `${report.summary.totalReservedHours}/${report.summary.totalConnectedHours}/${report.summary.totalProcessingHours}h`,
        formatCompactTokens(report.summary.totalAttributedTokens),
        formatCompactTokens(report.summary.totalInputTokens),
        formatCompactTokens(report.summary.totalCachedInputTokens),
        formatCompactTokens(report.summary.totalOutputTokens),
        formatCompactTokens(report.summary.totalReasoningTokens),
        `${report.summary.totalWeeklyQuotaUsedPercent.toLocaleString("pt-BR")}%`,
      ];
      totalRow.forEach((val, i) => {
        doc.text(val, curX + 2, currentY + 3.5, { width: colWidths[i] - 4, align: i <= 2 ? "left" : "right" });
        curX += colWidths[i];
      });

      currentY += 18;
      doc.fontSize(6.5).font("Helvetica-Oblique").fillColor("#64748b").text(
        "R/C/P = Horas reservadas / Horas conectadas / Horas em processamento ativo. † Cota atribuída às sessões.",
        startX,
        currentY,
        { width: pageWidth, lineBreak: false },
      );

      currentY += 22;

      // 6. Distribuição Geral Observada por Modelo de IA - Fluxo Contínuo na Página 2
      if (currentY > 580) {
        doc.addPage();
        currentY = 40;
      }

      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("6. Distribuição geral observada por modelo de IA", startX, currentY);
      doc.fontSize(8).font("Helvetica").fillColor("#64748b").text("Discriminação detalhada do volume global de tokens e turnos processados por modelo de inteligência artificial.", startX, currentY + 15);
      currentY += 28;

      const modelColWidths = [125, 48, 65, 70, 70, 70, 75];
      const modelHeaders = ["Modelo de IA", "Turnos", "Tokens Totais", "Entrada (Prompt)", "Cache Lido", "Saída (Completion)", "Thinking"];

      doc.rect(startX, currentY, pageWidth, 17).fill("#1e293b");
      doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#ffffff");
      let mX = startX;
      modelHeaders.forEach((header, index) => {
        doc.text(header, mX + 2, currentY + 4.5, { width: modelColWidths[index] - 4, align: index === 0 ? "left" : "right" });
        mX += modelColWidths[index];
      });
      currentY += 17;

      doc.font("Helvetica").fontSize(6.8);
      report.models.forEach((model, index) => {
        if (currentY > 730) {
          doc.addPage();
          currentY = 40;
          doc.rect(startX, currentY, pageWidth, 17).fill("#1e293b");
          doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#ffffff");
          let mmX = startX;
          modelHeaders.forEach((h, i) => {
            doc.text(h, mmX + 2, currentY + 4.5, { width: modelColWidths[i] - 4, align: i === 0 ? "left" : "right" });
            mmX += modelColWidths[i];
          });
          currentY += 17;
          doc.font("Helvetica").fontSize(6.8);
        }

        if (index % 2 === 0) doc.rect(startX, currentY, pageWidth, 14).fill("#f8fafc");
        const values = [
          model.modelId,
          model.turns.toLocaleString("pt-BR"),
          formatCompactTokens(model.totalTokens),
          formatCompactTokens(model.inputTokens),
          formatCompactTokens(model.cachedInputTokens),
          formatCompactTokens(model.outputTokens),
          formatCompactTokens(model.reasoningTokens),
        ];
        doc.fillColor("#0f172a");
        mX = startX;
        values.forEach((value, valueIndex) => {
          doc.text(value, mX + 2, currentY + 3.5, { width: modelColWidths[valueIndex] - 4, align: valueIndex === 0 ? "left" : "right" });
          mX += modelColWidths[valueIndex];
        });
        currentY += 14;
      });

      // ========================================================================
      // PÁGINA 3: DETALHAMENTO OPERACIONAL POR CONTA (POOL CENTRAL)
      // ========================================================================
      doc.addPage();
      currentY = 40;

      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("7. Detalhamento operacional por conta (Pool Central)", startX, currentY);
      doc.fontSize(8).font("Helvetica").fillColor("#64748b").text("Análise individual de cada conta do pool central, detalhando modelos de IA processados, cotas e grupos atendidos.", startX, currentY + 15);
      currentY += 28;

      report.accounts.forEach((acc) => {
        if (currentY > 590) {
          doc.addPage();
          currentY = 40;
        }

        // Header Card da Conta (Quadrado Profissional)
        doc.rect(startX, currentY, pageWidth, 26).fillAndStroke("#1e293b", "#0f172a");
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#ffffff").text(
          `${acc.label} (${acc.accountId}) — Status: ${acc.status.toUpperCase()}`,
          startX + 8,
          currentY + 5,
          { width: 330, lineBreak: false },
        );
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#38bdf8").text(
          `${formatCompactTokens(acc.totalTokensServed)} tokens   |   ${acc.totalSessionsServed} sessões`,
          startX + 340,
          currentY + 5,
          { width: pageWidth - 348, align: "right", lineBreak: false },
        );
        doc.fontSize(6.8).font("Helvetica").fillColor("#cbd5e1").text(
          `Horas: ${acc.reservedHours}h reservadas (${acc.connectedHours}h conectadas / ${acc.processingHours}h processando)   |   Cota: ${acc.weeklyQuotaUsedPercent} p.p. usada • ${acc.weeklyQuotaWastedPercent} p.p. perdida (Saldo: ${acc.weeklyQuotaRemainingPercent}%)`,
          startX + 8,
          currentY + 15,
          { width: pageWidth - 16, lineBreak: false },
        );
        currentY += 30;

        // Subtítulo: Modelos processados na conta
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#334155").text(`Modelos de IA processados em ${acc.label}:`, startX + 4, currentY);
        currentY += 10;

        // Tabela de Modelos da Conta
        const accModelWidths = [125, 48, 65, 70, 70, 70, 75];
        doc.rect(startX, currentY, pageWidth, 15).fill("#334155");
        doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#ffffff");
        let aX = startX;
        ["Modelo de IA", "Chamadas (Turnos)", "Total Tokens", "Entrada (Prompt)", "Cache Lido", "Saída", "Thinking"].forEach((h, i) => {
          doc.text(h, aX + 2, currentY + 4, { width: accModelWidths[i] - 4, align: i === 0 ? "left" : "right" });
          aX += accModelWidths[i];
        });
        currentY += 15;

        doc.font("Helvetica").fontSize(6.5);
        if (acc.modelsUsed.length === 0) {
          doc.rect(startX, currentY, pageWidth, 13).fill("#f8fafc");
          doc.fillColor("#64748b").text("Nenhum modelo registrado nesta conta.", startX + 4, currentY + 3.5);
          currentY += 13;
        } else {
          acc.modelsUsed.forEach((m, mIdx) => {
            if (mIdx % 2 === 0) doc.rect(startX, currentY, pageWidth, 13).fill("#f8fafc");
            let amX = startX;
            [
              m.modelId,
              m.turns.toLocaleString("pt-BR"),
              formatCompactTokens(m.totalTokens),
              formatCompactTokens(m.inputTokens),
              formatCompactTokens(m.cachedInputTokens),
              formatCompactTokens(m.outputTokens),
              formatCompactTokens(m.reasoningTokens),
            ].forEach((val, vi) => {
              doc.fillColor("#0f172a").text(val, amX + 2, currentY + 3, { width: accModelWidths[vi] - 4, align: vi === 0 ? "left" : "right" });
              amX += accModelWidths[vi];
            });
            currentY += 13;
          });
        }

        currentY += 6;

        // Subtítulo: Grupos atendidos na conta
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#334155").text(`Grupos escolares atendidos por ${acc.label}:`, startX + 4, currentY);
        currentY += 10;

        // Tabela de Grupos da Conta (Largura ampla para Grupo Escolar)
        const accGrpWidths = [165, 65, 38, 65, 60, 60, 70];
        doc.rect(startX, currentY, pageWidth, 15).fill("#475569");
        doc.fontSize(6.5).font("Helvetica-Bold").fillColor("#ffffff");
        let gX = startX;
        ["Grupo Escolar", "Login", "Sessões", "Total Tokens", "Entrada", "Cache", "Horas C/P"].forEach((h, i) => {
          doc.text(h, gX + 2, currentY + 4, { width: accGrpWidths[i] - 4, align: i <= 1 ? "left" : "right" });
          gX += accGrpWidths[i];
        });
        currentY += 15;

        doc.font("Helvetica").fontSize(6.5);
        if (acc.groupBreakdown.length === 0) {
          doc.rect(startX, currentY, pageWidth, 13).fill("#f8fafc");
          doc.fillColor("#64748b").text("Nenhum grupo escolar atendeu nesta conta.", startX + 4, currentY + 3.5);
          currentY += 13;
        } else {
          acc.groupBreakdown.forEach((grp, gIdx) => {
            if (gIdx % 2 === 0) doc.rect(startX, currentY, pageWidth, 13).fill("#f8fafc");
            let agX = startX;
            [
              grp.groupName.slice(0, 38),
              grp.username.slice(0, 16),
              String(grp.sessions),
              formatCompactTokens(grp.totalTokens),
              formatCompactTokens(grp.inputTokens),
              formatCompactTokens(grp.cachedInputTokens),
              `${grp.connectedHours}/${grp.processingHours}h`,
            ].forEach((val, vi) => {
              doc.fillColor("#0f172a").text(val, agX + 2, currentY + 3, { width: accGrpWidths[vi] - 4, align: vi <= 1 ? "left" : "right" });
              agX += accGrpWidths[vi];
            });
            currentY += 13;
          });
        }

        currentY += 16;
      });

      // ========================================================================
      // PÁGINAS 4 & 5: DETALHAMENTO INDIVIDUAL POR GRUPO ESCOLAR (CARDS QUADRADOS)
      // ========================================================================
      doc.addPage();
      currentY = 40;

      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("8. Detalhamento individual por grupo escolar", startX, currentY);
      doc.fontSize(8).font("Helvetica").fillColor("#64748b").text("Histórico discriminado de cada equipe escolar, indicando contas utilizadas do pool, modelos de IA e consumo individual.", startX, currentY + 15);
      currentY += 28;

      report.groups.forEach((g) => {
        if (currentY + 68 > 740) {
          doc.addPage();
          currentY = 40;
        }

        // Card Retangular Profissional do Grupo
        doc.rect(startX, currentY, pageWidth, 66).fillAndStroke("#ffffff", "#e2e8f0");

        // Header Bar do Grupo (Retangular Sólido)
        doc.rect(startX, currentY, pageWidth, 17).fill("#0f172a");
        doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#38bdf8").text(
          `${g.rank}º  ${g.groupName} (@${g.username})`,
          startX + 6,
          currentY + 4.5,
          { width: 235, lineBreak: false },
        );
        doc.fontSize(7).font("Helvetica-Bold").fillColor("#f1f5f9").text(
          `${formatCompactTokens(g.totalTokens)} tokens (${g.shareOfTotalPercent}%)   •   Cota: ${g.weeklyQuotaUsedPercent}%   •   Cache: ${g.cacheEfficiencyPercent}%`,
          startX + 245,
          currentY + 4.5,
          { width: pageWidth - 251, align: "right", lineBreak: false },
        );

        // Linha 1: Sessões e Horas
        doc.fontSize(6.8).font("Helvetica").fillColor("#334155").text(
          `Sessões: ${g.sessionsActivated}/${g.sessionsApproved} ativadas (${g.noShowCount} no-show)   •   Horas: ${g.reservedHours}h reservadas | ${g.connectedHours}h conectadas | ${g.processingHours}h processando (${g.processingEfficiencyPercent}% eficiência)`,
          startX + 6,
          currentY + 20,
          { width: pageWidth - 12, lineBreak: false },
        );

        // Linha 2: Contas Utilizadas
        const accSummaryText = g.accountBreakdown.length > 0
          ? g.accountBreakdown.map((ab) => `${ab.accountLabel}: ${ab.sessions} sess. (${formatCompactTokens(ab.totalTokens)} tokens | ${ab.reservedHours}h R)`).join("   •   ")
          : "Nenhuma conta utilizada";

        doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#0f172a").text("Contas do Pool:", startX + 6, currentY + 34, { width: 75, lineBreak: false });
        doc.fontSize(6.8).font("Helvetica").fillColor("#475569").text(accSummaryText, startX + 82, currentY + 34, { width: pageWidth - 88, lineBreak: false });

        // Linha 3: Modelos Utilizados
        const modelSummaryText = g.modelsUsed.length > 0
          ? g.modelsUsed.map((m) => `${m.modelId}: ${m.turns} turnos (${formatCompactTokens(m.totalTokens)} tokens | ${formatCompactTokens(m.reasoningTokens)} thinking)`).join("   •   ")
          : "Nenhum modelo utilizado";

        doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#0f172a").text("Modelos de IA:", startX + 6, currentY + 48, { width: 75, lineBreak: false });
        doc.fontSize(6.8).font("Helvetica").fillColor("#475569").text(modelSummaryText, startX + 82, currentY + 48, { width: pageWidth - 88, lineBreak: false });

        currentY += 72;
      });

      // ========================================================================
      // PÁGINA 6 & 7: REGISTRO DETALHADO DE SESSÕES E JANELAS DE COTA
      // ========================================================================
      doc.addPage();
      currentY = 40;

      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("9. Registro detalhado de sessões e agendamentos", startX, currentY);
      doc.fontSize(8).font("Helvetica").fillColor("#64748b").text("Log auditável de todas as sessões no período, registrando durações, status e consumo.", startX, currentY + 15);
      currentY += 28;

      const sColWidths = [155, 70, 84, 38, 42, 44, 44, 46];
      const sHeaders = ["Grupo Escolar", "Login", "Início (Data/Hora)", "Reserv.", "Conect.", "Process.", "Status", "Tokens"];

      const drawSessionHeader = (): void => {
        doc.rect(startX, currentY, pageWidth, 17).fill("#1e293b");
        doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#ffffff");
        let sX = startX;
        sHeaders.forEach((h, i) => {
          doc.text(h, sX + 2, currentY + 4.5, { width: sColWidths[i] - 4, align: i <= 2 ? "left" : i === 6 ? "center" : "right" });
          sX += sColWidths[i];
        });
        currentY += 17;
      };

      drawSessionHeader();
      doc.font("Helvetica").fontSize(6.8);

      report.sessions.forEach((s, idx) => {
        if (currentY > 730) {
          doc.addPage();
          currentY = 40;
          drawSessionHeader();
          doc.font("Helvetica").fontSize(6.8);
        }

        const isEven = idx % 2 === 0;
        if (isEven) doc.rect(startX, currentY, pageWidth, 13.5).fill("#f8fafc");

        let sX = startX;
        const statusLabel = s.approvalStatus === "approved" ? "Aprovado" : s.approvalStatus === "pending" ? "Pendente" : s.approvalStatus === "rejected" ? "Recusado" : s.approvalStatus;

        const sRow = [
          s.groupName.slice(0, 36),
          s.username.slice(0, 16),
          formatDateDisplay(s.startsAt, report.period.timeZone),
          `${s.durationHours}h`,
          `${s.connectedHours}h`,
          `${s.processingHours}h`,
          statusLabel,
          formatCompactTokens(s.observedTokens),
        ];

        doc.fillColor("#0f172a");
        sRow.forEach((val, i) => {
          doc.text(val, sX + 2, currentY + 3, { width: sColWidths[i] - 4, align: i <= 2 ? "left" : i === 6 ? "center" : "right" });
          sX += sColWidths[i];
        });

        currentY += 13.5;
      });

      currentY += 20;

      // 10. Histórico de Janelas Semanais de Cota por Conta - Fluxo Contínuo
      if (currentY > 600) {
        doc.addPage();
        currentY = 40;
      }

      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("10. Histórico de cotas semanais por conta", startX, currentY);
      doc.fontSize(8).font("Helvetica").fillColor("#64748b").text("Cada linha representa uma janela semanal auditada com medição de consumo, desperdício no reset e saldo restante.", startX, currentY + 15);
      currentY += 28;

      const quotaColWidths = [65, 78, 78, 45, 45, 48, 48, 48, 68];
      const quotaHeaders = ["Conta", "Início", "Reset", "Inicial", "Final", "Consumido", "Perdido", "Saldo", "Estado"];

      const drawQuotaHeader = (): void => {
        doc.rect(startX, currentY, pageWidth, 17).fill("#1e293b");
        doc.fontSize(6.8).font("Helvetica-Bold").fillColor("#ffffff");
        let qX = startX;
        quotaHeaders.forEach((header, index) => {
          doc.text(header, qX + 2, currentY + 4.5, { width: quotaColWidths[index] - 4, align: index >= 3 && index <= 7 ? "right" : "left" });
          qX += quotaColWidths[index];
        });
        currentY += 17;
      };

      drawQuotaHeader();
      doc.font("Helvetica").fontSize(6.8);

      report.quotaWindows.forEach((window, index) => {
        if (currentY > 730) {
          doc.addPage();
          currentY = 40;
          drawQuotaHeader();
          doc.font("Helvetica").fontSize(6.8);
        }

        if (index % 2 === 0) doc.rect(startX, currentY, pageWidth, 13.5).fill("#f8fafc");

        const values = [
          window.accountId,
          formatDateDisplay(window.windowStart, report.period.timeZone).slice(0, 16),
          formatDateDisplay(window.windowEnd, report.period.timeZone).slice(0, 16),
          `${window.startingUsedPercent}%`,
          `${window.endingUsedPercent}%`,
          `${window.consumedPercent}%`,
          `${window.wastedPercent}%`,
          `${window.remainingPercent}%`,
          window.completed ? "Encerrada" : "Aberta",
        ];

        doc.fillColor("#0f172a");
        let qX = startX;
        values.forEach((value, valueIndex) => {
          doc.text(value, qX + 2, currentY + 3, { width: quotaColWidths[valueIndex] - 4, align: valueIndex >= 3 && valueIndex <= 7 ? "right" : "left" });
          qX += quotaColWidths[valueIndex];
        });
        currentY += 13.5;
      });

      // Rodapé seguro em todas as páginas bufferizadas (com margem inferior zerada temporariamente para evitar criação indevida de novas páginas)
      const range = doc.bufferedPageRange();
      console.log(`[pdf] Total de páginas geradas no relatório PDF: ${range.count}`);
      const footerY = doc.page.height - 22;
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const prevBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fontSize(7).font("Helvetica").fillColor("#94a3b8").text(
          `Fecart AI Share — Relatório Operacional de Utilização   |   Página ${i + 1} de ${range.count}`,
          startX,
          footerY,
          { align: "center", width: pageWidth, lineBreak: false },
        );
        doc.page.margins.bottom = prevBottom;
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export async function exportReportToXlsx(report: UsageReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Fecart AI Share";
  workbook.created = new Date(report.generatedAt);

  // ABA 1: RESUMO EXECUTIVO
  const wsSummary = workbook.addWorksheet("Resumo Executivo");
  wsSummary.columns = [
    { header: "Indicador Oficial", key: "kpi", width: 42 },
    { header: "Valor Consolidado", key: "value", width: 32 },
    { header: "Unidade / Detalhe Metodológico", key: "unit", width: 44 },
  ];
  wsSummary.getRow(1).font = { bold: true };

  const summaryRows = [
    { kpi: "Período Inicial", value: formatDateDisplay(report.period.from, report.period.timeZone), unit: "Início avaliado" },
    { kpi: "Período Final", value: formatDateDisplay(report.period.to, report.period.timeZone), unit: "Término avaliado" },
    { kpi: "Total de Grupos Cadastrados", value: report.summary.totalGroups, unit: "Grupos" },
    { kpi: "Grupos Ativos no Período", value: report.summary.activeGroups, unit: "Grupos com atividade" },
    { kpi: "Sessões Solicitadas", value: report.summary.totalSessionsRequested, unit: "Sessões" },
    { kpi: "Sessões Aprovadas", value: report.summary.totalSessionsApproved, unit: "Sessões" },
    { kpi: "Sessões Ativadas", value: report.summary.totalSessionsActivated, unit: "Sessões com terminal/stream" },
    { kpi: "Sessões No-Show (Ausências)", value: report.summary.totalNoShowSessions, unit: "Sessões aprovadas não utilizadas" },
    { kpi: "Horas Reservadas", value: report.summary.totalReservedHours, unit: "Horas aprovadas" },
    { kpi: "Horas Conectadas", value: report.summary.totalConnectedHours, unit: "Horas com sessão aberta" },
    { kpi: "Horas em Processamento", value: report.summary.totalProcessingHours, unit: "Horas em turnos ativos" },
    { kpi: "Aproveitamento da Reserva (%)", value: `${report.summary.connectedUtilizationPercent}%`, unit: "Horas conectadas / Reservadas" },
    { kpi: "Eficiência de Processamento (%)", value: `${report.summary.processingEfficiencyPercent}%`, unit: "Horas processando / Conectadas" },
    { kpi: "Tokens Atribuídos aos Grupos", value: report.summary.totalAttributedTokens, unit: "Tokens" },
    { kpi: "Tokens de Entrada (Prompt)", value: report.summary.totalInputTokens, unit: "Tokens" },
    { kpi: "Tokens de Cache Lidos", value: report.summary.totalCachedInputTokens, unit: "Tokens" },
    { kpi: "Tokens de Saída (Completion)", value: report.summary.totalOutputTokens, unit: "Tokens" },
    { kpi: "Tokens de Raciocínio (Thinking)", value: report.summary.totalReasoningTokens, unit: "Tokens" },
    { kpi: "Eficiência Global de Cache", value: `${report.highlights.overallCacheEfficiencyPercent}%`, unit: "% Economia de contexto" },
    { kpi: "Tokens Não Atribuídos (Órfãos)", value: report.summary.totalUnattributedTokens, unit: "Tokens sem sessão identificada" },
    { kpi: "Total Geral Auditado", value: report.summary.grandTotalTokens, unit: "Atribuídos + Não atribuídos" },
    { kpi: "Reconciliação Auditável", value: report.summary.totalAttributedTokens + report.summary.totalUnattributedTokens === report.summary.grandTotalTokens ? "OK (100% Reconciliado)" : "Divergência", unit: "Validação matemática" },
    { kpi: "Cota Semanal Usada Acumulada", value: `${report.summary.totalWeeklyQuotaUsedPercent} p.p.`, unit: "Pontos percentuais somados" },
    { kpi: "Cota Perdida nos Resets", value: `${report.summary.totalWeeklyQuotaWastedPercent} p.p.`, unit: "Pontos percentuais em janelas encerradas" },
    { kpi: "Saldo das Janelas Abertas", value: `${report.summary.totalWeeklyQuotaRemainingPercent}%`, unit: "Saldo ainda disponível (não é desperdício)" },
    { kpi: "Capacidade Semanal Observada", value: `${report.summary.totalQuotaCapacityPercent} p.p.`, unit: `${report.summary.completedQuotaWindows + report.summary.openQuotaWindows} janelas observadas` },
    { kpi: "Aproveitamento da Capacidade", value: `${report.summary.quotaCapacityUtilizationPercent}%`, unit: "% da capacidade observada utilizada" },
    { kpi: "1ª Posição no Ranking de Tokens", value: report.highlights.topConsumer ? report.highlights.topConsumer.groupName : "—", unit: `${report.highlights.topConsumer?.totalTokens.toLocaleString("pt-BR") || 0} tokens` },
    { kpi: "Pico de Simultaneidade Observado", value: `${report.highlights.peakConcurrentSessions} sessões simultâneas`, unit: "Máximo de sobreposição real" },
    { kpi: "Cobertura de Atribuição por Modelo", value: `${report.dataQuality.modelAttributionCoveragePercent}%`, unit: "% tokens com modelo identificado" },
    { kpi: "Cobertura de Sessões", value: `${report.dataQuality.sessionCoveragePercent}%`, unit: "% sessões com telemetria detalhada" },
  ];
  summaryRows.forEach((r) => wsSummary.addRow(r));

  // ABA 2: UTILIZAÇÃO POR GRUPO ESCOLAR (RANKING)
  const wsGroups = workbook.addWorksheet("Classificação por Grupo");
  wsGroups.columns = [
    { header: "Posição", key: "rank", width: 10 },
    { header: "Grupo Escolar", key: "groupName", width: 32 },
    { header: "Usuário/Login", key: "username", width: 20 },
    { header: "Sessões Solicitadas", key: "sessionsRequested", width: 18 },
    { header: "Sessões Aprovadas", key: "sessionsApproved", width: 18 },
    { header: "Sessões Ativadas", key: "sessionsActivated", width: 18 },
    { header: "Ausências (No-Show)", key: "noShowCount", width: 18 },
    { header: "Horas Reservadas (h)", key: "reservedHours", width: 18 },
    { header: "Horas Conectadas (h)", key: "connectedHours", width: 18 },
    { header: "Horas Processando (h)", key: "processingHours", width: 20 },
    { header: "Aproveitamento Conexão (%)", key: "connectedUtilizationPercent", width: 24 },
    { header: "Eficiência Processamento (%)", key: "processingEfficiencyPercent", width: 24 },
    { header: "Total Tokens", key: "totalTokens", width: 18 },
    { header: "Tokens Entrada", key: "inputTokens", width: 16 },
    { header: "Tokens Cache", key: "cachedInputTokens", width: 16 },
    { header: "Tokens Saída", key: "outputTokens", width: 16 },
    { header: "Tokens Thinking", key: "reasoningTokens", width: 16 },
    { header: "Eficiência Cache (%)", key: "cacheEfficiencyPercent", width: 18 },
    { header: "Participação no Total (%)", key: "shareOfTotalPercent", width: 20 },
    { header: "Cota Semanal Usada (%)", key: "weeklyQuotaUsedPercent", width: 22 },
    { header: "Cota Aprovada Agregada (%)", key: "totalQuotaConsumedPercent", width: 24 },
    { header: "Modelos Utilizados", key: "modelsUsed", width: 30 },
    { header: "Detalhamento por Modelo", key: "modelBreakdown", width: 44 },
    { header: "Contas Utilizadas", key: "accountsUsed", width: 30 },
    { header: "Detalhamento por Conta", key: "accountBreakdown", width: 44 },
    { header: "Primeiro Uso", key: "firstUsageAt", width: 20 },
    { header: "Último Uso", key: "lastUsageAt", width: 20 },
  ];
  wsGroups.getRow(1).font = { bold: true };

  report.groups.forEach((g) => {
    wsGroups.addRow({
      rank: `${g.rank}º`,
      groupName: sanitizeFormula(g.groupName),
      username: sanitizeFormula(g.username),
      sessionsRequested: g.sessionsRequested,
      sessionsApproved: g.sessionsApproved,
      sessionsActivated: g.sessionsActivated,
      noShowCount: g.noShowCount,
      reservedHours: g.reservedHours,
      connectedHours: g.connectedHours,
      processingHours: g.processingHours,
      connectedUtilizationPercent: `${g.connectedUtilizationPercent}%`,
      processingEfficiencyPercent: `${g.processingEfficiencyPercent}%`,
      totalTokens: g.totalTokens,
      inputTokens: g.inputTokens,
      cachedInputTokens: g.cachedInputTokens,
      outputTokens: g.outputTokens,
      reasoningTokens: g.reasoningTokens,
      cacheEfficiencyPercent: `${g.cacheEfficiencyPercent}%`,
      shareOfTotalPercent: `${g.shareOfTotalPercent}%`,
      weeklyQuotaUsedPercent: `${g.weeklyQuotaUsedPercent}%`,
      totalQuotaConsumedPercent: `${g.totalQuotaConsumedPercent}%`,
      modelsUsed: sanitizeFormula(g.modelsUsed.map((m) => m.modelId).join(", ")),
      modelBreakdown: sanitizeFormula(g.modelsUsed.map((m) => `${m.modelId}: ${m.turns} turnos (${m.totalTokens} tokens)`).join("; ")),
      accountsUsed: sanitizeFormula(g.accountLabelsUsed.join(", ")),
      accountBreakdown: sanitizeFormula(g.accountBreakdown.map((a) => `${a.accountLabel}: ${a.sessions} sess. (${a.totalTokens} tokens | ${a.reservedHours}h R)`).join("; ")),
      firstUsageAt: g.firstUsageAt ? formatDateDisplay(g.firstUsageAt, report.period.timeZone) : "—",
      lastUsageAt: g.lastUsageAt ? formatDateDisplay(g.lastUsageAt, report.period.timeZone) : "—",
    });
  });

  // ABA 3: SESSÕES INDIVIDUAIS
  const wsSessions = workbook.addWorksheet("Sessões e Agendamentos");
  wsSessions.columns = [
    { header: "ID Reserva", key: "reservationId", width: 36 },
    { header: "Grupo Escolar", key: "groupName", width: 28 },
    { header: "Login", key: "username", width: 18 },
    { header: "Conta ID", key: "accountId", width: 18 },
    { header: "Rótulo da Conta", key: "accountLabel", width: 22 },
    { header: "Início", key: "startsAt", width: 20 },
    { header: "Término", key: "endsAt", width: 20 },
    { header: "Horas Reservadas (h)", key: "durationHours", width: 18 },
    { header: "Horas Conectadas (h)", key: "connectedHours", width: 18 },
    { header: "Horas Processando (h)", key: "processingHours", width: 18 },
    { header: "Aproveitamento (%)", key: "reservationUtilizationPercent", width: 18 },
    { header: "Status Aprovação", key: "approvalStatus", width: 18 },
    { header: "Status Operacional", key: "status", width: 18 },
    { header: "Cota Aprovada (%)", key: "approvedQuotaPercent", width: 18 },
    { header: "Cota Usada (%)", key: "weeklyQuotaUsedPercent", width: 18 },
    { header: "ID Dispositivo", key: "deviceId", width: 28 },
    { header: "Tokens Totais", key: "observedTokens", width: 16 },
    { header: "Tokens Entrada", key: "inputTokens", width: 16 },
    { header: "Tokens Cache", key: "cachedInputTokens", width: 16 },
    { header: "Tokens Saída", key: "outputTokens", width: 16 },
    { header: "Tokens Thinking", key: "reasoningTokens", width: 16 },
    { header: "Modelos Observados", key: "modelsUsed", width: 30 },
  ];
  wsSessions.getRow(1).font = { bold: true };

  report.sessions.forEach((s) => {
    wsSessions.addRow({
      reservationId: sanitizeFormula(s.reservationId),
      groupName: sanitizeFormula(s.groupName),
      username: sanitizeFormula(s.username),
      accountId: sanitizeFormula(s.accountId),
      accountLabel: sanitizeFormula(s.accountLabel),
      startsAt: formatDateDisplay(s.startsAt, report.period.timeZone),
      endsAt: formatDateDisplay(s.endsAt, report.period.timeZone),
      durationHours: s.durationHours,
      connectedHours: s.connectedHours,
      processingHours: s.processingHours,
      reservationUtilizationPercent: `${s.reservationUtilizationPercent}%`,
      approvalStatus: sanitizeFormula(s.approvalStatus),
      status: sanitizeFormula(s.status),
      approvedQuotaPercent: s.approvedQuotaPercent !== null ? `${s.approvedQuotaPercent}%` : "—",
      weeklyQuotaUsedPercent: `${s.weeklyQuotaUsedPercent}%`,
      deviceId: sanitizeFormula(s.deviceId || "—"),
      observedTokens: s.observedTokens,
      inputTokens: s.inputTokens,
      cachedInputTokens: s.cachedInputTokens,
      outputTokens: s.outputTokens,
      reasoningTokens: s.reasoningTokens,
      modelsUsed: sanitizeFormula(s.modelsUsed.map((m) => m.modelId).join(", ")),
    });
  });

  // ABA 4: CONTAS E INFRAESTRUTURA
  const wsAccounts = workbook.addWorksheet("Contas Pool Central");
  wsAccounts.columns = [
    { header: "Conta ID", key: "accountId", width: 24 },
    { header: "Rótulo", key: "label", width: 24 },
    { header: "Status", key: "status", width: 16 },
    { header: "Sessões Atendidas", key: "totalSessionsServed", width: 18 },
    { header: "Grupos Atendidos", key: "groupsServed", width: 34 },
    { header: "Detalhamento por Grupo", key: "groupBreakdown", width: 44 },
    { header: "Modelos Processados", key: "modelBreakdown", width: 44 },
    { header: "Horas Reservadas (h)", key: "reservedHours", width: 18 },
    { header: "Horas Conectadas (h)", key: "connectedHours", width: 18 },
    { header: "Horas Processando (h)", key: "processingHours", width: 18 },
    { header: "Tokens Totais", key: "totalTokensServed", width: 18 },
    { header: "Tokens Entrada", key: "inputTokens", width: 16 },
    { header: "Tokens Cache", key: "cachedInputTokens", width: 16 },
    { header: "Tokens Saída", key: "outputTokens", width: 16 },
    { header: "Tokens Thinking", key: "reasoningTokens", width: 16 },
    { header: "Cota Usada Acumulada (%)", key: "weeklyQuotaUsedPercent", width: 24 },
    { header: "Cota Perdida em Resets (%)", key: "weeklyQuotaWastedPercent", width: 24 },
    { header: "Saldo Atual Aberto (%)", key: "weeklyQuotaRemainingPercent", width: 20 },
    { header: "Capacidade Observada (%)", key: "quotaCapacityPercent", width: 22 },
    { header: "Janelas Encerradas", key: "completedQuotaWindows", width: 18 },
    { header: "Janelas Abertas", key: "openQuotaWindows", width: 16 },
  ];
  wsAccounts.getRow(1).font = { bold: true };

  report.accounts.forEach((acc) => {
    wsAccounts.addRow({
      accountId: sanitizeFormula(acc.accountId),
      label: sanitizeFormula(acc.label),
      status: sanitizeFormula(acc.status),
      totalSessionsServed: acc.totalSessionsServed,
      groupsServed: sanitizeFormula(acc.groupsServed.join(", ")),
      groupBreakdown: sanitizeFormula(acc.groupBreakdown.map((g) => `${g.groupName}: ${g.sessions} sess. (${g.totalTokens} tokens | ${g.connectedHours}h C)`).join("; ")),
      modelBreakdown: sanitizeFormula(acc.modelsUsed.map((m) => `${m.modelId}: ${m.turns} turnos (${m.totalTokens} tokens)`).join("; ")),
      reservedHours: acc.reservedHours,
      connectedHours: acc.connectedHours,
      processingHours: acc.processingHours,
      totalTokensServed: acc.totalTokensServed,
      inputTokens: acc.inputTokens,
      cachedInputTokens: acc.cachedInputTokens,
      outputTokens: acc.outputTokens,
      reasoningTokens: acc.reasoningTokens,
      weeklyQuotaUsedPercent: `${acc.weeklyQuotaUsedPercent}%`,
      weeklyQuotaWastedPercent: `${acc.weeklyQuotaWastedPercent}%`,
      weeklyQuotaRemainingPercent: `${acc.weeklyQuotaRemainingPercent}%`,
      quotaCapacityPercent: `${acc.quotaCapacityPercent}%`,
      completedQuotaWindows: acc.completedQuotaWindows,
      openQuotaWindows: acc.openQuotaWindows,
    });
  });

  // ABA 5: JANELAS SEMANAIS DE COTA
  const wsQuota = workbook.addWorksheet("Janelas Semanais de Cota");
  wsQuota.columns = [
    { header: "Conta ID", key: "accountId", width: 22 },
    { header: "Início da Janela", key: "windowStart", width: 20 },
    { header: "Reset da Cota", key: "windowEnd", width: 20 },
    { header: "Primeira Observação", key: "firstObservedAt", width: 20 },
    { header: "Última Observação", key: "lastObservedAt", width: 20 },
    { header: "Uso Inicial (%)", key: "startingUsedPercent", width: 16 },
    { header: "Uso Final (%)", key: "endingUsedPercent", width: 16 },
    { header: "Consumo no Período (%)", key: "consumedPercent", width: 20 },
    { header: "Cota Perdida no Reset (%)", key: "wastedPercent", width: 22 },
    { header: "Saldo Atual Disponível (%)", key: "remainingPercent", width: 22 },
    { header: "Estado", key: "state", width: 14 },
    { header: "Amostras", key: "sampleCount", width: 12 },
  ];
  wsQuota.getRow(1).font = { bold: true };

  report.quotaWindows.forEach((window) => wsQuota.addRow({
    accountId: sanitizeFormula(window.accountId),
    windowStart: formatDateDisplay(window.windowStart, report.period.timeZone),
    windowEnd: formatDateDisplay(window.windowEnd, report.period.timeZone),
    firstObservedAt: formatDateDisplay(window.firstObservedAt, report.period.timeZone),
    lastObservedAt: formatDateDisplay(window.lastObservedAt, report.period.timeZone),
    startingUsedPercent: `${window.startingUsedPercent}%`,
    endingUsedPercent: `${window.endingUsedPercent}%`,
    consumedPercent: `${window.consumedPercent}%`,
    wastedPercent: `${window.wastedPercent}%`,
    remainingPercent: `${window.remainingPercent}%`,
    state: window.completed ? "Encerrada" : "Aberta",
    sampleCount: window.sampleCount,
  }));

  // ABA 6: USO POR MODELO
  const wsModels = workbook.addWorksheet("Uso por Modelo");
  wsModels.columns = [
    { header: "Modelo", key: "modelId", width: 32 },
    { header: "Turnos Concluídos", key: "turns", width: 18 },
    { header: "Tokens Totais", key: "totalTokens", width: 18 },
    { header: "Tokens Entrada", key: "inputTokens", width: 16 },
    { header: "Tokens Cache", key: "cachedInputTokens", width: 16 },
    { header: "Tokens Saída", key: "outputTokens", width: 16 },
    { header: "Tokens Thinking", key: "reasoningTokens", width: 16 },
  ];
  wsModels.getRow(1).font = { bold: true };

  report.models.forEach((m) => wsModels.addRow({
    modelId: sanitizeFormula(m.modelId),
    turns: m.turns,
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    cachedInputTokens: m.cachedInputTokens,
    outputTokens: m.outputTokens,
    reasoningTokens: m.reasoningTokens,
  }));

  // ABA 7: LINHA DO TEMPO COMPLETA
  const wsTimeline = workbook.addWorksheet("Linha do Tempo de Uso");
  wsTimeline.columns = [
    { header: "Momento", key: "observedAt", width: 20 },
    { header: "Tipo de Evento", key: "eventType", width: 18 },
    { header: "Grupo", key: "groupName", width: 28 },
    { header: "Login", key: "username", width: 18 },
    { header: "Conta", key: "accountId", width: 20 },
    { header: "ID Reserva", key: "reservationId", width: 34 },
    { header: "Dispositivo", key: "deviceId", width: 28 },
    { header: "Thread ID", key: "threadId", width: 28 },
    { header: "Turno ID", key: "turnId", width: 28 },
    { header: "Modelo", key: "modelId", width: 24 },
    { header: "Status", key: "status", width: 16 },
    { header: "Variação Tokens", key: "tokenDelta", width: 16 },
    { header: "Variação Entrada", key: "inputTokenDelta", width: 16 },
    { header: "Variação Cache", key: "cachedInputTokenDelta", width: 16 },
    { header: "Variação Saída", key: "outputTokenDelta", width: 16 },
    { header: "Variação Thinking", key: "reasoningTokenDelta", width: 16 },
  ];
  wsTimeline.getRow(1).font = { bold: true };

  report.activityTimeline.forEach((a) => wsTimeline.addRow({
    observedAt: formatDateDisplay(a.observedAt, report.period.timeZone),
    eventType: sanitizeFormula(a.eventType),
    groupName: sanitizeFormula(a.groupName),
    username: sanitizeFormula(a.username),
    accountId: sanitizeFormula(a.accountId),
    reservationId: sanitizeFormula(a.reservationId),
    deviceId: sanitizeFormula(a.deviceId),
    threadId: sanitizeFormula(a.threadId || "—"),
    turnId: sanitizeFormula(a.turnId || "—"),
    modelId: sanitizeFormula(a.modelId || "—"),
    status: sanitizeFormula(a.status || "—"),
    tokenDelta: a.tokenDelta,
    inputTokenDelta: a.inputTokenDelta,
    cachedInputTokenDelta: a.cachedInputTokenDelta,
    outputTokenDelta: a.outputTokenDelta,
    reasoningTokenDelta: a.reasoningTokenDelta,
  }));

  for (const worksheet of workbook.worksheets) {
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: worksheet.columnCount } };
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    worksheet.getRow(1).alignment = { vertical: "middle" };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function exportReportToCsv(report: UsageReportData): string {
  const headers = [
    "Posicao",
    "Grupo",
    "Usuario",
    "Sessoes_Solicitadas",
    "Sessoes_Aprovadas",
    "Sessoes_Ativadas",
    "Ausencias_NoShow",
    "Horas_Reservadas",
    "Horas_Conectadas",
    "Horas_Processando",
    "Aproveitamento_Conexao_Percent",
    "Eficiencia_Processamento_Percent",
    "Total_Tokens",
    "Tokens_Entrada",
    "Tokens_Cache",
    "Tokens_Saida",
    "Tokens_Thinking",
    "Eficiencia_Cache_Percent",
    "Participacao_Total_Percent",
    "Cota_Semanal_Usada_Percent",
    "Cota_Aprovada_Total_Percent",
    "Modelos_Utilizados",
    "Contas_Utilizadas",
    "Primeiro_Uso",
    "Ultimo_Uso",
  ];

  const csvCell = (value: unknown): string => `"${sanitizeFormula(value).replace(/"/g, '""')}"`;

  const rows = report.groups.map((g) => [
    `${g.rank}º`,
    g.groupName,
    g.username,
    g.sessionsRequested,
    g.sessionsApproved,
    g.sessionsActivated,
    g.noShowCount,
    g.reservedHours,
    g.connectedHours,
    g.processingHours,
    g.connectedUtilizationPercent,
    g.processingEfficiencyPercent,
    g.totalTokens,
    g.inputTokens,
    g.cachedInputTokens,
    g.outputTokens,
    g.reasoningTokens,
    g.cacheEfficiencyPercent,
    g.shareOfTotalPercent,
    g.weeklyQuotaUsedPercent,
    g.totalQuotaConsumedPercent,
    g.modelsUsed.map((m) => m.modelId).join(", "),
    g.accountLabelsUsed.join(", "),
    g.firstUsageAt ? formatDateDisplay(g.firstUsageAt, report.period.timeZone) : "",
    g.lastUsageAt ? formatDateDisplay(g.lastUsageAt, report.period.timeZone) : "",
  ]);

  const csvLines = [headers.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))];
  return `\uFEFF${csvLines.join("\r\n")}`;
}
