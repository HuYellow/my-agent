import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ApiFlavor, type ProviderProfile } from "@yellow-flow/protocol";

type TomlValue = string | boolean;

interface TomlDocument {
  root: Record<string, TomlValue>;
  sections: Record<string, Record<string, TomlValue>>;
}

interface ParsedYellowFlowAuth {
  OPENAI_API_KEY?: string;
  [key: string]: unknown;
}

export interface StoredProviderConfig {
  providerId: string;
  provider: ProviderProfile;
  source: {
    yellowFlowHome: string;
    configPath: string;
    authPath?: string;
  };
}

export function loadStoredProviderConfig(): StoredProviderConfig | null {
  const yellowFlowHome = getDefaultYellowFlowHomeDir();
  const configPath = join(yellowFlowHome, "config.toml");

  if (!existsSync(configPath)) {
    return null;
  }

  const document = parseTomlDocument(readFileSync(configPath, "utf8"));
  const providerId = asString(document.root.model_provider);

  if (!providerId) {
    return null;
  }

  const providerSection = document.sections[`model_providers.${providerId}`];

  if (!providerSection) {
    return null;
  }

  const authPath = join(yellowFlowHome, "auth.json");
  const auth = existsSync(authPath) ? parseYellowFlowAuth(readFileSync(authPath, "utf8")) : {};
  const baseUrl = asString(providerSection.base_url);
  const model = asString(document.root.model);

  if (!baseUrl || !model) {
    return null;
  }

  return {
    providerId,
    provider: {
      id: `yellow-flow:${providerId}`,
      name: asString(providerSection.name) || providerId,
      baseUrl,
      apiKey: String(auth.OPENAI_API_KEY ?? ""),
      model,
      apiFlavor: toApiFlavor(asString(providerSection.wire_api)),
      reasoningEffort: toReasoningEffort(asString(document.root.model_reasoning_effort)),
    },
    source: {
      yellowFlowHome,
      configPath,
      authPath: existsSync(authPath) ? authPath : undefined,
    },
  };
}

export function mergeStoredProviderConfig<TConfig extends { provider: ProviderProfile }>(config: TConfig): TConfig {
  const stored = loadStoredProviderConfig();

  if (!stored) {
    return config;
  }

  return {
    ...config,
    provider: {
      ...config.provider,
      ...stored.provider,
    },
  };
}

export function syncStoredProviderConfig(provider: ProviderProfile): void {
  const yellowFlowHome = getDefaultYellowFlowHomeDir();
  const configPath = join(yellowFlowHome, "config.toml");
  const authPath = join(yellowFlowHome, "auth.json");
  const existingDocument = existsSync(configPath) ? parseTomlDocument(readFileSync(configPath, "utf8")) : createEmptyTomlDocument();
  const existingStored = loadStoredProviderConfig();
  const providerId = existingStored?.providerId ?? slugifyProviderId(provider.name || provider.id || "default");
  const sectionKey = `model_providers.${providerId}`;
  const section = (existingDocument.sections[sectionKey] ??= {});

  existingDocument.root.model_provider = providerId;
  existingDocument.root.model = provider.model;

  if (provider.reasoningEffort) {
    existingDocument.root.model_reasoning_effort = provider.reasoningEffort;
  }

  section.name = provider.name || providerId;
  section.base_url = provider.baseUrl;
  section.wire_api = fromApiFlavor(provider.apiFlavor);
  section.requires_openai_auth = true;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, serializeTomlDocument(existingDocument), "utf8");

  const auth = existsSync(authPath) ? parseYellowFlowAuth(readFileSync(authPath, "utf8")) : {};
  auth.OPENAI_API_KEY = provider.apiKey;
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}

export function ensureStoredProviderConfig(provider: ProviderProfile): void {
  const configPath = join(getDefaultYellowFlowHomeDir(), "config.toml");
  const authPath = join(getDefaultYellowFlowHomeDir(), "auth.json");

  if (existsSync(configPath) && existsSync(authPath)) {
    return;
  }

  syncStoredProviderConfig(provider);
}

export function watchStoredConfig(onChange: () => void): () => void {
  const yellowFlowHome = getDefaultYellowFlowHomeDir();
  mkdirSync(yellowFlowHome, { recursive: true });

  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      onChange();
    }, 50);
    timer.unref?.();
  };

  const watcher = watch(yellowFlowHome, () => {
    schedule();
  });

  return () => {
    if (timer) {
      clearTimeout(timer);
    }

    watcher.close();
  };
}

export function getDefaultYellowFlowHomeDir(): string {
  return process.env.YELLOW_FLOW_HOME ?? join(homedir(), ".yellow-flow");
}

export function parseTomlDocument(input: string): TomlDocument {
  const document = createEmptyTomlDocument();
  let currentSection = "";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim();

      if (currentSection) {
        document.sections[currentSection] ??= {};
      }

      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseTomlValue(line.slice(separatorIndex + 1).trim());

    if (currentSection) {
      document.sections[currentSection] ??= {};
      document.sections[currentSection]![key] = value;
    } else {
      document.root[key] = value;
    }
  }

  return document;
}

export function serializeTomlDocument(document: TomlDocument): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(document.root)) {
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }

  for (const [sectionName, entries] of Object.entries(document.sections)) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(`[${sectionName}]`);

    for (const [key, value] of Object.entries(entries)) {
      lines.push(`${key} = ${formatTomlValue(value)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function createEmptyTomlDocument(): TomlDocument {
  return {
    root: {},
    sections: {},
  };
}

function parseYellowFlowAuth(input: string): ParsedYellowFlowAuth {
  try {
    return JSON.parse(input) as ParsedYellowFlowAuth;
  } catch {
    return {};
  }
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;

    if (char === "\\" && inString && !escaped) {
      escaped = true;
      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
    }

    if (char === "#" && !inString) {
      return line.slice(0, index);
    }

    escaped = false;
  }

  return line;
}

function parseTomlValue(value: string): TomlValue {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}

function formatTomlValue(value: TomlValue): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
}

function asString(value: TomlValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function toApiFlavor(wireApi: string): ApiFlavor {
  switch (wireApi) {
    case "responses":
      return "responses";
    default:
      if (wireApi === "ai_sdk") {
        console.warn('[yellow-flow-config] "ai_sdk" is no longer supported. Falling back to "responses".');
        return "responses";
      }
      return "chat_completions";
  }
}

function fromApiFlavor(apiFlavor: ApiFlavor): string {
  switch (apiFlavor) {
    case "responses":
      return "responses";
    default:
      return "chat_completions";
  }
}

function toReasoningEffort(value: string): ProviderProfile["reasoningEffort"] | undefined {
  switch (value) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return undefined;
  }
}

function slugifyProviderId(value: string): string {
  const normalized = value
    .replace(/^yellow-flow:/, "")
    .replace(/^codex:/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "default";
}
