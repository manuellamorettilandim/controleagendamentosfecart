import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OAuthResponsesBroker,
  parseAuthFile,
  extractUsageFromSsePayload,
  SseUsageParser,
  resolveUpstreamUrl,
} from "../src/oauth-responses-broker.js";
import type { AccountRecord } from "../src/account-store.js";
import type { AccountWorker } from "../src/account-worker.js";

test("parseAuthFile extracts tokens safely and throws on corrupt JSON", () => {
  const valid = JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      id_token: "id_123",
      access_token: "acc_secret_token",
      refresh_token: "ref_secret_token",
      account_id: "acc_id_abc",
    },
    last_refresh: "2026-08-20T10:00:00Z",
  });

  const parsed = parseAuthFile(valid);
  assert.equal(parsed.auth_mode, "chatgpt");
  assert.equal(parsed.tokens?.access_token, "acc_secret_token");
  assert.equal(parsed.tokens?.account_id, "acc_id_abc");
  assert.equal(parsed.tokens?.refresh_token, "ref_secret_token");

  assert.throws(() => parseAuthFile("not json"), /Formato inválido/);
  assert.throws(() => parseAuthFile("[]"), /Arquivo de autenticação inválido/);
});

test("SseUsageParser and extractUsageFromSsePayload parse Responses token usage and deduplicate", () => {
  const parser = new SseUsageParser();

  // Feed fragmented SSE chunks
  parser.feed("event: response.created\r\ndata: {\"response\": {\"id\": \"resp_123\"}}\r\n\r\n");
  assert.equal(parser.getUsage(), null);

  parser.feed("event: response.output_item.added\r\ndata: {\"item\": {\"id\": \"item_1\"}}\r\n\r\n");
  assert.equal(parser.getUsage(), null);

  parser.feed("event: response.completed\r\ndata: {\"response\": {\"id\": \"resp_123\", \"model\": \"gpt-5.6-sol\", \"usage\": {\"total_tokens\": 150, \"input_tokens\": 100, \"output_tokens\": 50, \"input_tokens_details\": {\"cached_tokens\": 20}, \"output_tokens_details\": {\"reasoning_tokens\": 15}}}}\r\n\r\n");

  const usage = parser.getUsage();
  assert.notEqual(usage, null);
  assert.equal(usage?.responseId, "resp_123");
  assert.equal(usage?.model, "gpt-5.6-sol");
  assert.equal(usage?.totalTokens, 150);
  assert.equal(usage?.inputTokens, 100);
  assert.equal(usage?.cachedInputTokens, 20);
  assert.equal(usage?.outputTokens, 50);
  assert.equal(usage?.reasoningOutputTokens, 15);
});

test("resolveUpstreamUrl resolves endpoints and validates protocol", () => {
  const defaultUrl = resolveUpstreamUrl(undefined, "/responses");
  assert.equal(defaultUrl, "https://chatgpt.com/backend-api/codex/responses");

  const compactUrl = resolveUpstreamUrl(undefined, "/api/codex/v1/responses/compact");
  assert.equal(compactUrl, "https://chatgpt.com/backend-api/codex/responses/compact");

  const localTest = resolveUpstreamUrl("http://127.0.0.1:9999/backend-api/codex/responses", "/responses");
  assert.equal(localTest, "http://127.0.0.1:9999/backend-api/codex/responses");

  assert.throws(() => resolveUpstreamUrl("http://evil.com/responses"), /HTTPS/);
});

test("OAuthResponsesBroker dispatches to upstream, sets OAuth headers, and streams SSE response", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "broker-test-"));
  const authPath = path.join(tempDir, "auth.json");
  await fs.writeFile(
    authPath,
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "test_oauth_access_token",
        account_id: "acct_test_789",
      },
    }),
    "utf8"
  );

  let receivedHeaders: http.IncomingHttpHeaders | null = null;
  let receivedBody = "";

  const mockUpstream = http.createServer((req, res) => {
    receivedHeaders = req.headers;
    req.on("data", (chunk) => {
      receivedBody += chunk.toString("utf8");
    });
    req.on("end", () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "x-request-id": "mock_upstream_req_1",
      });
      res.write("event: response.created\ndata: {\"response\": {\"id\": \"resp_mock_1\"}}\n\n");
      res.write("event: response.completed\ndata: {\"response\": {\"id\": \"resp_mock_1\", \"usage\": {\"total_tokens\": 42, \"input_tokens\": 30, \"output_tokens\": 12}}}\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
  const port = (mockUpstream.address() as { port: number }).port;
  const upstreamUrl = `http://127.0.0.1:${port}/backend-api/codex/responses`;

  try {
    const broker = new OAuthResponsesBroker(upstreamUrl);
    const account: AccountRecord = {
      accountId: "test_account",
      label: "Test Account",
      codeHome: tempDir,
      appServerPort: 4500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: true,
    };

    let startStatus = 0;
    let startHeaders: Record<string, string> = {};
    const chunks: string[] = [];
    let endUsage: unknown = null;

    await broker.executeRequest({
      requestId: "req_test_1",
      deviceId: "dev_1",
      accountId: "test_account",
      method: "POST",
      path: "/responses",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", prompt: "hello" }),
      account,
      worker: null,
      onStart: (status, headers) => {
        startStatus = status;
        startHeaders = headers;
      },
      onChunk: (chunk) => chunks.push(chunk),
      onEnd: (usage) => {
        endUsage = usage;
      },
      onError: (status, error) => {
        assert.fail(`Unexpected error: ${status} - ${error}`);
      },
    });

    assert.equal(startStatus, 200);
    assert.equal(startHeaders["x-request-id"], "mock_upstream_req_1");
    assert.equal(chunks.length >= 1, true);
    assert.equal(chunks.join("").includes("resp_mock_1"), true);
    assert.deepEqual(endUsage, {
      responseId: "resp_mock_1",
      model: null,
      totalTokens: 42,
      inputTokens: 30,
      cachedInputTokens: 0,
      outputTokens: 12,
      reasoningOutputTokens: 0,
    });

    assert.equal(receivedHeaders?.["authorization"], "Bearer test_oauth_access_token");
    assert.equal(receivedHeaders?.["chatgpt-account-id"], "acct_test_789");
    assert.equal(receivedHeaders?.["originator"], "codex_cli_rs");
    assert.equal(receivedHeaders?.["openai-beta"], "responses=experimental");
    assert.equal(JSON.parse(receivedBody).model, "gpt-5.6-sol");
  } finally {
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("OAuthResponsesBroker retries once on 401 after calling worker.refreshOAuthToken", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "broker-retry-test-"));
  const authPath = path.join(tempDir, "auth.json");
  await fs.writeFile(
    authPath,
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "expired_token" },
    }),
    "utf8"
  );

  let attempts = 0;
  const mockUpstream = http.createServer((req, res) => {
    attempts++;
    if (req.headers["authorization"] === "Bearer expired_token") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Token expired." } }));
      return;
    }
    if (req.headers["authorization"] === "Bearer refreshed_valid_token") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: response.completed\ndata: {\"response\": {\"id\": \"resp_retry\", \"usage\": {\"total_tokens\": 10, \"input_tokens\": 8, \"output_tokens\": 2}}}\n\n");
      res.end();
      return;
    }
    res.writeHead(403);
    res.end();
  });

  await new Promise<void>((resolve) => mockUpstream.listen(0, "127.0.0.1", () => resolve()));
  const port = (mockUpstream.address() as { port: number }).port;
  const upstreamUrl = `http://127.0.0.1:${port}/backend-api/codex/responses`;

  try {
    const broker = new OAuthResponsesBroker(upstreamUrl);
    const account: AccountRecord = {
      accountId: "test_account",
      label: "Test Account",
      codeHome: tempDir,
      appServerPort: 4500,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: true,
    };

    let refreshCalled = 0;
    const mockWorker = {
      refreshOAuthToken: async () => {
        refreshCalled++;
        // Simulate writing fresh auth.json
        await fs.writeFile(
          authPath,
          JSON.stringify({
            auth_mode: "chatgpt",
            tokens: { access_token: "refreshed_valid_token" },
          }),
          "utf8"
        );
        return true;
      },
    } as unknown as AccountWorker;

    let ended = false;
    await broker.executeRequest({
      requestId: "req_retry_1",
      deviceId: "dev_1",
      accountId: "test_account",
      method: "POST",
      path: "/responses",
      headers: {},
      body: JSON.stringify({ prompt: "hi" }),
      account,
      worker: mockWorker,
      onStart: (status) => assert.equal(status, 200),
      onChunk: () => undefined,
      onEnd: (usage) => {
        ended = true;
        assert.equal(usage?.totalTokens, 10);
      },
      onError: (status, error) => {
        assert.fail(`Unexpected error: ${status} - ${error}`);
      },
    });

    assert.equal(attempts, 2);
    assert.equal(refreshCalled, 1);
    assert.equal(ended, true);
  } finally {
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
});