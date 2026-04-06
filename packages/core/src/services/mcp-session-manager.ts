import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { type McpMountRecord, type McpPromptRecord, type McpResourceRecord, type McpSessionRecord, type McpToolRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

interface SessionCache {
  session: McpSessionRecord;
  transport: "stdio" | "http";
  process?: ChildProcessWithoutNullStreams;
  buffer?: string;
  nextId: number;
}

export class McpSessionManager {
  private readonly sessions = new Map<string, SessionCache>();

  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (session: McpSessionRecord) => void,
  ) {}

  listSessions(): McpSessionRecord[] {
    return this.database.listMcpSessions();
  }

  async refreshMount(mount: McpMountRecord): Promise<{ session: McpSessionRecord; tools: McpToolRecord[]; prompts: McpPromptRecord[]; resources: McpResourceRecord[] }> {
    const session = await this.ensureSession(mount);
    const initialized = await this.sendRequest(mount, session, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "my-agent",
        version: "0.1.0",
      },
    });

    if (initialized?.error) {
      throw new Error(initialized.error.message);
    }

    const tools = await this.safeCallList<McpToolRecord[]>(mount, session, "tools/list", "tools");
    const prompts = await this.safeCallList<McpPromptRecord[]>(mount, session, "prompts/list", "prompts");
    const resources = await this.safeCallList<McpResourceRecord[]>(mount, session, "resources/list", "resources");

    this.database.upsertMcpMountCache({
      mountId: mount.id,
      tools,
      prompts,
      resources,
      updatedAt: new Date().toISOString(),
    });

    return {
      session,
      tools,
      prompts,
      resources,
    };
  }

  getCachedMountData(mountId: string): { tools: McpToolRecord[]; prompts: McpPromptRecord[]; resources: McpResourceRecord[] } {
    const cached = this.database.getMcpMountCache(mountId);
    return {
      tools: cached?.tools ?? [],
      prompts: cached?.prompts ?? [],
      resources: cached?.resources ?? [],
    };
  }

  async getPrompt(mount: McpMountRecord, promptName: string, args: Record<string, unknown> = {}): Promise<string> {
    const session = await this.ensureSession(mount);
    const response = await this.sendRequest(mount, session, "prompts/get", {
      name: promptName,
      arguments: args,
    });
    return JSON.stringify(response, null, 2);
  }

  async readResource(mount: McpMountRecord, uri: string): Promise<string> {
    const session = await this.ensureSession(mount);
    const response = await this.sendRequest(mount, session, "resources/read", {
      uri,
    });
    return JSON.stringify(response, null, 2);
  }

  async callTool(mount: McpMountRecord, toolName: string, args: Record<string, unknown>): Promise<string> {
    const session = await this.ensureSession(mount);
    try {
      const response = await this.sendRequest(mount, session, "tools/call", {
        name: toolName,
        arguments: args,
      });
      return JSON.stringify(response, null, 2);
    } catch (error) {
      await this.reconnect(mount.id);
      const reconnected = await this.ensureSession(mount);
      const response = await this.sendRequest(mount, reconnected, "tools/call", {
        name: toolName,
        arguments: args,
      });
      return JSON.stringify(response, null, 2);
    }
  }

  async reconnect(mountId: string): Promise<void> {
    const live = this.sessions.get(mountId);
    if (live?.process) {
      live.process.kill();
    }
    this.sessions.delete(mountId);
    const existing = this.database.getMcpSessionByMountId(mountId);
    if (existing) {
      const closed = this.database.upsertMcpSession({
        ...existing,
        status: "closed",
        updatedAt: new Date().toISOString(),
      });
      this.emit(closed);
    }
  }

  private async ensureSession(mount: McpMountRecord): Promise<McpSessionRecord> {
    const live = this.sessions.get(mount.id);
    if (live) {
      return live.session;
    }

    const now = new Date().toISOString();
    const session = this.database.upsertMcpSession({
      id: createId("mcp_session"),
      mountId: mount.id,
      status: "connecting",
      transport: mount.transport,
      lastConnectedAt: now,
      updatedAt: now,
    });

    const cache: SessionCache = {
      session,
      transport: mount.transport,
      nextId: 1,
    };

    if (mount.transport === "stdio" && mount.command) {
      const child = spawn(mount.command, mount.args ?? [], {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      });
      cache.process = child;
      cache.buffer = "";
    }

    cache.session = this.database.upsertMcpSession({
      ...session,
      status: "ready",
      updatedAt: new Date().toISOString(),
    });
    this.sessions.set(mount.id, cache);
    this.emit(cache.session);
    return cache.session;
  }

  private async safeCallList<T>(mount: McpMountRecord, session: McpSessionRecord, method: string, field: string): Promise<T> {
    try {
      const response = await this.sendRequest(mount, session, method, {});
      const result = (response?.result ?? {}) as Record<string, unknown>;
      const value = result[field];
      return Array.isArray(value) ? (value as T) : ([] as unknown as T);
    } catch {
      return [] as unknown as T;
    }
  }

  private async sendRequest(mount: McpMountRecord, session: McpSessionRecord, method: string, params: Record<string, unknown>) {
    if (mount.transport === "http" && mount.url) {
      const response = await fetch(mount.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${session.id}-${Date.now()}`,
          method,
          params,
        }),
      });
      return await response.json();
    }

    const live = this.sessions.get(mount.id);
    if (!live?.process) {
      throw new Error(`MCP stdio session is not active for mount ${mount.name}`);
    }

    const id = String(live.nextId++);
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    const child = live.process;

    return await new Promise<any>((resolve, reject) => {
      let stdout = "";
      let timer: NodeJS.Timeout | undefined;
      const onData = (chunk: Buffer) => {
        stdout += chunk.toString();
        const parsed = tryParseMcpPayload(stdout);
        if (!parsed) {
          return;
        }
        cleanup();
        resolve(parsed);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = () => {
        cleanup();
        reject(new Error(`MCP mount ${mount.name} exited before responding.`));
      };
      const cleanup = () => {
        child.stdout.off("data", onData);
        child.stderr.off("data", onError as any);
        child.off("exit", onExit);
        if (timer) {
          clearTimeout(timer);
        }
      };
      child.stdout.on("data", onData);
      child.on("exit", onExit);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for MCP response from ${mount.name}.`));
      }, 20_000);
      timer.unref?.();
      child.stdin.write(`Content-Length: ${Buffer.byteLength(request, "utf8")}\r\n\r\n${request}`);
    });
  }
}

function tryParseMcpPayload(buffer: string): unknown | null {
  const separatorIndex = buffer.indexOf("\r\n\r\n");
  if (separatorIndex === -1) {
    return null;
  }
  const header = buffer.slice(0, separatorIndex);
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    return null;
  }
  const length = Number(match[1]);
  const body = buffer.slice(separatorIndex + 4);
  if (body.length < length) {
    return null;
  }
  return JSON.parse(body.slice(0, length));
}
