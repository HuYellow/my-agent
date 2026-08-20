import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { type PluginComponentRecord, type PluginFormat, type PluginInstallSourceRecord, type PluginRecord } from "@yellow-flow/protocol";
import { z } from "zod";
import { findGitRoot } from "../utils/path-utils.js";

const TOOL_SCHEMA = z
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
  .optional();

export const PLUGIN_MANIFEST_SCHEMA = z.object({
  schemaVersion: z.string().default("1.0"),
  name: z.string().min(1),
  version: z.string().default("0.0.0"),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
  sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  tool: TOOL_SCHEMA,
  compatibility: z
    .object({
      protocolVersion: z.string().optional(),
      serverVersion: z.string().optional(),
      notes: z.array(z.string()).optional(),
    })
    .optional(),
  skills: z.string().optional(),
  hooks: z.string().optional(),
  mcpServers: z.string().optional(),
  apps: z.string().optional(),
  interface: z
    .object({
      displayName: z.string().optional(),
      shortDescription: z.string().optional(),
      longDescription: z.string().optional(),
      developerName: z.string().optional(),
      category: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      brandColor: z.string().optional(),
    })
    .optional(),
});

export type PluginManifest = z.infer<typeof PLUGIN_MANIFEST_SCHEMA>;

export interface DiscoveredPluginEntry {
  record: PluginRecord;
  manifest?: PluginManifest;
  toolNames?: string[];
}

interface PluginRoot {
  source: PluginRecord["source"];
  path: string;
  formatHint?: PluginFormat;
}

interface OpenCodeEntrypoint {
  pluginPath: string;
  manifestPath: string;
  packageName?: string;
  version?: string;
  installSource?: PluginInstallSourceRecord;
}

interface MarketplacePlugin {
  name?: string;
  category?: string;
  policy?: {
    installation?: string;
    authentication?: string;
  };
  source?: {
    source?: string;
    path?: string;
    url?: string;
    ref?: string;
  };
}

interface MarketplaceManifest {
  name?: string;
  interface?: {
    displayName?: string;
  };
  plugins?: MarketplacePlugin[];
}

export function discoverPluginEntries(params: {
  workspaceRoot: string;
  persisted?: PluginRecord[];
  homeDir?: string;
  additionalOpenCodePackages?: string[];
}): DiscoveredPluginEntry[] {
  const persistedById = new Map((params.persisted ?? []).map((plugin) => [plugin.id, plugin]));
  const roots = resolvePluginRoots(params.workspaceRoot, params.homeDir);
  const npmPackages = collectOpenCodeNpmPackages(params.workspaceRoot, params.homeDir, params.persisted ?? [], params.additionalOpenCodePackages ?? []);
  const entries: DiscoveredPluginEntry[] = [];

  for (const root of roots) {
    if (!existsSync(root.path)) {
      continue;
    }

    if (root.formatHint === "opencode") {
      entries.push(...discoverOpenCodePlugins(root, persistedById, npmPackages));
      continue;
    }

    for (const entry of readdirSync(root.path, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginPath = join(root.path, entry.name);
      const manifestPath = resolvePluginManifestPath(pluginPath);

      if (manifestPath) {
        entries.push(readManifestEntry(pluginPath, manifestPath, root.source, persistedById));
        continue;
      }

      for (const nested of discoverNestedManifestEntries(pluginPath)) {
        entries.push(readManifestEntry(nested.pluginPath, nested.manifestPath, root.source, persistedById));
      }
    }
  }

  entries.push(...discoverMarketplaceEntries(params.workspaceRoot, params.homeDir, persistedById));

  return markToolNameCollisions(dedupeEntries(entries)).sort((left, right) => left.record.name.localeCompare(right.record.name));
}

export function resolvePluginSkillRoots(plugin: PluginRecord): string[] {
  if (!isPluginRunnable(plugin) || plugin.format === "opencode") {
    return [];
  }

  const manifest = readManifest(plugin.manifestPath);
  if (!manifest) {
    return [];
  }

  const skillRoot = manifest.skills ? resolvePluginPath(plugin.path, manifest.skills) : undefined;
  return skillRoot && existsSync(skillRoot) ? [skillRoot] : [];
}

export function resolvePluginMcpMounts(plugin: PluginRecord): Array<{ name: string; command: string; args?: string[] }> {
  if (!isPluginRunnable(plugin) || plugin.format === "opencode") {
    return [];
  }

  const manifest = readManifest(plugin.manifestPath);
  if (!manifest?.mcpServers) {
    return [];
  }

  const mcpPath = resolvePluginPath(plugin.path, manifest.mcpServers);
  if (!existsSync(mcpPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(mcpPath, "utf8")) as { mcpServers?: Record<string, { command?: string; args?: string[] }> };
    return Object.entries(parsed.mcpServers ?? {}).flatMap(([name, server]) => {
      if (!server.command) {
        return [];
      }

      return [
        {
          name,
          command: resolveCommandPath(plugin.path, server.command),
          args: Array.isArray(server.args) ? server.args.map((arg) => resolvePluginArg(plugin.path, arg)) : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function isPluginRunnable(plugin: PluginRecord): boolean {
  return plugin.enabled && plugin.trusted && plugin.validationErrors.length === 0;
}

function discoverOpenCodePlugins(root: PluginRoot, persistedById: Map<string, PluginRecord>, npmPackages: Set<string>): DiscoveredPluginEntry[] {
  const entries: DiscoveredPluginEntry[] = [];
  const entrypoints = basename(root.path) === "node_modules" ? discoverOpenCodeNpmEntrypoints(root.path, npmPackages) : discoverOpenCodeFileEntrypoints(root.path);

  for (const entrypoint of entrypoints) {
    const id = buildPluginId(entrypoint.pluginPath);
    const existing = persistedById.get(id);
    const now = new Date().toISOString();
    const metadata = readOpenCodeStaticMetadata(entrypoint.pluginPath);
    const name = entrypoint.packageName ?? basename(entrypoint.pluginPath, extname(entrypoint.pluginPath));
    const source = entrypoint.installSource?.source === "npm" ? "user" : root.source;
    const trusted = existing?.trusted ?? (entrypoint.installSource?.source === "npm" ? false : source !== "user");

    entries.push({
      record: {
        id,
        name,
        version: existing?.version ?? entrypoint.version ?? "0.0.0",
        path: entrypoint.pluginPath,
        manifestPath: entrypoint.manifestPath,
        source,
        enabled: existing?.enabled ?? true,
        trusted,
        capabilities: existing?.capabilities ?? [],
        format: "opencode",
        installSource: existing?.installSource ?? entrypoint.installSource,
        display: existing?.display,
        components: { skills: 0, mcpServers: 0, tools: metadata.toolNames.length, hooks: metadata.hookNames.length },
        hookNames: metadata.hookNames,
        validationErrors: existing?.validationErrors ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      toolNames: metadata.toolNames,
    });
  }

  return entries;
}

function discoverOpenCodeFileEntrypoints(rootPath: string): OpenCodeEntrypoint[] {
  const entrypoints: OpenCodeEntrypoint[] = [];

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.isFile() && isOpenCodePluginFile(entry.name)) {
      const pluginPath = join(rootPath, entry.name);
      entrypoints.push({ pluginPath, manifestPath: pluginPath });
    }
  }

  return entrypoints;
}

function discoverOpenCodeNpmEntrypoints(nodeModulesPath: string, packageNames: Set<string>): OpenCodeEntrypoint[] {
  const entrypoints: OpenCodeEntrypoint[] = [];

  for (const packageName of packageNames) {
    const packageRoot = resolveNodeModulePackageRoot(nodeModulesPath, packageName);
    const entrypoint = resolvePackageEntrypoint(packageRoot, packageName);

    if (entrypoint) {
      entrypoints.push(entrypoint);
    }
  }

  return entrypoints;
}

function resolvePackageEntrypoint(packageRoot: string, packageName: string): OpenCodeEntrypoint | null {
  const packageJsonPath = join(packageRoot, "package.json");
  let packageJson: Record<string, unknown> = {};

  if (!existsSync(packageRoot) || !existsSync(packageJsonPath)) {
    return null;
  }

  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    packageJson = {};
  }

  const candidates = [
    pickPackageEntrypoint(packageJson.opencode),
    pickPackageEntrypoint(packageJson.main),
    pickPackageEntrypoint(packageJson.module),
    pickPackageEntrypoint(packageJson.exports),
    "index.ts",
    "index.js",
    "index.mjs",
    join("dist", "index.ts"),
    join("dist", "index.js"),
    join("dist", "index.mjs"),
    join("src", "index.ts"),
    join("src", "index.js"),
    join("src", "index.mjs"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const pluginPath = resolve(packageRoot, candidate);

    if (existsSync(pluginPath) && isOpenCodePluginFile(pluginPath)) {
      return {
        pluginPath,
        manifestPath: packageJsonPath,
        packageName: typeof packageJson.name === "string" ? packageJson.name : packageName,
        version: typeof packageJson.version === "string" ? packageJson.version : undefined,
        installSource: {
          source: "npm",
          packageName,
        },
      };
    }
  }

  return null;
}

function readManifestEntry(
  pluginPath: string,
  manifestPath: string,
  source: PluginRecord["source"],
  persistedById: Map<string, PluginRecord>,
  overrides: Partial<PluginRecord> = {},
): DiscoveredPluginEntry {
  const id = buildPluginId(manifestPath);
  const existing = persistedById.get(id);
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt ?? now;
  const defaultTrusted = source !== "user";

  try {
    const manifest = PLUGIN_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    const format = detectManifestFormat(manifest);
    const components = buildPluginComponents(pluginPath, manifest, format);
    const validationErrors = validatePluginManifest(manifest, components, format);

    return {
      record: {
        id,
        name: manifest.name,
        version: manifest.version,
        path: pluginPath,
        manifestPath,
        source,
        enabled: existing?.enabled ?? overrides.enabled ?? manifest.enabled !== false,
        trusted: existing?.trusted ?? overrides.trusted ?? defaultTrusted,
        capabilities: manifest.capabilities ?? manifest.interface?.capabilities ?? [],
        manifestVersion: manifest.schemaVersion,
        compatibility: manifest.compatibility,
        toolName: manifest.tool?.name,
        sandboxMode: manifest.sandboxMode,
        command: manifest.command,
        args: manifest.args,
        format,
        installSource: existing?.installSource ?? overrides.installSource,
        display: buildPluginDisplay(manifest),
        components,
        hookNames: existing?.hookNames ?? [],
        marketplaceName: overrides.marketplaceName,
        marketplaceCategory: overrides.marketplaceCategory,
        validationErrors,
        createdAt,
        updatedAt: now,
      },
      manifest,
      toolNames: manifest.tool?.name ? [manifest.tool.name] : [],
    };
  } catch (error) {
    return {
      record: {
        id,
        name: existing?.name ?? basename(pluginPath),
        version: existing?.version ?? "0.0.0",
        path: pluginPath,
        manifestPath,
        source,
        enabled: existing?.enabled ?? false,
        trusted: existing?.trusted ?? defaultTrusted,
        capabilities: existing?.capabilities ?? [],
        manifestVersion: existing?.manifestVersion,
        compatibility: existing?.compatibility,
        toolName: existing?.toolName,
        sandboxMode: existing?.sandboxMode,
        command: existing?.command,
        args: existing?.args,
        format: existing?.format,
        installSource: existing?.installSource ?? overrides.installSource,
        display: existing?.display,
        components: existing?.components,
        hookNames: existing?.hookNames,
        marketplaceName: overrides.marketplaceName,
        marketplaceCategory: overrides.marketplaceCategory,
        validationErrors: [formatDiscoveryError(error)],
        createdAt,
        updatedAt: now,
      },
    };
  }
}

function discoverMarketplaceEntries(
  workspaceRoot: string,
  homeDir: string | undefined,
  persistedById: Map<string, PluginRecord>,
): DiscoveredPluginEntry[] {
  const repoRoot = findGitRoot(workspaceRoot);
  const resolvedHome = homeDir ?? join(homedir(), ".yellow-flow");
  const candidates: Array<{ path: string; baseRoot: string; source: PluginRecord["source"] }> = [];

  if (repoRoot) {
    candidates.push({ path: join(repoRoot, ".agents", "plugins", "marketplace.json"), baseRoot: repoRoot, source: "repo" });
  }

  candidates.push({ path: join(homedir(), ".agents", "plugins", "marketplace.json"), baseRoot: homedir(), source: "user" });
  candidates.push({ path: join(resolvedHome, "catalogs", "plugins", "marketplace.json"), baseRoot: join(resolvedHome, "catalogs"), source: "catalog" });

  return candidates.flatMap((candidate) => discoverMarketplaceFile(candidate.path, candidate.baseRoot, candidate.source, persistedById));
}

function discoverMarketplaceFile(
  marketplacePath: string,
  baseRoot: string,
  source: PluginRecord["source"],
  persistedById: Map<string, PluginRecord>,
): DiscoveredPluginEntry[] {
  if (!existsSync(marketplacePath)) {
    return [];
  }

  try {
    const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8")) as MarketplaceManifest;
    const marketplaceName = marketplace.name ?? basename(dirname(marketplacePath));
    return (marketplace.plugins ?? []).flatMap((plugin) => {
      if (!plugin.name || !plugin.source?.source) {
        return [];
      }

      if (plugin.source.source === "local" && plugin.source.path) {
        const pluginPath = resolve(baseRoot, plugin.source.path);
        const manifestPath = resolvePluginManifestPath(pluginPath);
        if (!manifestPath) {
          return [];
        }

        return [
          readManifestEntry(pluginPath, manifestPath, source, persistedById, {
            installSource: { source: "local", path: pluginPath },
            marketplaceName,
            marketplaceCategory: plugin.category,
          }),
        ];
      }

      if (plugin.source.source === "git" && plugin.source.url) {
        const installSource: PluginInstallSourceRecord = { source: "git", url: plugin.source.url, ref: plugin.source.ref };
        const id = buildPluginId(`${marketplacePath}:${plugin.name}:${plugin.source.url}`);
        const existing = persistedById.get(id);
        const now = new Date().toISOString();
        return [
          {
            record: {
              id,
              name: plugin.name,
              version: existing?.version ?? "0.0.0",
              path: existing?.path ?? "",
              manifestPath: marketplacePath,
              source,
              enabled: existing?.enabled ?? false,
              trusted: existing?.trusted ?? false,
              capabilities: existing?.capabilities ?? [],
              format: "codex",
              installSource,
              display: {
                displayName: plugin.name,
                category: plugin.category,
              },
              components: existing?.components ?? { skills: 0, mcpServers: 0, tools: 0, hooks: 0 },
              marketplaceName,
              marketplaceCategory: plugin.category,
              validationErrors: existing?.validationErrors ?? [],
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            },
          },
        ];
      }

      return [];
    });
  } catch {
    return [];
  }
}

function resolvePluginRoots(workspaceRoot: string, homeDir = join(homedir(), ".yellow-flow")): PluginRoot[] {
  const roots: PluginRoot[] = [
    { source: "user", path: join(homeDir, "plugins") },
    { source: "catalog", path: join(homeDir, "catalogs", "plugins") },
    { source: "user", path: join(homeDir, "opencode-plugins", "plugins"), formatHint: "opencode" },
    { source: "user", path: join(homeDir, "opencode-plugins", "node_modules"), formatHint: "opencode" },
  ];
  const repoRoot = findGitRoot(workspaceRoot);

  if (repoRoot) {
    roots.push({ source: "repo", path: join(repoRoot, ".agents", "plugins") });
    roots.push({ source: "repo", path: join(repoRoot, ".codex", "plugins") });
    roots.push({ source: "repo", path: join(repoRoot, ".opencode", "plugins"), formatHint: "opencode" });
  } else {
    roots.push({ source: "repo", path: join(workspaceRoot, ".opencode", "plugins"), formatHint: "opencode" });
  }

  return roots;
}

function discoverNestedManifestEntries(pluginPath: string): Array<{ pluginPath: string; manifestPath: string }> {
  const entries: Array<{ pluginPath: string; manifestPath: string }> = [];

  for (const nested of readdirSync(pluginPath, { withFileTypes: true })) {
    if (!nested.isDirectory()) {
      continue;
    }

    const nestedPluginPath = join(pluginPath, nested.name);
    const manifestPath = resolvePluginManifestPath(nestedPluginPath);

    if (manifestPath) {
      entries.push({ pluginPath: nestedPluginPath, manifestPath });
    }
  }

  return entries;
}

function collectOpenCodeNpmPackages(
  workspaceRoot: string,
  homeDir: string | undefined,
  persisted: PluginRecord[],
  additionalPackages: string[],
): Set<string> {
  const packages = new Set(additionalPackages);

  for (const plugin of persisted) {
    if (plugin.installSource?.source === "npm") {
      packages.add(plugin.installSource.packageName);
    }
  }

  const repoRoot = findGitRoot(workspaceRoot) ?? workspaceRoot;
  const configCandidates = [
    join(repoRoot, "opencode.json"),
    join(repoRoot, ".opencode", "opencode.json"),
    join(homeDir ?? join(homedir(), ".yellow-flow"), "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const configPath of configCandidates) {
    for (const packageName of readOpenCodeConfigPackageNames(configPath)) {
      packages.add(packageName);
    }
  }

  return packages;
}

function readOpenCodeConfigPackageNames(configPath: string): string[] {
  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const rawPlugins = Array.isArray(parsed.plugin) ? parsed.plugin : Array.isArray(parsed.plugins) ? parsed.plugins : [];
    return rawPlugins.flatMap((entry) => {
      if (typeof entry === "string") {
        return isNpmPackageName(entry) ? [entry] : [];
      }

      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>;
        const packageName = typeof record.packageName === "string" ? record.packageName : typeof record.package === "string" ? record.package : undefined;
        return packageName && isNpmPackageName(packageName) ? [packageName] : [];
      }

      return [];
    });
  } catch {
    return [];
  }
}

function readOpenCodeStaticMetadata(pluginPath: string): { toolNames: string[]; hookNames: string[] } {
  const text = readTextIfPossible(pluginPath);
  const toolNames = [...new Set(extractOpenCodeToolNames(text))];
  const hookNames = ["tool.execute.before", "tool.execute.after", "shell.env"].filter((hookName) => text.includes(hookName));
  return { toolNames, hookNames };
}

function extractOpenCodeToolNames(text: string): string[] {
  const names: string[] = [];
  const pattern = /\btools?\s*:\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const openBraceIndex = text.indexOf("{", match.index);
    const closeBraceIndex = findMatchingBrace(text, openBraceIndex);

    if (closeBraceIndex === -1) {
      continue;
    }

    names.push(...extractTopLevelObjectKeys(text.slice(openBraceIndex + 1, closeBraceIndex)));
    pattern.lastIndex = closeBraceIndex + 1;
  }

  return names;
}

function extractTopLevelObjectKeys(text: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let stringQuote: string | null = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      if (depth === 0 && (char === "'" || char === '"')) {
        const keyEnd = findStringEnd(text, index, char);
        const key = text.slice(index + 1, keyEnd);
        const colonIndex = skipWhitespace(text, keyEnd + 1);
        if (text[colonIndex] === ":") {
          keys.push(key);
        }
        index = keyEnd;
        continue;
      }
      stringQuote = char;
      continue;
    }

    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]" || char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && /[A-Za-z_$]/.test(char)) {
      const start = index;
      while (index + 1 < text.length && /[A-Za-z0-9_$-]/.test(text[index + 1]!)) {
        index += 1;
      }
      const key = text.slice(start, index + 1);
      const colonIndex = skipWhitespace(text, index + 1);
      if (text[colonIndex] === ":") {
        keys.push(key);
      }
    }
  }

  return keys;
}

function findMatchingBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  let stringQuote: string | null = null;
  let escaped = false;

  for (let index = openBraceIndex; index < text.length; index += 1) {
    const char = text[index]!;

    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      stringQuote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findStringEnd(text: string, start: number, quote: string): number {
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      return index;
    }
  }

  return text.length - 1;
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

function markToolNameCollisions(entries: DiscoveredPluginEntry[]): DiscoveredPluginEntry[] {
  const toolOwners = new Map<string, DiscoveredPluginEntry[]>();
  const reservedToolNames = new Set(["read_file", "write_patch", "apply_patch", "run_shell"]);

  for (const entry of entries) {
    const toolNames = entry.toolNames ?? (entry.record.toolName ? [entry.record.toolName] : []);
    for (const toolName of toolNames) {
      const normalized = toolName.trim();
      if (!normalized) {
        continue;
      }
      toolOwners.set(normalized, [...(toolOwners.get(normalized) ?? []), entry]);
    }
  }

  for (const [toolName, owners] of toolOwners) {
    if (owners.length <= 1 && !reservedToolNames.has(toolName)) {
      continue;
    }

    for (const owner of owners) {
      owner.record = addValidationError(owner.record, `Tool name collision: ${toolName}`);
    }
  }

  return entries;
}

function addValidationError(record: PluginRecord, error: string): PluginRecord {
  return {
    ...record,
    validationErrors: [...new Set([...record.validationErrors, error])],
  };
}

function resolvePluginManifestPath(pluginPath: string): string | undefined {
  const candidates = [join(pluginPath, ".codex-plugin", "plugin.json"), join(pluginPath, "plugin.json")];
  return candidates.find((candidate) => existsSync(candidate));
}

function detectManifestFormat(manifest: PluginManifest): PluginFormat {
  if (manifest.command || manifest.tool) {
    return "yellow-flow";
  }

  return "codex";
}

function buildPluginComponents(pluginPath: string, manifest: PluginManifest, format: PluginFormat): PluginComponentRecord {
  return {
    skills: manifest.skills ? countSkillComponents(resolvePluginPath(pluginPath, manifest.skills)) : 0,
    mcpServers: manifest.mcpServers ? countMcpServers(resolvePluginPath(pluginPath, manifest.mcpServers)) : 0,
    tools: manifest.tool ? 1 : 0,
    hooks: manifest.hooks ? 1 : 0,
    apps: manifest.apps ? 1 : undefined,
  };
}

function validatePluginManifest(manifest: PluginManifest, components: PluginComponentRecord, format: PluginFormat): string[] {
  const errors: string[] = [];

  if (!manifest.schemaVersion.startsWith("1.")) {
    errors.push(`Unsupported plugin schemaVersion: ${manifest.schemaVersion}`);
  }

  const hasCodexComponents = components.skills > 0 || components.mcpServers > 0 || components.hooks > 0 || Boolean(components.apps) || Boolean(manifest.interface);

  if (format === "yellow-flow" || !hasCodexComponents) {
    if (!manifest.command?.trim()) {
      errors.push("Missing plugin command.");
    }

    if (!manifest.tool) {
      errors.push("Missing plugin tool declaration.");
    }
  }

  return errors;
}

function buildPluginDisplay(manifest: PluginManifest): PluginRecord["display"] {
  if (!manifest.interface) {
    return manifest.description ? { shortDescription: manifest.description } : undefined;
  }

  return {
    displayName: manifest.interface.displayName,
    shortDescription: manifest.interface.shortDescription ?? manifest.description,
    longDescription: manifest.interface.longDescription,
    developerName: manifest.interface.developerName,
    category: manifest.interface.category,
    brandColor: manifest.interface.brandColor,
  };
}

function countSkillComponents(skillRoot: string): number {
  if (!existsSync(skillRoot)) {
    return 0;
  }

  return readdirSync(skillRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(skillRoot, entry.name, "SKILL.md"))).length;
}

function countMcpServers(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
    return Object.keys(parsed.mcpServers ?? {}).length;
  } catch {
    return 0;
  }
}

function readManifest(path: string): PluginManifest | null {
  try {
    return PLUGIN_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function resolvePluginPath(pluginPath: string, path: string): string {
  return resolve(pluginPath, path.replace(/^\.\//, ""));
}

function resolveCommandPath(pluginPath: string, command: string): string {
  return command.startsWith("./") || command.startsWith("../") ? resolvePluginPath(pluginPath, command) : command;
}

function resolvePluginArg(pluginPath: string, arg: string): string {
  return arg.startsWith("./") || arg.startsWith("../") ? resolvePluginPath(pluginPath, arg) : arg;
}

function dedupeEntries(entries: DiscoveredPluginEntry[]): DiscoveredPluginEntry[] {
  const byId = new Map<string, DiscoveredPluginEntry>();

  for (const entry of entries) {
    byId.set(entry.record.id, entry);
  }

  return [...byId.values()];
}

function resolveNodeModulePackageRoot(nodeModulesPath: string, packageName: string): string {
  return join(nodeModulesPath, ...packageName.split("/"));
}

function pickPackageEntrypoint(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return pickPackageEntrypoint(record.import) ?? pickPackageEntrypoint(record.default) ?? pickPackageEntrypoint(record["."]);
  }

  return undefined;
}

function isOpenCodePluginFile(path: string): boolean {
  return [".js", ".mjs", ".ts"].includes(extname(path));
}

function isNpmPackageName(value: string): boolean {
  return !value.startsWith(".") && !value.includes("\\") && (value.startsWith("@") ? value.split("/").length === 2 : !value.includes("/"));
}

function readTextIfPossible(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function buildPluginId(value: string): string {
  return `plugin_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function formatDiscoveryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
