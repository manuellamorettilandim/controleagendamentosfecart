import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  sanitizeFormula,
  buildReportFilename,
  exportReportToCsv,
  exportReportToXlsx,
  exportReportToPdf,
} from "../src/report-exporter.js";
import type { UsageReportData } from "../src/report-aggregator.js";

const sampleReport: UsageReportData = {
  generatedAt: "2026-08-22T12:00:00.000Z",
  period: {
    from: "2026-08-20T00:00:00.000Z",
    to: "2026-08-24T23:59:59.999Z",
    timeZone: "America/Sao_Paulo",
  },
  summary: {
    totalGroups: 2,
    activeGroups: 1,
    totalSessionsRequested: 2,
    totalSessionsApproved: 1,
    totalSessionsActivated: 1,
    totalNoShowSessions: 0,
    totalApprovedHours: 2.5,
    totalReservedHours: 2.5,
    totalConnectedHours: 2.1,
    totalProcessingHours: 1.75,
    totalObservedUsageHours: 1.75,
    reservationUtilizationPercent: 70,
    connectedUtilizationPercent: 84,
    processingEfficiencyPercent: 83.3,
    totalAttributedTokens: 50000,
    totalInputTokens: 40000,
    totalCachedInputTokens: 8000,
    totalOutputTokens: 10000,
    totalReasoningTokens: 1500,
    totalUnattributedTokens: 10000,
    grandTotalTokens: 60000,
    totalQuotaConsumedPercent: 10,
    totalWeeklyQuotaUsedPercent: 7.5,
    totalWeeklyQuotaWastedPercent: 0,
    totalWeeklyQuotaRemainingPercent: 92.5,
    totalQuotaCapacityPercent: 100,
    quotaCapacityUtilizationPercent: 7.5,
    completedQuotaWindows: 0,
    openQuotaWindows: 1,
  },
  highlights: {
    topConsumer: { groupName: "=CMD() Grupo Perigoso", totalTokens: 50000, sharePercent: 100 },
    topCacheSaver: { groupName: "=CMD() Grupo Perigoso", cachedTokens: 8000, efficiencyPercent: 16.7 },
    topActive: { groupName: "=CMD() Grupo Perigoso", hours: 2.5, sessions: 1 },
    busiestHourWindow: "10:00 às 11:00",
    peakConcurrentSessions: 1,
    averageTokensPerGroup: 50000,
    averageTokensPerHour: 20000,
    overallCacheEfficiencyPercent: 16.7,
    totalQuotaConsumedPercent: 10,
  },
  groups: [
    {
      rank: 1,
      userId: "u1",
      username: "aluno1",
      groupName: "=CMD() Grupo Perigoso", // Injeção de fórmula teste
      sessionsRequested: 1,
      sessionsApproved: 1,
      sessionsActivated: 1,
      noShowCount: 0,
      approvedHours: 2.5,
      reservedHours: 2.5,
      connectedHours: 2.1,
      processingHours: 1.75,
      observedUsageHours: 1.75,
      reservationUtilizationPercent: 70,
      connectedUtilizationPercent: 84,
      processingEfficiencyPercent: 83.3,
      totalTokens: 50000,
      inputTokens: 40000,
      cachedInputTokens: 8000,
      outputTokens: 10000,
      reasoningTokens: 1500,
      cacheEfficiencyPercent: 16.7,
      shareOfTotalPercent: 100,
      totalQuotaConsumedPercent: 10,
      weeklyQuotaUsedPercent: 7.5,
      accountsUsed: ["account-1"],
      accountLabelsUsed: ["Conta 1 - Alfa"],
      accountBreakdown: [{
        accountId: "account-1",
        accountLabel: "Conta 1 - Alfa",
        sessions: 1,
        totalTokens: 50000,
        inputTokens: 40000,
        cachedInputTokens: 8000,
        outputTokens: 10000,
        reasoningTokens: 1500,
        reservedHours: 2.5,
        connectedHours: 2.1,
        processingHours: 1.75,
      }],
      modelsUsed: [{ modelId: "gpt-5.6-sol", turns: 3, totalTokens: 50000, inputTokens: 40000, cachedInputTokens: 8000, outputTokens: 10000, reasoningTokens: 1500 }],
      firstUsageAt: "2026-08-21T10:00:00.000Z",
      lastUsageAt: "2026-08-21T12:30:00.000Z",
    },
    {
      rank: 2,
      userId: "u2",
      username: "aluno2",
      groupName: "+123 Grupo Mais",
      sessionsRequested: 1,
      sessionsApproved: 0,
      sessionsActivated: 0,
      noShowCount: 0,
      approvedHours: 0,
      reservedHours: 0,
      connectedHours: 0,
      processingHours: 0,
      observedUsageHours: 0,
      reservationUtilizationPercent: 0,
      connectedUtilizationPercent: 0,
      processingEfficiencyPercent: 0,
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheEfficiencyPercent: 0,
      shareOfTotalPercent: 0,
      totalQuotaConsumedPercent: 0,
      weeklyQuotaUsedPercent: 0,
      accountsUsed: [],
      accountLabelsUsed: [],
      accountBreakdown: [],
      modelsUsed: [],
      firstUsageAt: null,
      lastUsageAt: null,
    },
  ],
  sessions: [
    {
      reservationId: "res-1",
      groupName: "=CMD() Grupo Perigoso",
      username: "aluno1",
      accountId: "account-1",
      accountLabel: "Conta 1 - Alfa",
      startsAt: "2026-08-21T10:00:00.000Z",
      endsAt: "2026-08-21T12:30:00.000Z",
      durationHours: 2.5,
      reservedHours: 2.5,
      connectedHours: 2.1,
      processingHours: 1.75,
      observedUsageHours: 1.75,
      reservationUtilizationPercent: 70,
      approvalStatus: "approved",
      status: "scheduled",
      requestedQuotaPercent: 10,
      approvedQuotaPercent: 10,
      deviceId: "dev-1",
      activatedAt: "2026-08-21T10:01:00.000Z",
      observedTokens: 50000,
      inputTokens: 40000,
      cachedInputTokens: 8000,
      outputTokens: 10000,
      reasoningTokens: 1500,
      weeklyQuotaUsedPercent: 7.5,
      modelsUsed: [{ modelId: "gpt-5.6-sol", turns: 3, totalTokens: 50000, inputTokens: 40000, cachedInputTokens: 8000, outputTokens: 10000, reasoningTokens: 1500 }],
    },
  ],
  accounts: [
    {
      accountId: "account-1",
      label: "Conta 1 - Alfa",
      status: "ready",
      lastObservedAt: "2026-08-22T11:55:00.000Z",
      usedPercent: 35,
      resetsAt: "2026-08-28T00:00:00.000Z",
      totalSessionsServed: 1,
      totalTokensServed: 50000,
      inputTokens: 40000,
      cachedInputTokens: 8000,
      outputTokens: 10000,
      reasoningTokens: 1500,
      reservedHours: 2.5,
      connectedHours: 2.1,
      processingHours: 1.75,
      observedUsageHours: 1.75,
      reservationUtilizationPercent: 70,
      weeklyQuotaUsedPercent: 7.5,
      weeklyQuotaWastedPercent: 0,
      weeklyQuotaRemainingPercent: 92.5,
      quotaCapacityPercent: 100,
      completedQuotaWindows: 0,
      openQuotaWindows: 1,
      groupsServed: ["=CMD() Grupo Perigoso"],
      groupBreakdown: [{
        userId: "u1",
        username: "aluno1",
        groupName: "=CMD() Grupo Perigoso",
        sessions: 1,
        totalTokens: 50000,
        inputTokens: 40000,
        cachedInputTokens: 8000,
        outputTokens: 10000,
        reasoningTokens: 1500,
        reservedHours: 2.5,
        connectedHours: 2.1,
        processingHours: 1.75,
      }],
      modelsUsed: [{ modelId: "gpt-5.6-sol", turns: 3, totalTokens: 50000, inputTokens: 40000, cachedInputTokens: 8000, outputTokens: 10000, reasoningTokens: 1500 }],
      quotaWindows: [],
    },
  ],
  models: [{ modelId: "gpt-5.6-sol", turns: 3, totalTokens: 50000, inputTokens: 40000, cachedInputTokens: 8000, outputTokens: 10000, reasoningTokens: 1500 }],
  quotaWindows: [],
  activityTimeline: [],
  dataQuality: {
    unattributedTokens: 10000,
    unattributedDevicesCount: 1,
    staleSnapshotsCount: 0,
    hostConnected: true,
    lastHostSyncAt: "2026-08-22T11:59:00.000Z",
    usageEventsCount: 10,
    quotaSamplesCount: 2,
    actualHoursMethod: "Horas reservadas = duração aprovada; Horas conectadas = sessão/stream aberto; Horas em processamento = união dos turnos ativos.",
    modelAttributionCoveragePercent: 100,
    sessionCoveragePercent: 100,
    connectedHoursCoveragePercent: 84,
    hasHistoricalBaseline: true,
    dataTruncated: false,
  },
  methodology: {
    note: "Relatório oficial gerado pelo Fecart AI Share.",
    tokenAccounting: "Tokens de cache e raciocínio são informativos.",
    accountQuotaDisclaimer: "Cotas globais não são atribuíveis linearmente.",
    reconciliationRule: "Reconciliação Auditável: Tokens Atribuídos + Tokens Não Atribuídos = Total Geral Auditado.",
  },
};

test("sanitizeFormula disarms potential formula injection strings", () => {
  assert.equal(sanitizeFormula("=SUM(A1:A10)"), "'=SUM(A1:A10)");
  assert.equal(sanitizeFormula("+12345"), "'+12345");
  assert.equal(sanitizeFormula("-987"), "'-987");
  assert.equal(sanitizeFormula("@evil"), "'@evil");
  assert.equal(sanitizeFormula("\ttab"), "'\ttab");
  assert.equal(sanitizeFormula("Normal string"), "Normal string");
  assert.equal(sanitizeFormula(12345), "12345");
  assert.equal(sanitizeFormula(null), "");
});

test("buildReportFilename produces expected pattern with timezone awareness", () => {
  const filename = buildReportFilename(
    "2026-08-20T03:00:00.000Z",
    "2026-08-24T02:59:59.999Z",
    "pdf",
    "America/Sao_Paulo",
  );
  assert.match(filename, /^relatorio-fecart_2026-08-20_a_2026-08-23_gerado_\d{4}-\d{2}-\d{2}\.pdf$/);
});

test("exportReportToCsv exports UTF-8 with BOM, semicolons and sanitized formulas", () => {
  const csv = exportReportToCsv(sampleReport);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Posicao";"Grupo";"Usuario"'));
  assert.ok(csv.includes('"1º";"\'=CMD() Grupo Perigoso";"aluno1";'));
  assert.ok(csv.includes('"2º";"\'+123 Grupo Mais";"aluno2";'));
});

test("exportReportToXlsx exports workbook with all sheets, data and formula sanitization", async () => {
  const buffer = await exportReportToXlsx(sampleReport);
  assert.ok(buffer instanceof Buffer);
  assert.ok(buffer.length > 1000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  assert.equal(workbook.worksheets.length, 7);
  const summarySheet = workbook.getWorksheet("Resumo Executivo");
  const groupsSheet = workbook.getWorksheet("Classificação por Grupo");
  const sessionsSheet = workbook.getWorksheet("Sessões e Agendamentos");
  const accountsSheet = workbook.getWorksheet("Contas Pool Central");
  const quotaSheet = workbook.getWorksheet("Janelas Semanais de Cota");
  const modelsSheet = workbook.getWorksheet("Uso por Modelo");
  const timelineSheet = workbook.getWorksheet("Linha do Tempo de Uso");

  assert.ok(summarySheet);
  assert.ok(groupsSheet);
  assert.ok(sessionsSheet);
  assert.ok(accountsSheet);
  assert.ok(quotaSheet);
  assert.ok(modelsSheet);
  assert.ok(timelineSheet);

  // Validar proteção contra formula injection na célula (coluna 2: Nome do Grupo)
  const groupRow = groupsSheet!.getRow(2);
  assert.equal(groupRow.getCell(2).value, "'=CMD() Grupo Perigoso");
});

test("exportReportToPdf generates a valid multi-page PDF buffer", async () => {
  const pdfBuffer = await exportReportToPdf(sampleReport);
  assert.ok(pdfBuffer instanceof Buffer);
  assert.ok(pdfBuffer.length > 2000);
  assert.equal(pdfBuffer.subarray(0, 5).toString(), "%PDF-");
});
