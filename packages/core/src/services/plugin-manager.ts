import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type PluginRecord, type ProjectRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { findGitRoot } from "../utils/path-utils.js";

export class PluginManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (plugin: PluginRecord) => void,
  ) {}

  list(project?: ProjectRecord): PluginRecord[] {
    const discovered = discoverPlugins(project);

    for (const plugin of discovered) {
      this.database.upsertPlugin(plugin);
      this.emit(plugin);
    }

    return this.database.listPlugins();
  }
}

function discoverPlugins(project?: ProjectRecord): PluginRecord[] {
  const roots: Array<{ source: PluginRecord["source"]; path: string }> = [
    { source: "user", path: join(homedir(), ".my-agent", "plugins") },
  ];
  const repoRoot = project ? findGitRoot(project.rootPath) : undefined;

  if (repoRoot) {
    roots.push({ source: "repo", path: join(repoRoot, ".agents", "plugins") });
    roots.push({ source: "repo", path: join(repoRoot, ".codex", "plugins") });
  }

  return roots.flatMap((root) => loadPluginDirectory(root.path, root.source));
}

function loadPluginDirectory(rootPath: string, source: PluginRecord["source"]): PluginRecord[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => parsePluginManifest(join(rootPath, entry.name), source))
    .filter((entry): entry is PluginRecord => Boolean(entry));
}

function parsePluginManifest(pluginPath: string, source: PluginRecord["source"]): PluginRecord | null {
  const candidates = [join(pluginPath, ".codex-plugin", "plugin.json"), join(pluginPath, "plugin.json")];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));

  if (!manifestPath) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const now = new Date().toISOString();

  return {
    id: `plugin_${Buffer.from(manifestPath).toString("base64url").slice(0, 16)}`,
    name: typeof parsed.name === "string" ? parsed.name : pluginPath.split(/[\\/]/).pop() ?? "plugin",
    version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
    path: pluginPath,
    source,
    enabled: parsed.enabled !== false,
    capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.map((entry) => String(entry)) : [],
    createdAt: now,
    updatedAt: now,
  };
}
