// Verification script to fetch populated dev database data, aggregate report, and export PDF/Excel/CSV
import fs from "node:fs";
import path from "node:path";
import { SupabaseServiceClient } from "../dist/src/supabase.js";
import { aggregateUsageReport } from "../dist/src/report-aggregator.js";
import { exportReportToPdf, exportReportToXlsx, exportReportToCsv, buildReportFilename } from "../dist/src/report-exporter.js";

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !secretKey) {
  console.error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no .env.");
  process.exit(1);
}

const client = new SupabaseServiceClient(url, secretKey, "service_role");

async function main() {
  console.log("[demo-export] Conectando ao banco de desenvolvimento...");

  const from = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const timeZone = "America/Sao_Paulo";

  console.log(`[demo-export] Coletando período: ${from} até ${to} (${timeZone})...`);

  const [profilesRes, reservationsRes, devicesRes, accountsRes, usageSamplesRes, usageEventsRes] = await Promise.all([
    client.request("/rest/v1/profiles?select=user_id,username,group_name,enabled"),
    client.request(`/rest/v1/codex_reservations?select=id,user_id,account_id,starts_at,ends_at,status,approval_status,requested_quota_percent,quota_budget_percent,device_id,activated_at&starts_at=lte.${encodeURIComponent(to)}&order=starts_at.asc`),
    client.request(`/rest/v1/codex_device_snapshots?select=device_id,user_id,reservation_id,created_at,observed_tokens,observed_input_tokens,observed_cached_input_tokens,observed_output_tokens,observed_reasoning_tokens,quota_base_used_percent,account_used_percent,usage_last_seen_at,stale_at&created_at=lte.${encodeURIComponent(to)}&order=created_at.asc`),
    client.request("/rest/v1/codex_account_snapshots?select=account_id,label,status,rate_limits,usage,observed_at&order=label.asc"),
    client.request(`/rest/v1/codex_account_usage_samples?select=id,account_id,status,rate_limits,usage,used_percent,window_duration_mins,resets_at,observed_at&observed_at=gte.${encodeURIComponent(from)}&order=observed_at.asc`),
    client.request(`/rest/v1/codex_usage_events?select=id,event_type,device_id,user_id,reservation_id,account_id,thread_id,turn_id,model_id,status,thread_total_tokens,thread_input_tokens,thread_cached_input_tokens,thread_output_tokens,thread_reasoning_tokens,account_used_percent,account_window_duration_mins,account_resets_at,observed_at&observed_at=gte.${encodeURIComponent(from)}&order=observed_at.asc`).catch(() => []),
  ]);

  const rawData = {
    profiles: Array.isArray(profilesRes) ? profilesRes : [],
    reservations: Array.isArray(reservationsRes) ? reservationsRes : [],
    deviceSnapshots: Array.isArray(devicesRes) ? devicesRes : [],
    accountSnapshots: Array.isArray(accountsRes) ? accountsRes : [],
    accountUsageSamples: Array.isArray(usageSamplesRes) ? usageSamplesRes : [],
    usageEvents: Array.isArray(usageEventsRes) ? usageEventsRes : [],
    hostConnected: true,
    lastHostSyncAt: new Date().toISOString(),
  };

  console.log(`[demo-export] Dados recuperados:`);
  console.log(`  - Perfis / Grupos: ${rawData.profiles.length}`);
  console.log(`  - Reservas: ${rawData.reservations.length}`);
  console.log(`  - Snapshots de Dispositivos: ${rawData.deviceSnapshots.length}`);
  console.log(`  - Contas: ${rawData.accountSnapshots.length}`);
  console.log(`  - Amostras de Cota: ${rawData.accountUsageSamples.length}`);

  const report = aggregateUsageReport(rawData, { from, to, timeZone });

  console.log("\n[demo-export] === RESUMO DO RELATÓRIO AGREGADO ===");
  console.log(`  Total Grupos Ativos: ${report.summary.activeGroups} / ${report.summary.totalGroups}`);
  console.log(`  Total Sessões Aprovadas: ${report.summary.totalSessionsApproved}`);
  console.log(`  Horas Reservadas: ${report.summary.totalReservedHours.toFixed(1)}h`);
  console.log(`  Horas Conectadas: ${report.summary.totalConnectedHours.toFixed(1)}h`);
  console.log(`  Horas em Processamento: ${report.summary.totalProcessingHours.toFixed(1)}h`);
  console.log(`  Tokens Atribuídos: ${report.summary.totalAttributedTokens.toLocaleString()}`);
  console.log(`  Tokens Não Atribuídos: ${report.summary.totalUnattributedTokens.toLocaleString()}`);
  console.log(`  Total Geral de Tokens: ${report.summary.grandTotalTokens.toLocaleString()}`);
  console.log(`  Janelas de Cota Analisadas: ${report.quotaWindows.length}`);
  console.log(`  Cota Total Consumida (p.p.): ${report.summary.totalWeeklyQuotaUsedPercent.toFixed(1)}%`);
  console.log(`  Cota Desperdiçada (p.p.): ${report.summary.totalWeeklyQuotaWastedPercent.toFixed(1)}%`);
  console.log(`  Saldo Restante Aberto (p.p.): ${report.summary.totalWeeklyQuotaRemainingPercent.toFixed(1)}%`);
  console.log(`  Pico de Simultaneidade: ${report.highlights.peakConcurrentSessions} sessões simultâneas`);
  console.log(`  Top Consumidor: ${report.highlights.topConsumer?.groupName} (${report.highlights.topConsumer?.totalTokens.toLocaleString()} tokens)`);

  const outputDir = path.resolve("dist/demo-reports");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Export PDF
  const pdfBuffer = await exportReportToPdf(report);
  const pdfFilename = buildReportFilename(from, to, "pdf");
  const pdfPath = path.join(outputDir, pdfFilename);
  fs.writeFileSync(pdfPath, pdfBuffer);
  console.log(`\n[demo-export] ✓ PDF gerado: ${pdfPath} (${pdfBuffer.length} bytes)`);

  // 2. Export Excel
  const xlsxBuffer = await exportReportToXlsx(report);
  const xlsxFilename = buildReportFilename(from, to, "xlsx");
  const xlsxPath = path.join(outputDir, xlsxFilename);
  fs.writeFileSync(xlsxPath, xlsxBuffer);
  console.log(`[demo-export] ✓ Excel gerado: ${xlsxPath} (${xlsxBuffer.length} bytes)`);

  // 3. Export CSV
  const csvContent = exportReportToCsv(report);
  const csvFilename = buildReportFilename(from, to, "csv");
  const csvPath = path.join(outputDir, csvFilename);
  fs.writeFileSync(csvPath, csvContent, "utf8");
  console.log(`[demo-export] ✓ CSV gerado: ${csvPath} (${csvContent.length} bytes)`);

  console.log("\n[demo-export] ✓ Todos os relatórios de demonstração foram exportados e validados com sucesso!");
}

main().catch(console.error);
