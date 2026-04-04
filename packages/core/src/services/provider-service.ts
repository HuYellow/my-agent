import { type ProviderProfile } from "@my-agent/protocol";

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
}

export class ProviderService {
  async test(provider: ProviderProfile): Promise<{ ok: boolean; status: number; message: string }> {
    if (!provider.baseUrl) {
      return { ok: false, status: 0, message: "Provider baseUrl is empty." };
    }

    const response = await fetch(this.modelsUrl(provider.baseUrl), {
      method: "GET",
      headers: this.headers(provider),
    });

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
    const response = await fetch(this.chatUrl(params.provider.baseUrl), {
      method: "POST",
      signal: params.abortSignal,
      headers: {
        ...this.headers(params.provider),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.provider.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const message = payload.choices?.[0]?.message;

    if (!message) {
      throw new Error("Provider returned no assistant message.");
    }

    return {
      ...message,
      content: message.content ?? "",
    };
  }

  private headers(provider: ProviderProfile): HeadersInit {
    const headers: Record<string, string> = {};

    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    return headers;
  }

  private modelsUrl(baseUrl: string): string {
    return new URL("models", ensureTrailingSlash(baseUrl)).toString();
  }

  private chatUrl(baseUrl: string): string {
    return new URL("chat/completions", ensureTrailingSlash(baseUrl)).toString();
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
