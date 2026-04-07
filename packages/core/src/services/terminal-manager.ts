import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { type TerminalBackendCapability, type TerminalSessionRecord, type WorkspaceProfile } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

interface TerminalBackendHandle {
  readonly pid?: number;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (result: { exitCode?: number; failureReason?: string }) => void): void;
}

interface TerminalBackend {
  readonly kind: TerminalSessionRecord["backend"];
  describe(): TerminalBackendCapability;
  start(params: {
    shell: string;
    cwd: string;
    cols?: number;
    rows?: number;
  }): TerminalBackendHandle;
}

interface LiveTerminalSession {
  backend: TerminalBackend;
  handle: TerminalBackendHandle;
  buffer: string;
  record: TerminalSessionRecord;
}

export class TerminalManager {
  private readonly sessions = new Map<string, LiveTerminalSession>();
  private readonly backends: TerminalBackend[] = [new BufferedShellTerminalBackend(), new PtyTerminalBackend()];
  private readonly defaultBackend: TerminalBackend = this.backends[0]!;

  constructor(
    private readonly database: HarnessDatabase,
    private readonly onUpdate: (session: TerminalSessionRecord) => void,
  ) {}

  createSession(workspace: WorkspaceProfile, options: { threadId?: string; cwd?: string; shell?: string; cols?: number; rows?: number }): TerminalSessionRecord {
    const shell = options.shell ?? workspace.shell;
    const cwd = options.cwd ? resolve(workspace.rootPath, options.cwd) : workspace.rootPath;
    const now = new Date().toISOString();
    const handle = this.defaultBackend.start({
      shell,
      cwd,
      cols: options.cols,
      rows: options.rows,
    });
    const record: TerminalSessionRecord = {
      id: createId("terminal"),
      threadId: options.threadId,
      workspaceId: workspace.id,
      cwd,
      shell,
      backend: this.defaultBackend.kind,
      status: "open",
      cols: options.cols,
      rows: options.rows,
      pid: handle.pid,
      startedAt: now,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const live: LiveTerminalSession = {
      backend: this.defaultBackend,
      handle,
      buffer: "",
      record: this.database.createTerminalSession(record),
    };

    handle.onData((chunk) => {
      live.buffer += chunk;
      live.record = this.patchSession(live.record, {
        lastActiveAt: new Date().toISOString(),
      });
    });
    handle.onExit((result) => {
      const nextStatus: TerminalSessionRecord["status"] = result.failureReason ? "failed" : "closed";
      live.record = this.patchSession(live.record, {
        status: nextStatus,
        exitCode: result.exitCode,
        failureReason: result.failureReason,
        closedAt: new Date().toISOString(),
      });
      this.sessions.delete(live.record.id);
    });

    this.sessions.set(record.id, live);
    this.onUpdate(record);
    return record;
  }

  writeInput(sessionId: string, input: string): TerminalSessionRecord {
    const live = this.requireSession(sessionId);
    live.handle.write(input);
    live.record = this.patchSession(live.record, {
      lastActiveAt: new Date().toISOString(),
    });
    return live.record;
  }

  readOutput(sessionId: string): { session: TerminalSessionRecord; output: string } {
    const live = this.requireSession(sessionId);
    const output = live.buffer;
    live.buffer = "";
    live.record = this.patchSession(live.record, {
      lastActiveAt: new Date().toISOString(),
    });
    return {
      session: live.record,
      output,
    };
  }

  resizeSession(sessionId: string, cols?: number, rows?: number): TerminalSessionRecord {
    const live = this.requireSession(sessionId);

    if (typeof cols === "number" && typeof rows === "number") {
      live.handle.resize(cols, rows);
    }

    live.record = this.patchSession(live.record, {
      cols: typeof cols === "number" ? cols : live.record.cols,
      rows: typeof rows === "number" ? rows : live.record.rows,
      lastActiveAt: new Date().toISOString(),
    });
    return live.record;
  }

  closeSession(sessionId: string): TerminalSessionRecord {
    const stored = this.database.getTerminalSession(sessionId);

    if (!stored) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    const live = this.sessions.get(sessionId);

    if (live) {
      live.record = this.patchSession(live.record, {
        status: "closing",
      });
      live.handle.kill();
      this.sessions.delete(sessionId);
    }

    const closed = this.database.updateTerminalSession({
      ...stored,
      status: stored.status === "failed" ? "failed" : "closed",
      closedAt: stored.closedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    this.onUpdate(closed);
    return closed;
  }

  closeThreadSessions(threadId: string): void {
    for (const session of this.database.listTerminalSessions(threadId)) {
      if (session.status === "open" || session.status === "starting" || session.status === "closing") {
        this.closeSession(session.id);
      }
    }
  }

  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  listCapabilities(): TerminalBackendCapability[] {
    return this.backends.map((backend) => backend.describe());
  }

  private requireSession(sessionId: string): LiveTerminalSession {
    const live = this.sessions.get(sessionId);

    if (!live) {
      throw new Error(`Terminal session not found or not active: ${sessionId}`);
    }

    return live;
  }

  private patchSession(session: TerminalSessionRecord, patch: Partial<TerminalSessionRecord>): TerminalSessionRecord {
    const updated = this.database.updateTerminalSession({
      ...session,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(updated);
    return updated;
  }
}

class BufferedShellTerminalBackend implements TerminalBackend {
  readonly kind = "pipe" as const;

  describe(): TerminalBackendCapability {
    return {
      kind: this.kind,
      available: true,
      interactive: true,
      supportsResize: false,
      reason: "Buffered stdio shell backend",
    };
  }

  start(params: { shell: string; cwd: string; cols?: number; rows?: number }): TerminalBackendHandle {
    const child = spawnShell(params.shell, params.cwd);
    return new BufferedShellHandle(child);
  }
}

class PtyTerminalBackend implements TerminalBackend {
  readonly kind = "pty" as const;

  describe(): TerminalBackendCapability {
    return {
      kind: this.kind,
      available: false,
      interactive: true,
      supportsResize: true,
      reason: "PTY backend is planned but not wired yet.",
    };
  }

  start(): TerminalBackendHandle {
    throw new Error("PTY backend is not available yet.");
  }
}

class BufferedShellHandle implements TerminalBackendHandle {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  get pid(): number | undefined {
    return this.child.pid;
  }

  write(input: string): void {
    this.child.stdin.write(input);
  }

  resize(_cols: number, _rows: number): void {}

  kill(): void {
    this.child.kill();
  }

  onData(listener: (chunk: string) => void): void {
    this.child.stdout.on("data", (chunk) => listener(chunk.toString()));
    this.child.stderr.on("data", (chunk) => listener(chunk.toString()));
  }

  onExit(listener: (result: { exitCode?: number; failureReason?: string }) => void): void {
    this.child.on("error", (error) => {
      listener({ failureReason: error instanceof Error ? error.message : String(error) });
    });
    this.child.on("close", (code) => {
      listener({ exitCode: typeof code === "number" ? code : undefined });
    });
  }
}

function spawnShell(shell: string, cwd: string): ChildProcessWithoutNullStreams {
  const normalized = shell.toLowerCase();

  if (normalized.includes("powershell")) {
    return spawn(shell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  }

  if (normalized.includes("bash")) {
    return spawn(shell, ["-i"], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  }

  return spawn(shell, [], {
    cwd,
    env: process.env,
    windowsHide: true,
  });
}
