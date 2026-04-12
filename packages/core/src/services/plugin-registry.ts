import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type PluginRecord } from "@my-agent/protocol";
import { z } from "zod";
import { findGitRoot } from "../utils/path-utils.js";

export const PLUGIN_MANIFEST_SCHEMA = z.object({
  schemaVersion: z.string().default("1.0"),
  name: z.string().min(1),
  version: z.string().default("0.0.0"),
  enabled: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
  sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  tool: z
    .object({
      name: z.string().min(1),
      description: z.string().min(1),
      parameters: z
        .object({
          type: z.literal("object"),
          properties: z.record(z.string(), z.unknown()).default({}),
          required: z.array(z.string()).optional(),
          additionalProperties: z.boolean().optional(),
        })
        .default({ type: "object", properties: {}, additionalProperties: true }),
    })
    .optional(),
  compatibility: z
    .object({
      protocolVersion: z.string().optional(),
      serverVersion: z.string().optional(),
      notes: z.array(z.string()).optional(),
    })
    .optional(),
});

export type PluginManifest = z.infer<typeof PLUGIN_MANIFEST_SCHEMA>;

export interface DiscoveredPluginEntry {
  record: PluginRecord;
  manifest?: PluginManifest;
}

export function discoverPluginEntries(params: {
  workspaceRoot: string;
  persisted?: PluginRecord[];
  homeDir?: string;
}): DiscoveredPluginEntry[] {
  const persistedById = new Map((params.persisted ?? []).map((plugin) => [plugin.id, plugin]));
  const roots = resolvePluginRoots(params.workspaceRoot, params.homeDir);
  const entries: DiscoveredPluginEntry[] = [];

  for (const root of roots) {
    if (!existsSync(root.path)) {
      continue;
    }

    for (const entry of readdirSync(root.path, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginPath = join(root.path, entry.name);
      const manifestPath = resolvePluginManifestPath(pluginPath);

      if (!manifestPath) {
        continue;
      }

      const id = buildPluginId(manifestPath);
      const existing = persistedById.get(id);
      const now = new Date().toISOString();
      const createdAt = existing?.createdAt ?? now;
      const defaultTrusted = root.source !== "user";

      try {
        const manifest = PLUGIN_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
        const validationErrors = validatePluginManifest(manifest);

        entries.push({
          record: {
            id,
            name: manifest.name,
            version: manifest.version,
            path: pluginPath,
            manifestPath,
            source: root.source,
            enabled: existing?.enabled ?? manifest.enabled !== false,
            trusted: existing?.trusted ?? defaultTrusted,
            capabilities: manifest.capabilities ?? [],
            manifestVersion: manifest.schemaVersion,
            compatibility: manifest.compatibility,
            toolName: manifest.tool?.name,
            sandboxMode: manifest.sandboxMode,
            command: manifest.command,
            args: manifest.args,
            validationErrors,
            createdAt,
            updatedAt: now,
          },
          manifest,
        });
      } catch (error) {
        entries.push({
          record: {
            id,
            name: existing?.name ?? entry.name,
            version: existing?.version ?? "0.0.0",
            path: pluginPath,
            manifestPath,
            source: root.source,
            enabled: existing?.enabled ?? false,
            trusted: existing?.trusted ?? defaultTrusted,
            capabilities: existing?.capabilities ?? [],
            manifestVersion: existing?.manifestVersion,
            compatibility: existing?.compatibility,
            toolName: existing?.toolName,
            sandboxMode: existing?.sandboxMode,
            command: existing?.command,
            args: existing?.args,
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

function resolvePluginRoots(workspaceRoot: string, homeDir = join(homedir(), ".my-agent")): Array<{ source: PluginRecord["source"]; path: string }> {
  const roots: Array<{ source: PluginRecord["source"]; path: string }> = [
    { source: "user", path: join(homeDir, "plugins") },
    { source: "catalog", path: join(homeDir, "catalogs", "plugins") },
  ];
  const repoRoot = findGitRoot(workspaceRoot);

  if (repoRoot) {
    roots.push({ source: "repo", path: join(repoRoot, ".agents", "plugins") });
    roots.push({ source: "repo", path: join(repoRoot, ".codex", "plugins") });
  }

  return roots;
}

function resolvePluginManifestPath(pluginPath: string): string | undefined {
  const candidates = [join(pluginPath, ".codex-plugin", "plugin.json"), join(pluginPath, "plugin.json")];
  return candidates.find((candidate) => existsSync(candidate));
}

function validatePluginManifest(manifest: PluginManifest): string[] {
  const errors: string[] = [];

  if (!manifest.schemaVersion.startsWith("1.")) {
    errors.push(`Unsupported plugin schemaVersion: ${manifest.schemaVersion}`);
  }

  if (!manifest.command?.trim()) {
    errors.push("Missing plugin command.");
  }

  if (!manifest.tool) {
    errors.push("Missing plugin tool declaration.");
  }

  return errors;
}

function buildPluginId(manifestPath: string): string {
  return `plugin_${createHash("sha256").update(manifestPath).digest("hex").slice(0, 24)}`;
}

function formatDiscoveryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
