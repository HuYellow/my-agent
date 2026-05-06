import { homedir } from "node:os";
import { join } from "node:path";
import { type WorkspaceProfile } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { discoverInternalToolEntries, type InternalToolManifest } from "../services/internal-tool-registry.js";
import { type JsonSchemaObject, type RuntimeToolCapability, type RuntimeToolDefinition, type RuntimeToolSourceMetadata, type ToolProvider } from "./types.js";

export class InternalToolProvider implements ToolProvider {
  constructor(
    private readonly homeDir = process.env.MY_AGENT_HOME ?? join(homedir(), ".my-agent"),
    private readonly database?: HarnessDatabase,
  ) {}

  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    return discoverInternalToolEntries({
      workspaceRoot: workspace.rootPath,
      persisted: this.database?.listInternalTools(),
      homeDir: this.homeDir,
    }).flatMap(({ manifest, record }) => {
      if (!manifest || !record.enabled || record.validationErrors.length > 0) {
        return [];
      }

      const source = buildInternalSource(manifest, record.path);

      return [
        {
          name: manifest.name,
          description: manifest.description,
          parameters: manifest.parameters as JsonSchemaObject,
          strict: true,
          source,
          capability: buildInternalCapability(manifest),
          parseArgs: (input) => parseManifestArgs(manifest, input),
          buildDescriptor: (args) => ({
            source,
            preview: `${manifest.name} -> ${manifest.endpoint}`,
            scopeKey: `${manifest.name}:${JSON.stringify(args)}`,
            risky: manifest.approval.required,
            writes: manifest.approval.writes,
            network: manifest.approval.network,
            timeoutMs: manifest.timeoutMs ?? 30_000,
            approvalReason: manifest.approval.reason ?? `Internal tool ${manifest.name} requires approval.`,
          }),
          execute: async (args, context) => executeManifest(manifest, args, context.signal),
        },
      ];
    });
  }
}

function parseManifestArgs(manifest: InternalToolManifest, input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Internal tool ${manifest.name} expects an object payload.`);
  }

  const record = input as Record<string, unknown>;

  for (const key of manifest.parameters.required ?? []) {
    if (!(key in record)) {
      throw new Error(`Internal tool ${manifest.name} is missing required parameter "${key}".`);
    }
  }

  return record;
}

async function executeManifest(manifest: InternalToolManifest, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {
    ...manifest.headers,
  };

  let url = manifest.endpoint;
  let body: string | undefined;

  if (manifest.method === "GET") {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(args)) {
      search.set(key, stringifyQueryValue(value));
    }

    const target = new URL(manifest.endpoint);
    target.search = search.toString();
    url = target.toString();
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(args);
  }

  const timeoutSignal = AbortSignal.timeout(manifest.timeoutMs ?? 30_000);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response: Response;

  try {
    response = await fetch(url, {
      method: manifest.method,
      headers,
      body,
      signal: combined,
    });
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted) {
      const timeoutError = new Error(`Internal tool ${manifest.name} timed out after ${manifest.timeoutMs ?? 30_000}ms.`);
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }

    throw error;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Internal tool ${manifest.name} failed (${response.status}): ${text}`);
  }

  return text;
}

function stringifyQueryValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function buildInternalSource(manifest: InternalToolManifest, manifestPath: string): RuntimeToolSourceMetadata {
  return {
    type: "internal",
    id: manifest.name,
    label: manifest.name,
    path: manifestPath,
    details: {
      endpoint: manifest.endpoint,
      method: manifest.method,
    },
  };
}

function buildInternalCapability(manifest: InternalToolManifest): RuntimeToolCapability {
  return {
    writes: manifest.approval.writes,
    network: manifest.approval.network,
    interactive: false,
    approvalModes: manifest.approval.required ? ["preflight"] : ["none"],
    riskLevel: manifest.approval.network ? "network" : manifest.approval.writes ? "write" : "safe_read",
    timeoutMs: manifest.timeoutMs ?? 30_000,
    streamedOutput: false,
    resumable: false,
  };
}
