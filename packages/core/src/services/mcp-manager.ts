import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type McpMountRecord, type McpPromptRecord, type McpResourceRecord, type McpSessionRecord, type McpToolRecord } from "@yellow-flow/protocol";
import { HarnessDatabase } from "../store/database.js";
import { McpSessionManager } from "./mcp-session-manager.js";
import { resolvePluginMcpMounts } from "./plugin-registry.js";

export class McpManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (mount: McpMountRecord) => void,
    private readonly emitSession?: (session: McpSessionRecord) => void,
  ) {}

  list(): McpMountRecord[] {
    const discovered = discoverMcpMounts(this.database);

    for (const mount of discovered) {
      this.database.upsertMcpMount(mount);
      this.emit(mount);
    }

    return this.database.listMcpMounts();
  }

  async refreshAll(): Promise<void> {
    const mounts = this.list().filter((mount) => mount.enabled);
    await Promise.all(
      mounts.map(async (mount) => {
        try {
          await this.refreshMount(mount.id);
        } catch {
          // best effort cache refresh
        }
      }),
    );
  }

  listSessions(): McpSessionRecord[] {
    return this.getSessionManager().listSessions();
  }

  async refreshMount(mountId: string): Promise<{ session: McpSessionRecord; tools: McpToolRecord[]; prompts: McpPromptRecord[]; resources: McpResourceRecord[] }> {
    const mount = this.database.listMcpMounts().find((entry) => entry.id === mountId) ?? this.list().find((entry) => entry.id === mountId);

    if (!mount) {
      throw new Error(`MCP mount not found: ${mountId}`);
    }

    return this.getSessionManager().refreshMount(mount);
  }

  getCachedMountData(mountId: string): { tools: McpToolRecord[]; prompts: McpPromptRecord[]; resources: McpResourceRecord[] } {
    return this.getSessionManager().getCachedMountData(mountId);
  }

  async callTool(mountId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const mount = this.database.listMcpMounts().find((entry) => entry.id === mountId) ?? this.list().find((entry) => entry.id === mountId);

    if (!mount) {
      throw new Error(`MCP mount not found: ${mountId}`);
    }

    return this.getSessionManager().callTool(mount, toolName, args);
  }

  async getPrompt(mountId: string, promptName: string, args: Record<string, unknown> = {}): Promise<string> {
    const mount = this.database.listMcpMounts().find((entry) => entry.id === mountId) ?? this.list().find((entry) => entry.id === mountId);

    if (!mount) {
      throw new Error(`MCP mount not found: ${mountId}`);
    }

    return this.getSessionManager().getPrompt(mount, promptName, args);
  }

  async readResource(mountId: string, uri: string): Promise<string> {
    const mount = this.database.listMcpMounts().find((entry) => entry.id === mountId) ?? this.list().find((entry) => entry.id === mountId);

    if (!mount) {
      throw new Error(`MCP mount not found: ${mountId}`);
    }

    return this.getSessionManager().readResource(mount, uri);
  }

  private getSessionManager(): McpSessionManager {
    const runtimeGlobal = globalThis as unknown as { __yellowFlowMcpSessionManager?: McpSessionManager };

    if (!runtimeGlobal.__yellowFlowMcpSessionManager) {
      runtimeGlobal.__yellowFlowMcpSessionManager = new McpSessionManager(
        this.database,
        (session) => this.emitSession?.(session),
      );
    }

    return runtimeGlobal.__yellowFlowMcpSessionManager!;
  }
}

function discoverMcpMounts(database: HarnessDatabase): McpMountRecord[] {
  const configPath = join(homedir(), ".yellow-flow", "mcp.json");
  const now = new Date().toISOString();
  const pluginMounts: McpMountRecord[] = database.listPlugins().flatMap((plugin) =>
    resolvePluginMcpMounts(plugin).map((mount) => ({
      id: `mcp_plugin_${plugin.id}_${normalizeMountName(mount.name)}`,
      name: `${plugin.name}:${mount.name}`,
      transport: "stdio" as const,
      command: mount.command,
      args: mount.args,
      enabled: plugin.enabled && plugin.trusted && plugin.validationErrors.length === 0,
      createdAt: now,
      updatedAt: now,
    })),
  );

  if (!existsSync(configPath)) {
    return pluginMounts;
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { mounts?: Array<Record<string, unknown>> };

  const configured: McpMountRecord[] = (parsed.mounts ?? []).map((mount, index) => ({
    id: typeof mount.id === "string" ? mount.id : `mcp_${index + 1}`,
    name: typeof mount.name === "string" ? mount.name : `mcp-${index + 1}`,
    transport: mount.transport === "http" ? "http" : "stdio",
    command: typeof mount.command === "string" ? mount.command : undefined,
    args: Array.isArray(mount.args) ? mount.args.map((entry) => String(entry)) : undefined,
    url: typeof mount.url === "string" ? mount.url : undefined,
    enabled: mount.enabled !== false,
    createdAt: now,
    updatedAt: now,
  }));

  return [...configured, ...pluginMounts];
}

function normalizeMountName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "server";
}
