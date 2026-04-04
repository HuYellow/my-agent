import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type WorkspaceProfile } from "@my-agent/protocol";
import { z } from "zod";
import { findGitRoot } from "../utils/path-utils.js";
import { type JsonSchemaObject, type RuntimeToolDefinition, type ToolProvider } from "./types.js";

const INTERNAL_TOOL_MANIFEST_SCHEMA = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST"]).default("POST"),
  headers: z.record(z.string(), z.string()).optional(),
  parameters: z
    .object({
      type: z.literal("object"),
      properties: z.record(z.string(), z.unknown()).default({}),
      required: z.array(z.string()).optional(),
      additionalProperties: z.boolean().optional(),
      description: z.string().optional(),
    })
    .default({
      type: "object",
      properties: {},
      additionalProperties: true,
    }),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  approval: z
    .object({
      required: z.boolean().default(true),
      reason: z.string().optional(),
      writes: z.boolean().default(false),
      network: z.boolean().default(true),
    })
    .default({
      required: true,
      writes: false,
      network: true,
    }),
});

type InternalToolManifest = z.infer<typeof INTERNAL_TOOL_MANIFEST_SCHEMA>;

export class InternalToolProvider implements ToolProvider {
  constructor(private readonly homeDir = process.env.MY_AGENT_HOME ?? join(homedir(), ".my-agent")) {}

  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    return this.loadManifests(workspace).map((manifest) => ({
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.parameters as JsonSchemaObject,
      strict: true,
      source: "internal" as const,
      parseArgs: (input) => parseManifestArgs(manifest, input),
      buildDescriptor: (args) => ({
        source: "internal",
        preview: `${manifest.name} -> ${manifest.endpoint}`,
        scopeKey: `${manifest.name}:${JSON.stringify(args)}`,
        risky: manifest.approval.required,
        writes: manifest.approval.writes,
        network: manifest.approval.network,
        approvalReason: manifest.approval.reason ?? `Internal tool ${manifest.name} requires approval.`,
      }),
      execute: async (args, context) => executeManifest(manifest, args, context.signal),
    }));
  }

  private loadManifests(workspace: WorkspaceProfile): InternalToolManifest[] {
    const roots = new Set<string>([join(this.homeDir, "internal-tools")]);
    const repoRoot = findGitRoot(workspace.rootPath);

    if (repoRoot) {
      roots.add(join(repoRoot, ".agents", "internal-tools"));
    } else {
      roots.add(join(workspace.rootPath, ".agents", "internal-tools"));
    }

    const manifests: InternalToolManifest[] = [];

    for (const root of roots) {
      if (!existsSync(root)) {
        continue;
      }

      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }

        const absolute = join(root, entry.name);

        try {
          const parsed = INTERNAL_TOOL_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(absolute, "utf8")));
          manifests.push(parsed);
        } catch (error) {
          console.warn(`[internal-tools] Skipping invalid manifest ${absolute}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return manifests;
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
  const response = await fetch(url, {
    method: manifest.method,
    headers,
    body,
    signal: combined,
  });
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
