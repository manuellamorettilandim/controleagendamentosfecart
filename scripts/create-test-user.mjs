import crypto from "node:crypto";
import { SupabaseServiceClient } from "../dist/src/supabase.js";
import { loginEmailForUsername } from "../dist/src/user-identity.js";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SUPABASE_URL e SUPABASE_SECRET_KEY são necessários.");
    process.exit(1);
  }

  const supabase = new SupabaseServiceClient(supabaseUrl, serviceRoleKey);

  const username = "aluno-teste";
  const password = "SenhaTeste123!";
  const groupName = "Grupo de Teste (Cota 1%)";
  const loginEmail = loginEmailForUsername(username);
  const weeklyQuotaPercent = 1; // 1% de cota

  console.log(`[test-user] Criando/atualizando usuário '${username}' com cota de ${weeklyQuotaPercent}%...`);
  const { userId } = await supabase.upsertEndUser({
    username,
    loginEmail,
    password,
    groupName,
    weeklyQuotaPercent,
  });

  console.log(`[test-user] ✓ Usuário criado com sucesso! User ID: ${userId}`);

  // Criar uma reserva aprovada para agora para o usuário poder testar imediatamente
  const now = new Date();
  const startsAt = new Date(now.getTime() + 60_000).toISOString(); // Começa em 1 minuto
  const endsAt = new Date(now.getTime() + 120 * 60_000).toISOString(); // 2 horas de duração

  // Pegar contas prontas
  const accountRows = await supabase.request("/rest/v1/codex_account_snapshots?select=account_id,label,status&status=eq.ready&order=label.asc");
  const readyAccount = Array.isArray(accountRows) && accountRows.length > 0 ? accountRows[0].account_id : "account-1";

  const reservationId = crypto.randomUUID();
  console.log(`[test-user] Criando reserva ativa de teste '${reservationId}' na conta '${readyAccount}' com cota de 1%...`);

  await supabase.upsert("codex_reservations", [{
    id: reservationId,
    user_id: userId,
    account_id: readyAccount,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "scheduled",
    approval_status: "approved",
    requested_quota_percent: 1,
    quota_budget_percent: 1,
    reviewed_at: new Date().toISOString(),
    review_note: "Reserva criada para teste de bloqueio de cota de 1%",
    created_at: new Date().toISOString(),
  }], "id");

  // Registrar busy slot
  await supabase.upsert("codex_busy_slots", [{
    reservation_id: reservationId,
    account_id: readyAccount,
    starts_at: startsAt,
    ends_at: endsAt,
  }], "reservation_id");

  console.log("\n========================================================");
  console.log("CREDENCIAIS DO USUÁRIO DE TESTE (USUÁRIO NORMAL):");
  console.log(`  Login / Usuário: ${username}`);
  console.log(`  Senha:           ${password}`);
  console.log(`  Nome do Grupo:   ${groupName}`);
  console.log(`  Cota Semanal:    ${weeklyQuotaPercent}%`);
  console.log(`  Reserva Ativa:   Hoje (${startsAt.slice(11, 16)} até ${endsAt.slice(11, 16)})`);
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
