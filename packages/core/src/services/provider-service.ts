import { type ProviderModelRecord, type ProviderProfile } from "@my-agent/protocol";
import { buildLlmEndpointUrl, buildModelsUrl } from "./provider-url.js";

export interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatMessage;
  }>;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

interface ProviderModelsPayload {
  data?: Array<{
    id?: string;
    created?: number;
    owned_by?: string;
  }>;
}

export class ProviderService {
  async test(provider: ProviderProfile): Promise<{ ok: boolean; status: number; message: string }> {
    if (!provider.baseUrl) {
      return { ok: false, status: 0, message: "Provider baseUrl is empty." };
    }

    const response = await fetch(buildModelsUrl(provider.baseUrl), {
      method: "GET",
      headers: this.headers(provider),
    });

    const contentType = response.headers.get("content-type") ?? "";

    if (response.ok && contentType.includes("text/html")) {
      return {
        ok: false,
        status: response.status,
        message: "Provider returned HTML instead of a model list. Check the baseUrl or API root path.",
      };
    }

    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "Connected successfully." : `Provider responded with status ${response.status}.`,
    };
  }

  async complete(params: {
    provider: ProviderProfile;
    messages: ChatMessage[];
    tools: ChatCompletionTool[];
    abortSignal?: AbortSignal;
  }): Promise<ChatMessage> {
    const response = await fetch(buildLlmEndpointUrl(params.provider.baseUrl, params.provider.apiFlavor), {
      method: "POST",
      signal: params.abortSignal,
      headers: {
        ...this.headers(params.provider),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.provider.model,
        ...(params.provider.apiFlavor === "responses"
          ? {
              input: params.messages,
              tools: params.tools,
              temperature: 0.2,
            }
          : {
              messages: params.messages,
              tools: params.tools,
              tool_choice: "auto",
              temperature: 0.2,
            }),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatProviderError(response.status, response.headers.get("content-type"), body, "request"));
    }

    const payload = (await response.json()) as ChatCompletionResponse;

    if (params.provider.apiFlavor === "responses") {
      const text =
        payload.output_text ??
        (payload.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((item) => item.type === "output_text")
          .map((item) => item.text ?? "")
          .join("");

      if (!text) {
        throw new Error("Provider returned no assistant message.");
      }

      return {
        role: "assistant",
        content: text,
      };
    }

    const message = payload.choices?.[0]?.message;

    if (!message) {
      throw new Error("Provider returned no assistant message.");
    }

    return {
      ...message,
      content: message.content ?? "",
    };
  }

  async listModels(provider: ProviderProfile): Promise<ProviderModelRecord[]> {
    if (!provider.baseUrl) {
      return [];
    }

    const response = await fetch(buildModelsUrl(provider.baseUrl), {
      method: "GET",
      headers: this.headers(provider),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatProviderError(response.status, response.headers.get("content-type"), body, "model list"));
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/html")) {
      throw new Error("Provider returned HTML instead of JSON for the model list.");
    }

    const payload = (await response.json()) as ProviderModelsPayload | ProviderModelsPayload["data"] | null;
    const entries = Array.isArray(payload) ? payload : payload?.data ?? [];

    return entries
      .map((entry) => ({
        id: entry.id?.trim() ?? "",
        created: entry.created,
        ownedBy: entry.owned_by,
      }))
      .filter((entry) => entry.id.length > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private headers(provider: ProviderProfile): HeadersInit {
    const headers: Record<string, string> = {};

    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    return headers;
  }
}

function formatProviderError(
  status: number,
  contentType: string | null,
  body: string,
  operation: "request" | "model list",
): string {
  const normalizedContentType = (contentType ?? "").toLowerCase();
  const trimmedBody = body.trim();

  if (normalizedContentType.includes("text/html") || looksLikeHtml(trimmedBody)) {
    const title = extractHtmlTitle(trimmedBody);
    const suffix = title ? ` (${title})` : "";
    return `Provider ${operation} failed (${status}): upstream gateway returned an HTML error page${suffix}. Check the provider baseUrl, /v1 routing, or the upstream service status.`;
  }

  if (normalizedContentType.includes("application/json")) {
    const jsonMessage = extractJsonErrorMessage(trimmedBody);

    if (jsonMessage) {
      return `Provider ${operation} failed (${status}): ${jsonMessage}`;
    }
  }

  const compactBody = collapseWhitespace(trimmedBody).slice(0, 240);
  return compactBody
    ? `Provider ${operation} failed (${status}): ${compactBody}`
    : `Provider ${operation} failed (${status}).`;
}

function looksLikeHtml(value: string): boolean {
  return /^<!doctype html/i.test(value) || /^<html[\s>]/i.test(value) || /<head[\s>]/i.test(value);
}

function extractHtmlTitle(value: string): string | undefined {
  const match = value.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim();
}

function extractJsonErrorMessage(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const errorValue = record.error;

    if (typeof errorValue === "string") {
      return errorValue;
    }

    if (errorValue && typeof errorValue === "object") {
      const errorRecord = errorValue as Record<string, unknown>;
      const parts = [errorRecord.message, errorRecord.type, errorRecord.code]
        .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
        .map((part) => String(part).trim());

      if (parts.length > 0) {
        return parts.join(" | ");
      }
    }

    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
