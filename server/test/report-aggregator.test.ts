import assert from "node:assert/strict";
import test from "node:test";
import { aggregateUsageReport, type RawDatabaseData } from "../src/report-aggregator.js";

test("aggregateUsageReport consolidates group usage within a specified date window", () => {
  const rawData: RawDatabaseData = {
    profiles: [
      { user_id: "user-alpha", username: "aluno1", group_name: "Grupo Alpha" },
      { user_id: "user-beta", username: "aluno2", group_name: "Grupo Beta" },
      { user_id: "user-gamma", username: "aluno3", group_name: "Grupo Gamma" },
    ],
    reservations: [
      // Teste anterior (fora do período oficial da feira)
      {
        id: "res-test-old",
        user_id: "user-alpha",
        account_id: "primary",
        starts_at: "2026-08-15T10:00:00.000Z",
        ends_at: "2026-08-15T12:00:00.000Z",
        status: "scheduled",
        approval_status: "approved",
        requested_quota_percent: 10,
        quota_budget_percent: 10,
        device_id: "dev-old",
        activated_at: "2026-08-15T10:05:00.000Z",
      },
      // Reserva dentro da feira para Grupo Alpha
      {
        id: "res-fair-1",
        user_id: "user-alpha",
        account_id: "primary",
        starts_at: "2026-08-21T10:00:00.000Z",
        ends_at: "2026-08-21T12:00:00.000Z",
        status: "scheduled",
        approval_status: "approved",
        requested_quota_percent: 10,
        quota_budget_percent: 10,
        device_id: "dev-alpha-1",
        activated_at: "2026-08-21T10:02:00.000Z",
      },
      // Reserva dentro da feira para Grupo Beta (apenas solicitada, recusada)
      {
        id: "res-fair-2",
        user_id: "user-beta",
        account_id: "primary",
        starts_at: "2026-08-22T14:00:00.000Z",
        ends_at: "2026-08-22T15:00:00.000Z",
        status: "cancelled",
        approval_status: "rejected",
        requested_quota_percent: 5,
        quota_budget_percent: null,
      },
    ],
    deviceSnapshots: [
      {
        device_id: "dev-old",
        user_id: "user-alpha",
        reservation_id: "res-test-old",
        created_at: "2026-08-15T10:05:00.000Z",
        observed_tokens: 5000,
        observed_input_tokens: 4000,
        observed_cached_input_tokens: 1000,
        observed_output_tokens: 1000,
        observed_reasoning_tokens: 200,
      },
      {
        device_id: "dev-alpha-1",
        user_id: "user-alpha",
        reservation_id: "res-fair-1",
        created_at: "2026-08-21T10:02:00.000Z",
        observed_tokens: 73800,
        observed_input_tokens: 60000,
        observed_cached_input_tokens: 15000,
        observed_output_tokens: 13800,
        observed_reasoning_tokens: 3500,
        quota_base_used_percent: 12,
        account_used_percent: 19.5,
        usage_last_seen_at: "2026-08-21T11:55:00.000Z",
      },
      // Dispositivo avulso/não atribuído criado durante a feira
      {
        device_id: "dev-orphan",
        user_id: null,
        reservation_id: null,
        created_at: "2026-08-22T08:00:00.000Z",
        observed_tokens: 16700,
        observed_input_tokens: 12000,
        observed_cached_input_tokens: 2000,
        observed_output_tokens: 4700,
        observed_reasoning_tokens: 500,
      },
    ],
    accountSnapshots: [
      {
        account_id: "primary",
        label: "Conta Principal",
        status: "ready",
        rate_limits: {
          codex: {
            primary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1800000000 },
          },
        },
      },
    ],
    hostConnected: true,
    lastHostSyncAt: "2026-08-22T11:00:00.000Z",
  };

  const report = aggregateUsageReport(rawData, {
    from: "2026-08-20T00:00:00.000Z",
    to: "2026-08-24T23:59:59.999Z",
    timeZone: "America/Sao_Paulo",
  });

  assert.equal(report.summary.totalGroups, 3);
  assert.equal(report.summary.activeGroups, 1);
  assert.equal(report.summary.totalSessionsRequested, 2); // Apenas res-fair-1 e res-fair-2 (res-test-old foi excluída pelo filtro)
  assert.equal(report.summary.totalSessionsApproved, 1);
  assert.equal(report.summary.totalSessionsActivated, 1);
  assert.equal(report.summary.totalApprovedHours, 2);
  assert.equal(report.summary.totalAttributedTokens, 73800);
  assert.equal(report.summary.totalUnattributedTokens, 16700);
  assert.equal(report.summary.grandTotalTokens, 73800 + 16700);
  assert.equal(report.summary.totalWeeklyQuotaUsedPercent, 7.5);

  const groupAlpha = report.groups.find((g) => g.userId === "user-alpha");
  assert.ok(groupAlpha);
  assert.equal(groupAlpha.totalTokens, 73800);
  assert.equal(groupAlpha.cachedInputTokens, 15000);
  assert.equal(groupAlpha.reasoningTokens, 3500);
  assert.equal(groupAlpha.approvedHours, 2);
  assert.equal(groupAlpha.weeklyQuotaUsedPercent, 7.5);
  assert.equal(groupAlpha.totalQuotaConsumedPercent, 10);

  const groupBeta = report.groups.find((g) => g.userId === "user-beta");
  assert.ok(groupBeta);
  assert.equal(groupBeta.sessionsRequested, 1);
  assert.equal(groupBeta.sessionsApproved, 0);
  assert.equal(groupBeta.totalTokens, 0);

  assert.equal(report.dataQuality.unattributedTokens, 16700);
  assert.equal(report.dataQuality.unattributedDevicesCount, 1);
  assert.equal(report.dataQuality.hostConnected, true);
  assert.ok(report.methodology.accountQuotaDisclaimer.includes("pode exceder 100%"));
});

test("aggregateUsageReport throws on invalid date range", () => {
  assert.throws(() => {
    aggregateUsageReport({ profiles: [], reservations: [], deviceSnapshots: [], accountSnapshots: [] }, {
      from: "invalid",
      to: "2026-08-24T00:00:00.000Z",
    });
  });

  assert.throws(() => {
    aggregateUsageReport({ profiles: [], reservations: [], deviceSnapshots: [], accountSnapshots: [] }, {
      from: "2026-08-24T00:00:00.000Z",
      to: "2026-08-20T00:00:00.000Z",
    });
  });
});

test("aggregateUsageReport accumulates weekly quota windows, real turn hours and model usage", () => {
  const rawData: RawDatabaseData = {
    profiles: [{ user_id: "user-alpha", username: "alpha", group_name: "Grupo Alpha" }],
    reservations: [{
      id: "res-alpha",
      user_id: "user-alpha",
      account_id: "primary",
      starts_at: "2026-08-23T12:00:00.000Z",
      ends_at: "2026-08-23T16:00:00.000Z",
      status: "scheduled",
      approval_status: "approved",
      device_id: "dev-alpha",
      activated_at: "2026-08-23T12:00:00.000Z",
    }],
    deviceSnapshots: [{
      device_id: "dev-alpha",
      reservation_id: "res-alpha",
      created_at: "2026-08-23T12:00:00.000Z",
      observed_tokens: 1_500,
      observed_input_tokens: 1_000,
      observed_cached_input_tokens: 300,
      observed_output_tokens: 500,
      observed_reasoning_tokens: 200,
      quota_base_used_percent: 0,
      account_used_percent: 17,
    }],
    accountSnapshots: [{ account_id: "primary", label: "Conta 1", status: "ready" }],
    accountUsageSamples: [
      { account_id: "primary", used_percent: 0, window_duration_mins: 10_080, resets_at: "2026-08-22T00:00:00.000Z", observed_at: "2026-08-15T00:01:00.000Z" },
      { account_id: "primary", used_percent: 100, window_duration_mins: 10_080, resets_at: "2026-08-22T00:00:00.000Z", observed_at: "2026-08-21T23:55:00.000Z" },
      { account_id: "primary", used_percent: 0, window_duration_mins: 10_080, resets_at: "2026-08-29T00:00:00.000Z", observed_at: "2026-08-22T00:01:00.000Z" },
      { account_id: "primary", used_percent: 17, window_duration_mins: 10_080, resets_at: "2026-08-29T00:00:00.000Z", observed_at: "2026-08-23T15:05:00.000Z" },
    ],
    usageEvents: [
      { event_type: "turn_started", device_id: "dev-alpha", reservation_id: "res-alpha", account_id: "primary", thread_id: "thread-1", turn_id: "turn-1", model_id: "gpt-5.6", observed_at: "2026-08-23T13:00:00.000Z" },
      { event_type: "token_usage", device_id: "dev-alpha", reservation_id: "res-alpha", account_id: "primary", thread_id: "thread-1", turn_id: "turn-1", model_id: "gpt-5.6", thread_total_tokens: 1_500, thread_input_tokens: 1_000, thread_cached_input_tokens: 300, thread_output_tokens: 500, thread_reasoning_tokens: 200, observed_at: "2026-08-23T13:30:00.000Z" },
      { event_type: "turn_completed", device_id: "dev-alpha", reservation_id: "res-alpha", account_id: "primary", thread_id: "thread-1", turn_id: "turn-1", model_id: "gpt-5.6", observed_at: "2026-08-23T14:00:00.000Z" },
    ],
  };

  const report = aggregateUsageReport(rawData, {
    from: "2026-08-15T00:00:00.000Z",
    to: "2026-08-23T23:59:59.999Z",
  });

  assert.equal(report.summary.totalWeeklyQuotaUsedPercent, 117);
  assert.equal(report.summary.totalWeeklyQuotaWastedPercent, 0);
  assert.equal(report.summary.totalWeeklyQuotaRemainingPercent, 83);
  assert.equal(report.summary.totalQuotaCapacityPercent, 200);
  assert.equal(report.summary.quotaCapacityUtilizationPercent, 58.5);
  assert.equal(report.summary.totalReservedHours, 4);
  assert.equal(report.summary.totalObservedUsageHours, 1);
  assert.equal(report.summary.reservationUtilizationPercent, 25);
  assert.equal(report.accounts[0].weeklyQuotaUsedPercent, 117);
  assert.equal(report.accounts[0].observedUsageHours, 1);
  assert.equal(report.models[0].modelId, "gpt-5.6");
  assert.equal(report.models[0].totalTokens, 1_500);
  assert.equal(report.models[0].reasoningTokens, 200);
  assert.equal(report.activityTimeline.length, 3);
  assert.equal(report.activityTimeline[1].tokenDelta, 1_500);
  assert.equal(report.activityTimeline[1].groupName, "Grupo Alpha");
});
