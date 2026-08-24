// Seed script to generate 16 realistic project teams, multi-week multi-account telemetry and quota history in development
import crypto from "node:crypto";
import { SupabaseServiceClient } from "../dist/src/supabase.js";
import { loginEmailForUsername } from "../dist/src/user-identity.js";

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !secretKey) {
  console.error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no .env.");
  process.exit(1);
}

const client = new SupabaseServiceClient(url, secretKey, "service_role");

async function main() {
  console.log("[seed] Conectando ao Supabase de desenvolvimento...");

  // 0. Autenticar como administrador para que o trigger de RLS/Integridade em codex_reservations identifique is_admin = true
  const adminEmail = "admin-seed@fecart.org";
  const adminPassword = "SeedAdminPassword2026!";
  const createdAdmin = await client.createAdmin(adminEmail, adminPassword, "admin", null).catch(async () => {
    return { email: adminEmail };
  });

  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: createdAdmin.email || adminEmail,
      password: adminPassword,
    }),
  });
  const tokenData = await tokenRes.json();
  const adminToken = tokenData.access_token;
  console.log("[seed] Autenticado como administrador:", Boolean(adminToken));

  const authHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};

  async function adminReservationUpsert(rows) {
    if (rows.length === 0) return;
    await client.request("/rest/v1/codex_reservations?on_conflict=id", {
      method: "POST",
      body: rows,
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
        ...authHeaders,
      },
    });
  }

  // 1. Garantir que existam ao menos 3 contas prontas no banco de demonstração
  const initialAccounts = [
    {
      account_id: "account-1",
      label: "Conta 1 - Alfa",
      email: "openai-alfa@fecart.org",
      plan_type: "team",
      auth_mode: "oauth",
      status: "ready",
      is_default: true,
      updated_at: new Date().toISOString(),
      rate_limits: { codex: { primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: Math.floor((Date.now() + 5 * 86400000) / 1000) } } }
    },
    {
      account_id: "account-2",
      label: "Conta 2 - Beta",
      email: "openai-beta@fecart.org",
      plan_type: "team",
      auth_mode: "oauth",
      status: "ready",
      is_default: false,
      updated_at: new Date().toISOString(),
      rate_limits: { codex: { primary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: Math.floor((Date.now() + 5 * 86400000) / 1000) } } }
    },
    {
      account_id: "account-3",
      label: "Conta 3 - Gama",
      email: "openai-gama@fecart.org",
      plan_type: "team",
      auth_mode: "oauth",
      status: "ready",
      is_default: false,
      updated_at: new Date().toISOString(),
      rate_limits: { codex: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: Math.floor((Date.now() + 5 * 86400000) / 1000) } } }
    },
  ];

  await client.upsert("codex_account_snapshots", initialAccounts, "account_id");

  const accountRows = await client.request("/rest/v1/codex_account_snapshots?select=account_id,label,status&status=eq.ready&order=label.asc");
  const poolAccounts = Array.isArray(accountRows)
    ? accountRows.map((account) => ({ id: account.account_id, label: account.label || account.account_id })).filter((account) => account.id)
    : [];

  console.log(`[seed] ${poolAccounts.length} contas prontas disponíveis: ${poolAccounts.map((a) => a.label).join(", ")}`);

  const teams = [
    { name: "Grupo 01 - Robótica e Sensores", username: "grupo-robotica", tokens: 84500, input: 54000, cached: 21000, output: 9500, reasoning: 6200, hours: 3 },
    { name: "Grupo 02 - Automação Residencial", username: "grupo-automacao", tokens: 62100, input: 39000, cached: 14200, output: 8900, reasoning: 4800, hours: 2 },
    { name: "Grupo 03 - Inteligência Artificial & Visão", username: "grupo-ia", tokens: 128400, input: 82000, cached: 34000, output: 12400, reasoning: 9800, hours: 3 },
    { name: "Grupo 04 - Biotecnologia e Genética", username: "grupo-biotec", tokens: 49300, input: 31000, cached: 9800, output: 8500, reasoning: 3400, hours: 2 },
    { name: "Grupo 05 - Engenharia Aeroespacial", username: "grupo-aero", tokens: 95800, input: 61000, cached: 24500, output: 10300, reasoning: 7100, hours: 3 },
    { name: "Grupo 06 - Sustentabilidade e Energia Solar", username: "grupo-solar", tokens: 53200, input: 34000, cached: 11000, output: 8200, reasoning: 3900, hours: 2 },
    { name: "Grupo 07 - Jogos Digitais e Realidade Virtual", username: "grupo-vr", tokens: 112000, input: 71000, cached: 28000, output: 13000, reasoning: 8500, hours: 3 },
    { name: "Grupo 08 - Cibersegurança e Redes", username: "grupo-cyber", tokens: 76400, input: 48000, cached: 18000, output: 10400, reasoning: 5800, hours: 2 },
    { name: "Grupo 09 - Internet das Coisas (IoT)", username: "grupo-iot", tokens: 68900, input: 44000, cached: 16500, output: 8400, reasoning: 4900, hours: 2 },
    { name: "Grupo 10 - Drones e Veículos Autônomos", username: "grupo-drones", tokens: 104500, input: 67000, cached: 26000, output: 11500, reasoning: 7900, hours: 3 },
    { name: "Grupo 11 - Novos Materiais & Nanotecnologia", username: "grupo-nano", tokens: 41200, input: 26000, cached: 8200, output: 7000, reasoning: 2800, hours: 2 },
    { name: "Grupo 12 - Física Quântica Computacional", username: "grupo-quanti", tokens: 88700, input: 56000, cached: 22000, output: 10700, reasoning: 6800, hours: 3 },
    { name: "Grupo 13 - Aplicativos Cívicos e Sociais", username: "grupo-civic", tokens: 59000, input: 38000, cached: 13500, output: 7500, reasoning: 4100, hours: 2 },
    { name: "Grupo 14 - Saúde Digital e Telemedicina", username: "grupo-saude", tokens: 91400, input: 58000, cached: 23000, output: 10400, reasoning: 6900, hours: 3 },
    { name: "Grupo 15 - Logística Inteligente & Smart Cities", username: "grupo-cidades", tokens: 73600, input: 47000, cached: 17200, output: 9400, reasoning: 5400, hours: 2 },
    { name: "Grupo 16 - Tecnologia Assistiva e Inclusão", username: "grupo-inclusao", tokens: 67800, input: 43000, cached: 15800, output: 9000, reasoning: 5100, hours: 2 },
  ];

  console.log(`[seed] Populando ${teams.length} equipes escolares com 3+ sessões em contas alternadas ao longo de 3 semanas...`);

  // Limpeza de tabelas operacionais em desenvolvimento
  await client.request("/rest/v1/codex_usage_events?event_key=not.is.null", { method: "DELETE" }).catch(() => {});
  await client.request("/rest/v1/codex_device_snapshots?device_id=not.is.null", { method: "DELETE" }).catch(() => {});
  await client.request("/rest/v1/codex_busy_slots?reservation_id=not.is.null", { method: "DELETE" }).catch(() => {});
  await client.request("/rest/v1/codex_reservations?id=not.is.null", { method: "DELETE" }).catch(() => {});
  await client.request("/rest/v1/codex_account_usage_samples?account_id=not.is.null", { method: "DELETE" }).catch(() => {});

  const scheduleBase = new Date();
  scheduleBase.setDate(scheduleBase.getDate() - 18);
  scheduleBase.setHours(8, 0, 0, 0);

  const nextSlotByWindowAccount = new Map();
  const models = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"];

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const email = loginEmailForUsername(team.username);
    const password = "SenhaDevFecart123!";

    // 1. Auth User
    let userId = "";
    try {
      const listed = await client.request("/auth/v1/admin/users?per_page=1000");
      const existing = listed?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (existing) {
        userId = existing.id;
      } else {
        const created = await client.request("/auth/v1/admin/users", {
          method: "POST",
          body: {
            email,
            password,
            email_confirm: true,
            user_metadata: { group_name: team.name },
            app_metadata: { remote_codex_login: team.username }
          }
        });
        userId = created.id;
      }
    } catch (e) {
      console.warn(`[seed] Erro ao criar usuário auth ${team.username}:`, e.message);
      continue;
    }

    // 2. Perfis sincronizados na tabela profiles
    await client.upsert("profiles", [{
      user_id: userId,
      username: team.username,
      group_name: team.name,
      weekly_quota_percent: 25,
      enabled: true
    }], "user_id");

    // 3. 3 Sessões por equipe distribuídas em 3 semanas e contas rotacionadas
    const weights = [0.32, 0.43, 0.25];
    let allocatedTokens = 0;

    for (let sessionIndex = 0; sessionIndex < 3; sessionIndex++) {
      // Rotação estrita de contas: cada sessão usa uma conta diferente
      const account = poolAccounts[(i + sessionIndex) % poolAccounts.length];

      // Distribuição em 3 semanas
      const weekOffsetDays = sessionIndex * 7;
      const dayInWeekOffset = (i % 5);
      const slotKey = `w${sessionIndex}-d${dayInWeekOffset}-acc${account.id}`;
      const accountSlot = nextSlotByWindowAccount.get(slotKey) || 0;
      nextSlotByWindowAccount.set(slotKey, accountSlot + 1);

      const startsAtDate = new Date(scheduleBase);
      startsAtDate.setDate(startsAtDate.getDate() + weekOffsetDays + dayInWeekOffset);
      startsAtDate.setHours(8 + (accountSlot * 4), 0, 0, 0);

      const reservedHours = sessionIndex === 1 ? team.hours : Math.max(1, team.hours - 1);
      const endsAtDate = new Date(startsAtDate.getTime() + reservedHours * 3_600_000);

      // Simulação: Horas Reservadas > Horas Conectadas >= Horas em Processamento
      const connectedDurationHours = Math.round((reservedHours * 0.85) * 100) / 100;
      const processingDurationHours = Math.round((connectedDurationHours * 0.65) * 100) / 100;

      const sessionOpenedAt = new Date(startsAtDate.getTime() + 6 * 60_000);
      const sessionClosedAt = new Date(sessionOpenedAt.getTime() + connectedDurationHours * 3_600_000);
      const turnStartedAt = new Date(sessionOpenedAt.getTime() + 10 * 60_000);
      const turnCompletedAt = new Date(turnStartedAt.getTime() + processingDurationHours * 3_600_000);
      const tokenObservedAt = new Date((turnStartedAt.getTime() + turnCompletedAt.getTime()) / 2);

      const reservationId = crypto.randomUUID();
      const deviceId = `dev-${team.username}-${sessionIndex + 1}-${crypto.randomBytes(3).toString("hex")}`;
      const threadId = `thread-${crypto.randomUUID()}`;
      const turnId = `turn-${crypto.randomUUID()}`;
      const modelId = models[(i + sessionIndex) % models.length];

      const sessionTokens = sessionIndex === 2 ? team.tokens - allocatedTokens : Math.round(team.tokens * weights[sessionIndex]);
      allocatedTokens += sessionTokens;
      const ratio = sessionTokens / team.tokens;
      const inputTokens = Math.round(team.input * ratio);
      const cachedTokens = Math.round(team.cached * ratio);
      const outputTokens = Math.round(team.output * ratio);
      const reasoningTokens = Math.round(team.reasoning * ratio);

      const quotaBase = 5 + ((i + sessionIndex) % 15);
      const quotaUsed = 5 + (((i + sessionIndex) % 4) * 5);

      // Inserir Reserva Aprovada e Ativada com token de admin
      await adminReservationUpsert([{
        id: reservationId,
        user_id: userId,
        account_id: account.id,
        device_id: deviceId,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate.toISOString(),
        status: "scheduled",
        approval_status: "approved",
        requested_quota_percent: quotaUsed,
        quota_budget_percent: quotaUsed,
        quota_base_used_percent: quotaBase,
        reviewed_at: startsAtDate.toISOString(),
        review_note: "Aprovado automaticamente pela política do projeto.",
        activated_at: sessionOpenedAt.toISOString()
      }]);

      // Inserir Snapshot do Dispositivo
      await client.upsert("codex_device_snapshots", [{
        device_id: deviceId,
        label: `${team.name} - Sessão ${sessionIndex + 1}`,
        user_id: userId,
        reservation_id: reservationId,
        account_id: account.id,
        weekly_limit_percent: 100,
        status: "expired",
        fingerprint: crypto.randomBytes(6).toString("hex"),
        created_at: startsAtDate.toISOString(),
        expires_at: endsAtDate.toISOString(),
        observed_tokens: sessionTokens,
        observed_input_tokens: inputTokens,
        observed_cached_input_tokens: cachedTokens,
        observed_output_tokens: outputTokens,
        observed_reasoning_tokens: reasoningTokens,
        quota_base_used_percent: quotaBase,
        account_used_percent: quotaBase + quotaUsed,
        usage_last_seen_at: sessionClosedAt.toISOString(),
        stale_at: endsAtDate.toISOString()
      }], "device_id");

      // Inserir Eventos Operacionais Detalhados
      const baseEvent = {
        device_id: deviceId,
        user_id: userId,
        reservation_id: reservationId,
        account_id: account.id,
        thread_id: threadId,
        turn_id: turnId,
        model_id: modelId,
        status: null,
        thread_total_tokens: 0,
        thread_input_tokens: 0,
        thread_cached_input_tokens: 0,
        thread_output_tokens: 0,
        thread_reasoning_tokens: 0,
        account_used_percent: null,
        account_window_duration_mins: null,
        account_resets_at: null,
      };

      const events = [
        { ...baseEvent, event_type: "session_opened", status: "connected", observed_at: sessionOpenedAt.toISOString() },
        { ...baseEvent, event_type: "turn_started", status: "inProgress", observed_at: turnStartedAt.toISOString() },
        {
          ...baseEvent,
          event_type: "token_usage",
          status: null,
          thread_total_tokens: sessionTokens,
          thread_input_tokens: inputTokens,
          thread_cached_input_tokens: cachedTokens,
          thread_output_tokens: outputTokens,
          thread_reasoning_tokens: reasoningTokens,
          account_used_percent: quotaBase + quotaUsed,
          account_window_duration_mins: 10080,
          account_resets_at: null,
          observed_at: tokenObservedAt.toISOString()
        },
        { ...baseEvent, event_type: "turn_completed", status: "completed", observed_at: turnCompletedAt.toISOString() },
        { ...baseEvent, event_type: "session_closed", status: "closed", observed_at: sessionClosedAt.toISOString() },
      ].map((event) => ({
        ...event,
        event_key: crypto.createHash("sha256").update(`${event.event_type}|${deviceId}|${event.observed_at}`).digest("hex"),
      }));

      await client.upsert("codex_usage_events", events, "event_key").catch(() => {});
    }

    console.log(`[seed] ✓ ${team.name}: 3 sessões e telemetria cadastradas.`);
  }

  // 4. Inserir 2 Casos de No-Show e 1 Dispositivo Não Atribuído para Qualidade dos Dados
  const noShowResId1 = crypto.randomUUID();
  const noShowStarts1 = new Date();
  noShowStarts1.setDate(noShowStarts1.getDate() - 3);
  noShowStarts1.setHours(20, 0, 0, 0);
  const noShowEnds1 = new Date(noShowStarts1.getTime() + 2 * 3600000);

  const nanoRows = await client.request("/rest/v1/profiles?username=eq.grupo-nano");
  const nanoUserId = Array.isArray(nanoRows) ? nanoRows[0]?.user_id : null;

  if (nanoUserId) {
    await adminReservationUpsert([{
      id: noShowResId1,
      user_id: nanoUserId,
      account_id: poolAccounts[0].id,
      starts_at: noShowStarts1.toISOString(),
      ends_at: noShowEnds1.toISOString(),
      status: "scheduled",
      approval_status: "approved",
      requested_quota_percent: 15,
      quota_budget_percent: 15,
      reviewed_at: noShowStarts1.toISOString(),
      review_note: "Aprovado mas equipe não realizou check-in (no-show)",
    }]);
  }

  // Dispositivo não atribuído
  const orphanDevId = `dev-unattributed-${crypto.randomBytes(4).toString("hex")}`;
  const orphanObservedAt = new Date();
  orphanObservedAt.setDate(orphanObservedAt.getDate() - 6);
  await client.upsert("codex_device_snapshots", [{
    device_id: orphanDevId,
    label: "Terminal Avulso de Testes Central",
    user_id: null,
    reservation_id: null,
    account_id: poolAccounts[0].id,
    weekly_limit_percent: 100,
    status: "expired",
    fingerprint: crypto.randomBytes(6).toString("hex"),
    created_at: orphanObservedAt.toISOString(),
    expires_at: new Date(orphanObservedAt.getTime() + 3600000).toISOString(),
    observed_tokens: 12500,
    observed_input_tokens: 8000,
    observed_cached_input_tokens: 3000,
    observed_output_tokens: 1000,
    observed_reasoning_tokens: 500,
    stale_at: orphanObservedAt.toISOString()
  }], "device_id");

  // 5. Três janelas semanais normalizadas por conta: 2 encerradas com desperdício e 1 aberta com saldo
  const currentReset = new Date();
  currentReset.setDate(currentReset.getDate() + 5);
  currentReset.setHours(0, 0, 0, 0);

  const quotaSamples = [];
  for (let accountIndex = 0; accountIndex < poolAccounts.length; accountIndex += 1) {
    const account = poolAccounts[accountIndex];
    // Semana 1: 95% usado -> 5% desperdiçado
    // Semana 2: 75% usado -> 25% desperdiçado
    // Semana 3 (Atual): 22% usado -> 78% saldo restante aberto
    const weeklyTargets = [95 - (accountIndex * 5), 75 - (accountIndex * 6), 22 + (accountIndex * 7)];

    for (let weekIndex = 0; weekIndex < 3; weekIndex += 1) {
      const resetAt = new Date(currentReset.getTime() - (2 - weekIndex) * 7 * 86_400_000);
      const windowStart = new Date(resetAt.getTime() - 7 * 86_400_000);
      const finalObservedAt = weekIndex < 2 ? new Date(resetAt.getTime() - 5 * 60_000) : new Date();
      const usedPercent = Math.min(100, weeklyTargets[weekIndex]);
      const resetSeconds = Math.floor(resetAt.getTime() / 1_000);

      quotaSamples.push(
        {
          account_id: account.id,
          status: "ready",
          used_percent: 0,
          window_duration_mins: 10080,
          resets_at: resetAt.toISOString(),
          rate_limits: { codex: { primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: resetSeconds } } },
          observed_at: new Date(windowStart.getTime() + 60_000).toISOString()
        },
        {
          account_id: account.id,
          status: "ready",
          used_percent: usedPercent,
          window_duration_mins: 10080,
          resets_at: resetAt.toISOString(),
          rate_limits: { codex: { primary: { usedPercent, windowDurationMins: 10080, resetsAt: resetSeconds } } },
          observed_at: finalObservedAt.toISOString()
        }
      );
    }
  }

  await client.upsert("codex_account_usage_samples", quotaSamples);

  console.log(`\n[seed] ✓ Sucesso completo!`);
  console.log(`[seed] 16 Equipes cadastradas | 3 Contas rotacionadas | 49 Sessões | Amostras de cota com desperdício e saldo.`);
}

main().catch(console.error);
