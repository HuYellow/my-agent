import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type InternalToolRecord } from "@my-agent/protocol";
import { z } from "zod";
import { findGitRoot } from "../utils/path-utils.js";

export const INTERNAL_TOOL_MANIFEST_SCHEMA = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST"]).default("POST"),
  enabled: z.boolean().optional(),
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

export type InternalToolManifest = z.infer<typeof INTERNAL_TOOL_MANIFEST_SCHEMA>;

export interface DiscoveredInternalToolEntry {
  record: InternalToolRecord;
  manifest?: InternalToolManifest;
}

export function discoverInternalToolEntries(params: {
  workspaceRoot: string;
  persisted?: InternalToolRecord[];
  homeDir?: string;
}): DiscoveredInternalToolEntry[] {
  const persistedById = new Map((params.persisted ?? []).map((tool) => [tool.id, tool]));
  const roots = resolveInternalToolRoots(params.workspaceRoot, params.homeDir);
  const entries: DiscoveredInternalToolEntry[] = [];

  for (const root of roots) {
    if (!existsSync(root.path)) {
      continue;
    }

    for (const entry of readdirSync(root.path, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const manifestPath = join(root.path, entry.name);
      const id = buildInternalToolId(manifestPath);
      const existing = persistedById.get(id);
      const now = new Date().toISOString();
      const createdAt = existing?.createdAt ?? now;

      try {
        const manifest = INTERNAL_TOOL_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

        entries.push({
          record: {
            id,
            name: manifest.name,
            description: manifest.description,
            path: manifestPath,
            source: root.source,
            enabled: existing?.enabled ?? manifest.enabled !== false,
            endpoint: manifest.endpoint,
            method: manifest.method,
            timeoutMs: manifest.timeoutMs ?? 30_000,
            approvalRequired: manifest.approval.required,
            approvalReason: manifest.approval.reason,
            writes: manifest.approval.writes,
            network: manifest.approval.network,
            parametersSchema: manifest.parameters,
            validationErrors: [],
            createdAt,
            updatedAt: now,
          },
          manifest,
        });
      } catch (error) {
        entries.push({
          record: {
            id,
            name: existing?.name ?? entry.name.replace(/\.json$/i, ""),
            description: existing?.description ?? "Invalid internal tool manifest.",
            path: manifestPath,
            source: root.source,
            enabled: existing?.enabled ?? false,
            endpoint: existing?.endpoint,
            method: existing?.method,
            timeoutMs: existing?.timeoutMs,
            approvalRequired: existing?.approvalRequired ?? true,
            approvalReason: existing?.approvalReason,
            writes: existing?.writes ?? false,
            network: existing?.network ?? true,
            parametersSchema: existing?.parametersSchema,
            validationErrors: [formatDiscoveryError(error)],
            createdAt,
            updatedAt: now,
          },
        });
      }
    }
  }

  return entries.sort((left, right) => left.record.name.localeCompare(right.record.name));
}

function resolveInternalToolRoots(
  workspaceRoot: string,
  homeDir = process.env.MY_AGENT_HOME ?? join(homedir(), ".my-agent"),
): Array<{ source: InternalToolRecord["source"]; path: string }> {
  const roots = new Map<string, InternalToolRecord["source"]>();
  roots.set(join(homeDir, "internal-tools"), "user");
  const repoRoot = findGitRoot(workspaceRoot);

  if (repoRoot) {
    roots.set(join(repoRoot, ".agents", "internal-tools"), "repo");
  } else {
    roots.set(join(workspaceRoot, ".agents", "internal-tools"), "repo");
  }

  return [...roots.entries()].map(([path, source]) => ({ path, source }));
}

function buildInternalToolId(manifestPath: string): string {
  return `internal_tool_${Buffer.from(manifestPath).toString("base64url").slice(0, 16)}`;
}

function formatDiscoveryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
