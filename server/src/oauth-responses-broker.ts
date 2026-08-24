import fs from "node:fs/promises";
import path from "node:path";
import type { AccountRecord } from "./account-store.js";
import type { DeviceUsageCounters, UsageObservation } from "./access-store.js";
import type { AccountWorker } from "./account-worker.js";

export interface ExtractedUsage {
  responseId?: string | null;
  model?: string | null;
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface AuthTokens {
  id_token?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  account_id?: string | null;
}

export interface AuthFileData {
  auth_mode?: string | null;
  tokens?: AuthTokens | null;
  last_refresh?: string | null;
}

export interface BrokerRequestOptions {
  requestId: string;
  deviceId: string;
  accountId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  account: AccountRecord;
  worker?: AccountWorker | null;
  onStart: (status: number, headers: Record<string, string>) => void;
  onChunk: (chunk: string) => void;
  onEnd: (usage: ExtractedUsage | null) => void;
  onError: (status: number, error: string) => void;
}

const DEFAULT_UPSTREAM_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

export function parseAuthFile(raw: string): AuthFileData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Formato inválido no arquivo de autenticação (auth.json).");
  }

  if (!isRecord(parsed)) {
    throw new Error("Arquivo de autenticação inválido.");
  }

  const tokens = isRecord(parsed.tokens) ? parsed.tokens : null;

  return {
    auth_mode: typeof parsed.auth_mode === "string" ? parsed.auth_mode : null,
    tokens: tokens ? {
      id_token: typeof tokens.id_token === "string" ? tokens.id_token : null,
      access_token: typeof tokens.access_token === "string" ? tokens.access_token : null,
      refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
      account_id: typeof tokens.account_id === "string" ? tokens.account_id : null,
    } : null,
    last_refresh: typeof parsed.last_refresh === "string" ? parsed.last_refresh : null,
  };
}

export function extractUsageFromSsePayload(payload: unknown): ExtractedUsage | null {
  if (!isRecord(payload)) return null;

  const responseObj = isRecord(payload.response) ? payload.response : payload;
  const usageObj = isRecord(responseObj.usage)
    ? responseObj.usage
    : isRecord(payload.usage)
      ? payload.usage
      : isRecord(payload.tokenUsage)
        ? payload.tokenUsage
        : null;

  if (!usageObj) return null;

  const inputDetails = isRecord(usageObj.input_tokens_details)
    ? usageObj.input_tokens_details
    : isRecord(usageObj.inputTokenDetails)
      ? usageObj.inputTokenDetails
      : null;

  const outputDetails = isRecord(usageObj.output_tokens_details)
    ? usageObj.output_tokens_details
    : isRecord(usageObj.outputTokenDetails)
      ? usageObj.outputTokenDetails
      : null;

  const inputTokens = nonNegativeInt(usageObj.input_tokens ?? usageObj.inputTokens ?? usageObj.prompt_tokens);
  const outputTokens = nonNegativeInt(usageObj.output_tokens ?? usageObj.outputTokens ?? usageObj.completion_tokens);
  const cachedInputTokens = nonNegativeInt(inputDetails?.cached_tokens ?? inputDetails?.cachedTokens);
  const reasoningOutputTokens = nonNegativeInt(outputDetails?.reasoning_tokens ?? outputDetails?.reasoningTokens);
  const totalTokens = nonNegativeInt(usageObj.total_tokens ?? usageObj.totalTokens ?? (inputTokens + outputTokens));

  const responseId = typeof responseObj.id === "string" ? responseObj.id : typeof payload.id === "string" ? payload.id : null;
  const model = typeof responseObj.model === "string" ? responseObj.model : typeof payload.model === "string" ? payload.model : null;

  return {
    responseId,
    model,
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

export class SseUsageParser {
  private buffer = "";
  private latestUsage: ExtractedUsage | null = null;
  private seenResponseIds = new Set<string>();

  public feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    // Keep the last incomplete segment in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(dataStr);
        const usage = extractUsageFromSsePayload(parsed);
        if (usage) {
          this.latestUsage = usage;
          if (usage.responseId) {
            this.seenResponseIds.add(usage.responseId);
          }
        }
      } catch {
        // Incomplete JSON or other event structure, ignore
      }
    }
  }

  public getUsage(): ExtractedUsage | null {
    return this.latestUsage;
  }
}

export function resolveUpstreamUrl(baseConfigUrl?: string, requestPath = "/responses"): string {
  const rawUrl = (baseConfigUrl || process.env.CODEX_OAUTH_RESPONSES_URL || DEFAULT_UPSTREAM_RESPONSES_URL).trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL de upstream Responses inválida.");
  }

  // Security check: Must be https except for local testing
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("URL de upstream Responses deve usar HTTPS.");
  }

  // Handle /responses vs /responses/compact
  if (requestPath.endsWith("/compact")) {
    if (!parsed.pathname.endsWith("/compact")) {
      parsed.pathname = parsed.pathname.replace(/\/responses\/?$/, "/responses/compact");
    }
  }

  return parsed.toString();
}

export class OAuthResponsesBroker {
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly defaultUpstreamUrl?: string;

  public constructor(defaultUpstreamUrl?: string) {
    this.defaultUpstreamUrl = defaultUpstreamUrl;
  }

  public async readAccountAuth(codeHome: string): Promise<{ accessToken: string; accountId: string | null }> {
    const authPath = path.join(path.resolve(codeHome), "auth.json");
    let raw: string;
    try {
      raw = await fs.readFile(authPath, "utf8");
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "ENOENT") {
        throw new Error("Conta não autenticada no host central (auth.json inexistente).");
      }
      throw err;
    }

    const auth = parseAuthFile(raw);
    const accessToken = auth.tokens?.access_token;
    if (!accessToken) {
      throw new Error("Token de acesso OAuth não encontrado para a conta no host central.");
    }

    return {
      accessToken,
      accountId: auth.tokens?.account_id ?? null,
    };
  }

  public abort(requestId: string, reason = "aborted"): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort(reason);
      this.activeRequests.delete(requestId);
    }
  }

  public async executeRequest(options: BrokerRequestOptions): Promise<void> {
    const { requestId, account, worker } = options;
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      await this.doExecuteWithRetry(options, abortController, false);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  private async doExecuteWithRetry(
    options: BrokerRequestOptions,
    abortController: AbortController,
    isRetry: boolean,
  ): Promise<void> {
    const { requestId, account, worker, method, path: reqPath, body, onStart, onChunk, onEnd, onError } = options;

    let auth = await this.readAccountAuth(account.codeHome);
    const upstreamUrl = resolveUpstreamUrl(this.defaultUpstreamUrl, reqPath);

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "originator": "codex_cli_rs",
      "OpenAI-Beta": "responses=experimental",
    };

    if (auth.accountId) {
      headers["chatgpt-account-id"] = auth.accountId;
    }

    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        method: method || "POST",
        headers,
        body,
        signal: abortController.signal,
      });
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      onError(502, `Falha na conexão com o upstream ChatGPT: ${msg}`);
      return;
    }

    // If 401 Unauthorized and not retried yet, attempt OAuth token refresh once
    if (response.status === 401 && !isRetry && worker) {
      const refreshed = await worker.refreshOAuthToken().catch(() => false);
      if (refreshed && !abortController.signal.aborted) {
        return this.doExecuteWithRetry(options, abortController, true);
      }
    }

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        errorBody = response.statusText;
      }
      let sanitizedError = `Upstream error (${response.status}): ${response.statusText}`;
      try {
        const jsonErr = JSON.parse(errorBody);
        if (isRecord(jsonErr) && isRecord(jsonErr.error) && typeof jsonErr.error.message === "string") {
          sanitizedError = jsonErr.error.message;
        } else if (isRecord(jsonErr) && typeof jsonErr.message === "string") {
          sanitizedError = jsonErr.message;
        }
      } catch {
        if (errorBody && errorBody.length < 300) {
          sanitizedError = errorBody;
        }
      }
      onError(response.status, sanitizedError);
      return;
    }

    const responseHeaders: Record<string, string> = {
      "content-type": response.headers.get("content-type") || "text/event-stream; charset=utf-8",
    };
    const requestIdHeader = response.headers.get("x-request-id");
    if (requestIdHeader) {
      responseHeaders["x-request-id"] = requestIdHeader;
    }

    onStart(response.status, responseHeaders);

    if (!response.body) {
      onEnd(null);
      return;
    }

    const sseParser = new SseUsageParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    try {
      while (true) {
        if (abortController.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        if (textChunk) {
          sseParser.feed(textChunk);
          onChunk(textChunk);
        }
      }
      // Flush any trailing characters
      const tail = decoder.decode();
      if (tail) {
        sseParser.feed(tail);
        onChunk(tail);
      }
    } catch (err: unknown) {
      if (!abortController.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        onError(500, `Streaming error: ${msg}`);
        return;
      }
    }

    if (!abortController.signal.aborted) {
      onEnd(sseParser.getUsage());
    }
  }
}