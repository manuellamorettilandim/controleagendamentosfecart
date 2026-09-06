import { describe, expect, it } from "vitest";
import { buildActiveSessionMetrics, mergeSessionDevices } from "./activeSessionMetrics";

describe("active session metrics", () => {
  it("aggregates only the real events from the active reservation", () => {
    const result = buildActiveSessionMetrics({
      reservation: {
        id: "reservation-1",
        quota_base_used_percent: 22,
        quota_budget_percent: 100,
      },
      device: {
        reservation_id: "reservation-1",
        status: "active",
        observed_tokens: 500,
        account_used_percent: 42,
        quota_base_used_percent: 22,
        quota_budget_percent: 100,
      },
      hasToken: true,
      usageEvents: [
        { reservation_id: "reservation-1", event_type: "session_opened", model_id: null, thread_total_tokens: 0 },
        { reservation_id: "reservation-1", event_type: "turn_started", turn_id: "turn-1", model_id: "gpt-5.6-sol" },
        {
          reservation_id: "reservation-1",
          event_type: "token_usage",
          turn_id: "turn-1",
          model_id: "gpt-5.6-sol",
          thread_input_tokens: 100,
          thread_output_tokens: 50,
          thread_total_tokens: 150,
          observed_at: "2026-09-05T15:00:00.000Z",
        },
        {
          reservation_id: "reservation-1",
          event_type: "turn_completed",
          turn_id: "turn-1",
          model_id: "gpt-5.6-sol",
          thread_total_tokens: 150,
        },
        {
          reservation_id: "reservation-1",
          event_type: "token_usage",
          turn_id: "turn-2",
          model_id: "gpt-5.6-sol",
          thread_input_tokens: 200,
          thread_output_tokens: 50,
          thread_total_tokens: 250,
          observed_at: "2026-09-05T15:10:00.000Z",
        },
        {
          reservation_id: "another-reservation",
          event_type: "token_usage",
          turn_id: "other-turn",
          model_id: "gpt-5.6-terra",
          thread_total_tokens: 9999,
        },
      ],
    });

    expect(result.modelsCount).toBe(1);
    expect(result.modelsUsed[0]).toMatchObject({
      modelName: "gpt-5.6-sol",
      inputTokens: 300,
      outputTokens: 100,
      totalTokens: 400,
    });
    expect(result.commandsCount).toBe(2);
    expect(result.totalTokens).toBe(500);
    expect(result.quotaRemainingPercent).toBe(80);
    expect(result.statusLabel).toBe("Conectada");
  });

  it("returns an honest empty state before telemetry arrives", () => {
    const result = buildActiveSessionMetrics({
      reservation: { id: "reservation-1" },
      device: null,
      hasToken: false,
      usageEvents: [],
    });

    expect(result.modelsUsed).toEqual([]);
    expect(result.modelsCount).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.commandsCount).toBe(0);
    expect(result.quotaRemainingPercent).toBeNull();
    expect(result.statusLabel).toBe("Aguardando conexão");
  });

  it("keeps the greatest live counters when the database snapshot lags behind", () => {
    const merged = mergeSessionDevices(
      { reservationId: "reservation-1", usage: { observedTokens: 900, quotaConsumedPercent: 12 } },
      { reservation_id: "reservation-1", observed_tokens: 400, account_used_percent: 30 },
    );

    expect(merged?.usage).toMatchObject({ observedTokens: 900, quotaConsumedPercent: 12, accountUsedPercent: 30 });
  });

  it("uses device-linked telemetry when an event has no reservation id", () => {
    const result = buildActiveSessionMetrics({
      reservation: { id: "reservation-1" },
      device: { device_id: "device-1", observed_tokens: 0 },
      hasToken: true,
      usageEvents: [{
        device_id: "device-1",
        reservation_id: null,
        event_type: "token_usage",
        turn_id: "turn-1",
        model_id: "gpt-5.6-luna",
        thread_input_tokens: 12,
        thread_output_tokens: 8,
        thread_total_tokens: 20,
      }],
    });

    expect(result.modelsCount).toBe(1);
    expect(result.totalTokens).toBe(20);
    expect(result.commandsCount).toBe(1);
  });
});
