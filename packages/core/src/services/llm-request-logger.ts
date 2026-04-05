import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type ProviderProfile } from "@my-agent/protocol";
import { getDefaultCodexHomeDir } from "./codex-config.js";

export interface LlmRequestLogEntry {
  timestamp?: string;
  source: "provider-service" | "agent-runner";
  purpose: "provider_test" | "provider_models" | "provider_complete" | "agent_model_request";
  threadId?: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  apiFlavor?: string;
  baseUrl?: string;
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  contentType?: string | null;
  error?: string;
  responsePreview?: string;
}

const LOG_DIR = join(getDefaultCodexHomeDir(), "log");
const LOG_PATH = join(LOG_DIR, "llm-requests.jsonl");
const PREVIEW_LIMIT = 240;

export function appendLlmRequestLog(entry: LlmRequestLogEntry): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(
      LOG_PATH,
      `${JSON.stringify({
        timestamp: entry.timestamp ?? new Date().toISOString(),
        ...entry,
      })}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn(`[llm-log] Failed to write request log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function createLoggedFetch(params: {
  source: LlmRequestLogEntry["source"];
  purpose: LlmRequestLogEntry["purpose"];
  provider: ProviderProfile;
  threadId?: string;
}): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = Date.now();
    const method = getRequestMethod(input, init);
    const url = getRequestUrl(input);

    try {
      const response = await fetch(input, init);
      appendLlmRequestLog({
        ...buildProviderMetadata(params.provider),
        source: params.source,
        purpose: params.purpose,
        threadId: params.threadId,
        method,
        url,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        contentType: response.headers.get("content-type"),
      });
      return response;
    } catch (error) {
      appendLlmRequestLog({
        ...buildProviderMetadata(params.provider),
        source: params.source,
        purpose: params.purpose,
        threadId: params.threadId,
        method,
        url,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

export function buildProviderMetadata(provider: ProviderProfile): Pick<
  LlmRequestLogEntry,
  "providerId" | "providerName" | "model" | "apiFlavor" | "baseUrl"
> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    model: provider.model,
    apiFlavor: provider.apiFlavor,
    baseUrl: provider.baseUrl,
  };
}

export function summarizeResponseBody(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, PREVIEW_LIMIT) : undefined;
}

export function getLlmRequestLogPath(): string {
  return LOG_PATH;
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }

  return "GET";
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }

  return String(input);
}
