import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type McpMountRecord, type McpPromptRecord, type McpResourceRecord, type McpSessionRecord, type McpToolRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { McpSessionManager } from "./mcp-session-manager.js";

export class McpManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (mount: McpMountRecord) => void,
    private readonly emitSession?: (session: McpSessionRecord) => void,
  ) {}

  list(): McpMountRecord[] {
    const discovered = discoverMcpMounts();

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
    const runtimeGlobal = globalThis as unknown as { __myAgentMcpSessionManager?: McpSessionManager };

    if (!runtimeGlobal.__myAgentMcpSessionManager) {
      runtimeGlobal.__myAgentMcpSessionManager = new McpSessionManager(
        this.database,
        (session) => this.emitSession?.(session),
      );
    }

    return runtimeGlobal.__myAgentMcpSessionManager!;
  }
}

function discoverMcpMounts(): McpMountRecord[] {
  const configPath = join(homedir(), ".my-agent", "mcp.json");

  if (!existsSync(configPath)) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { mounts?: Array<Record<string, unknown>> };
  const now = new Date().toISOString();

  return (parsed.mounts ?? []).map((mount, index) => ({
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
}
