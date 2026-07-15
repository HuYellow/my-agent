import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ApiFlavor, type ProviderProfile } from "@my-agent/protocol";

type TomlValue = string | boolean;

interface TomlDocument {
  root: Record<string, TomlValue>;
  sections: Record<string, Record<string, TomlValue>>;
}

interface ParsedMyAgentAuth {
  OPENAI_API_KEY?: string;
  [key: string]: unknown;
}

export interface StoredProviderConfig {
  providerId: string;
  provider: ProviderProfile;
  source: {
    myAgentHome: string;
    configPath: string;
    authPath?: string;
  };
}

export function loadStoredProviderConfig(): StoredProviderConfig | null {
  const myAgentHome = getDefaultMyAgentHomeDir();
  const configPath = join(myAgentHome, "config.toml");

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

  const authPath = join(myAgentHome, "auth.json");
  const auth = existsSync(authPath) ? parseMyAgentAuth(readFileSync(authPath, "utf8")) : {};
  const baseUrl = asString(providerSection.base_url);
  const model = asString(document.root.model);

  if (!baseUrl || !model) {
    return null;
  }

  return {
    providerId,
    provider: {
      id: `my-agent:${providerId}`,
      name: asString(providerSection.name) || providerId,
      baseUrl,
      apiKey: String(auth.OPENAI_API_KEY ?? ""),
      model,
      apiFlavor: toApiFlavor(asString(providerSection.wire_api)),
      reasoningEffort: toReasoningEffort(asString(document.root.model_reasoning_effort)),
    },
    source: {
      myAgentHome,
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
  const myAgentHome = getDefaultMyAgentHomeDir();
  const configPath = join(myAgentHome, "config.toml");
  const authPath = join(myAgentHome, "auth.json");
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

  const auth = existsSync(authPath) ? parseMyAgentAuth(readFileSync(authPath, "utf8")) : {};
  auth.OPENAI_API_KEY = provider.apiKey;
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}

export function ensureStoredProviderConfig(provider: ProviderProfile): void {
  const configPath = join(getDefaultMyAgentHomeDir(), "config.toml");
  const authPath = join(getDefaultMyAgentHomeDir(), "auth.json");

  if (existsSync(configPath) && existsSync(authPath)) {
    return;
  }

  syncStoredProviderConfig(provider);
}

export function watchStoredConfig(onChange: () => void): () => void {
  const myAgentHome = getDefaultMyAgentHomeDir();
  mkdirSync(myAgentHome, { recursive: true });

  let timer: NodeJS.Timeout | undefined;
  let snapshot = readStoredConfigSnapshot(myAgentHome);
  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      const nextSnapshot = readStoredConfigSnapshot(myAgentHome);
      if (nextSnapshot === snapshot) {
        return;
      }
      snapshot = nextSnapshot;
      onChange();
    }, 50);
    timer.unref?.();
  };

  const watcher = watch(myAgentHome, (_eventType, filename) => {
    if (filename) {
      const normalized = filename.toString().replace(/\\/g, "/").split("/").at(-1);
      if (normalized !== "config.toml" && normalized !== "auth.json") {
        return;
      }
    }
    schedule();
  });

  return () => {
    if (timer) {
      clearTimeout(timer);
    }

    watcher.close();
  };
}

function readStoredConfigSnapshot(myAgentHome: string): string {
  return ["config.toml", "auth.json"]
    .map((fileName) => {
      const path = join(myAgentHome, fileName);
      return existsSync(path) ? `${fileName}:${readFileSync(path, "utf8")}` : `${fileName}:<missing>`;
    })
    .join("\n");
}

export function getDefaultMyAgentHomeDir(): string {
  return process.env.MY_AGENT_HOME ?? join(homedir(), ".my-agent");
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

function parseMyAgentAuth(input: string): ParsedMyAgentAuth {
  try {
    return JSON.parse(input) as ParsedMyAgentAuth;
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
        console.warn('[my-agent-config] "ai_sdk" is no longer supported. Falling back to "responses".');
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
    .replace(/^my-agent:/, "")
    .replace(/^codex:/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "default";
}
