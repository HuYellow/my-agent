import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { type McpMountRecord, type McpPromptRecord, type McpResourceRecord, type McpSessionRecord, type McpToolRecord } from "@yellow-flow/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

interface PendingStdioRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface SessionCache {
  session: McpSessionRecord;
  transport: "stdio" | "http";
  process?: ChildProcessWithoutNullStreams;
  nextId: number;
  initialized: boolean;
  initialization?: Promise<McpSessionRecord>;
  pendingRequests: Map<string, PendingStdioRequest>;
  stdoutBuffer: string;
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
    this.sessions.delete(mountId);
    if (live?.process) {
      this.rejectPendingRequests(live, new Error(`MCP mount ${mountId} was reconnected.`));
      live.process.kill();
    }
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
      if (live.initialization) {
        return live.initialization;
      }
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
      initialized: false,
      pendingRequests: new Map(),
      stdoutBuffer: "",
    };

    if (mount.transport === "stdio" && mount.command) {
      const child = spawn(mount.command, mount.args ?? [], {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      });
      cache.process = child;
      this.attachStdioParser(mount, cache, child);
      this.attachChildLifecycle(mount, cache, child);
    }

    this.sessions.set(mount.id, cache);
    this.emit(cache.session);
    cache.initialization = this.initializeSession(mount, cache);

    try {
      return await cache.initialization;
    } finally {
      if (this.sessions.get(mount.id) === cache) {
        cache.initialization = undefined;
      }
    }
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
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        live.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for MCP response from ${mount.name}.`));
      }, 20_000);
      timer.unref?.();

      live.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
      });

      live.process!.stdin.write(`Content-Length: ${Buffer.byteLength(request, "utf8")}\r\n\r\n${request}`);
    });
  }

  private async initializeSession(mount: McpMountRecord, cache: SessionCache): Promise<McpSessionRecord> {
    try {
      const initialized = await this.sendRequest(mount, cache.session, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "yellow-flow",
          version: "0.1.0",
        },
      });

      if (initialized?.error) {
        throw new Error(initialized.error.message);
      }

      cache.initialized = true;
      cache.session = this.database.upsertMcpSession({
        ...cache.session,
        status: "ready",
        lastConnectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      this.emit(cache.session);
      return cache.session;
    } catch (error) {
      this.markSessionFailed(mount.id, cache);
      throw error;
    }
  }

  private attachChildLifecycle(
    mount: McpMountRecord,
    cache: SessionCache,
    child: ChildProcessWithoutNullStreams,
  ): void {
    child.on("error", (error) => {
      this.rejectPendingRequests(cache, error);
      this.markSessionFailed(mount.id, cache);
    });
    child.on("exit", () => {
      this.rejectPendingRequests(cache, new Error(`MCP mount ${mount.name} exited before responding.`));
      if (this.sessions.get(mount.id) !== cache || cache.session.status === "failed") {
        return;
      }

      cache.session = this.database.upsertMcpSession({
        ...cache.session,
        status: "closed",
        updatedAt: new Date().toISOString(),
      });
      this.sessions.delete(mount.id);
      this.emit(cache.session);
    });
  }

  private markSessionFailed(mountId: string, cache: SessionCache): void {
    if (this.sessions.get(mountId) !== cache || cache.session.status === "failed") {
      return;
    }

    cache.session = this.database.upsertMcpSession({
      ...cache.session,
      status: "failed",
      updatedAt: new Date().toISOString(),
    });
    this.sessions.delete(mountId);
    this.emit(cache.session);

    this.rejectPendingRequests(cache, new Error(`MCP mount ${cache.session.mountId} failed.`));

    if (cache.process && !cache.process.killed) {
      cache.process.kill();
    }
  }

  private attachStdioParser(
    mount: McpMountRecord,
    cache: SessionCache,
    child: ChildProcessWithoutNullStreams,
  ): void {
    child.stdout.on("data", (chunk: Buffer) => {
      cache.stdoutBuffer += chunk.toString();

      while (true) {
        const parsed = tryParseMcpPayload(cache.stdoutBuffer);
        if (!parsed) {
          break;
        }

        cache.stdoutBuffer = parsed.rest;
        this.resolveStdioPayload(mount, cache, parsed.payload);
      }
    });
  }

  private resolveStdioPayload(mount: McpMountRecord, cache: SessionCache, payload: unknown): void {
    if (!payload || typeof payload !== "object" || !("id" in payload)) {
      return;
    }

    const id = String((payload as { id: unknown }).id);
    const pending = cache.pendingRequests.get(id);
    if (!pending) {
      return;
    }

    cache.pendingRequests.delete(id);
    clearTimeout(pending.timer);

    const error = (payload as { error?: { message?: unknown } }).error;
    if (error) {
      pending.reject(new Error(typeof error.message === "string" ? error.message : `MCP request ${id} failed for ${mount.name}.`));
      return;
    }

    pending.resolve(payload);
  }

  private rejectPendingRequests(cache: SessionCache, error: Error): void {
    const pendingRequests = [...cache.pendingRequests.values()];
    cache.pendingRequests.clear();

    for (const pending of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function tryParseMcpPayload(buffer: string): { payload: unknown; rest: string } | null {
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
  return {
    payload: JSON.parse(body.slice(0, length)),
    rest: body.slice(length),
  };
}
