import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { type TerminalBackendCapability, type TerminalSessionRecord, type WorkspaceProfile } from "@yellow-flow/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { isPathInside } from "../utils/path-utils.js";

type NodePtyModule = typeof import("node-pty");

const require = createRequire(import.meta.url);
const MAX_TERMINAL_BUFFER_CHARS = 24_000;
const ALLOWED_TERMINAL_SHELLS = new Set([
  "bash",
  "bash.exe",
  "sh",
  "sh.exe",
  "zsh",
  "zsh.exe",
  "fish",
  "fish.exe",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

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
  private readonly backends: TerminalBackend[] = [new PtyTerminalBackend(), new BufferedShellTerminalBackend()];
  private readonly defaultBackend: TerminalBackend;

  constructor(
    private readonly database: HarnessDatabase,
    private readonly onUpdate: (session: TerminalSessionRecord) => void,
    private readonly onOutput: (event: { sessionId: string; threadId?: string; delta: string; timestamp: string }) => void,
    private readonly onArchived: (archive: import("@yellow-flow/protocol").TerminalOutputArchiveRecord) => void,
    private readonly onCleared: (event: { sessionId: string; threadId?: string; timestamp: string }) => void,
  ) {
    this.defaultBackend = this.resolvePreferredBackend();
  }

  createSession(workspace: WorkspaceProfile, options: { threadId?: string; cwd?: string; shell?: string; cols?: number; rows?: number }): TerminalSessionRecord {
    const shell = resolveTerminalShell(workspace, options.shell);
    const cwd = resolveTerminalCwd(workspace, options.cwd);
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
      if (live.buffer.length > MAX_TERMINAL_BUFFER_CHARS) {
        const overflow = live.buffer.slice(0, live.buffer.length - MAX_TERMINAL_BUFFER_CHARS);
        live.buffer = live.buffer.slice(-MAX_TERMINAL_BUFFER_CHARS);
        this.archiveOutput(live.record, overflow, "auto_truncate");
      }
      this.onOutput({
        sessionId: live.record.id,
        threadId: live.record.threadId,
        delta: chunk,
        timestamp: new Date().toISOString(),
      });
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

  clearOutputBuffer(sessionId: string): TerminalSessionRecord {
    const live = this.requireSession(sessionId);

    if (live.buffer.length > 0) {
      this.archiveOutput(live.record, live.buffer, "manual_clear");
      live.buffer = "";
    }

    const updated = this.patchSession(live.record, {
      lastActiveAt: new Date().toISOString(),
    });
    this.onCleared({
      sessionId: updated.id,
      threadId: updated.threadId,
      timestamp: new Date().toISOString(),
    });
    return updated;
  }

  archiveOutputBuffer(sessionId: string): TerminalSessionRecord {
    const live = this.requireSession(sessionId);

    if (live.buffer.length > 0) {
      this.archiveOutput(live.record, live.buffer, "manual_archive");
      live.buffer = "";
    }

    const updated = this.patchSession(live.record, {
      lastActiveAt: new Date().toISOString(),
    });
    this.onCleared({
      sessionId: updated.id,
      threadId: updated.threadId,
      timestamp: new Date().toISOString(),
    });
    return updated;
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
      this.database.clearTerminalApprovalRules(sessionId);
      return this.database.getTerminalSession(sessionId) ?? live.record;
    }

    this.database.clearTerminalApprovalRules(sessionId);

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

  getCapability(kind: TerminalSessionRecord["backend"]): TerminalBackendCapability | undefined {
    return this.backends.find((backend) => backend.kind === kind)?.describe();
  }

  recordCommandAssessment(
    sessionId: string,
    assessment: {
      command: string;
      risk: TerminalSessionRecord["lastCommandRisk"];
      approvalState: TerminalSessionRecord["lastCommandApprovalState"];
      requiresApproval: boolean;
      reason?: string;
    },
  ): TerminalSessionRecord {
    const session = this.database.getTerminalSession(sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    return this.patchSession(session, {
      lastCommand: assessment.command,
      lastCommandRisk: assessment.risk,
      lastCommandApprovalState: assessment.approvalState,
      lastCommandRequiresApproval: assessment.requiresApproval,
      lastCommandReason: assessment.reason,
      lastCommandAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
  }

  setPendingApproval(sessionId: string, pending: {
    mode: "preflight" | "deferred";
    command: string;
    reason?: string;
  }): TerminalSessionRecord {
    const session = this.database.getTerminalSession(sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    return this.patchSession(session, {
      pendingApprovalMode: pending.mode,
      pendingApprovalCommand: pending.command,
      pendingApprovalReason: pending.reason,
    });
  }

  clearPendingApproval(sessionId: string): TerminalSessionRecord {
    const session = this.database.getTerminalSession(sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    return this.patchSession(session, {
      pendingApprovalMode: undefined,
      pendingApprovalCommand: undefined,
      pendingApprovalReason: undefined,
    });
  }

  annotateCommandAssessment(
    sessionId: string,
    assessment: Pick<
      TerminalSessionRecord,
      | "lastCommand"
      | "lastCommandRisk"
      | "lastCommandApprovalState"
      | "lastCommandRequiresApproval"
      | "lastCommandReason"
      | "lastCommandAt"
    >,
  ): TerminalSessionRecord {
    const stored = this.database.getTerminalSession(sessionId);

    if (!stored) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    const updated = this.database.updateTerminalSession({
      ...stored,
      ...assessment,
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(updated);

    const live = this.sessions.get(sessionId);
    if (live) {
      live.record = updated;
    }

    return updated;
  }

  private resolvePreferredBackend(): TerminalBackend {
    const preferred = (process.env.YELLOW_FLOW_TERMINAL_BACKEND ?? "auto").toLowerCase();

    if (preferred === "pipe") {
      return this.backends.find((backend) => backend.kind === "pipe") ?? this.backends[0]!;
    }

    if (preferred === "pty") {
      return this.backends.find((backend) => backend.kind === "pty") ?? this.backends[0]!;
    }

    return this.backends.find((backend) => backend.describe().available) ?? this.backends[this.backends.length - 1]!;
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

  private archiveOutput(
    session: TerminalSessionRecord,
    output: string,
    reason: import("@yellow-flow/protocol").TerminalOutputArchiveRecord["reason"],
  ): import("@yellow-flow/protocol").TerminalOutputArchiveRecord {
    const archive = this.database.createTerminalOutputArchive({
      id: createId("termarch"),
      sessionId: session.id,
      threadId: session.threadId,
      reason,
      output,
      createdAt: new Date().toISOString(),
    });
    this.onArchived(archive);
    return archive;
  }
}

class BufferedShellTerminalBackend implements TerminalBackend {
  readonly kind = "pipe" as const;

  describe(): TerminalBackendCapability {
    return {
      kind: this.kind,
      available: true,
      interactive: false,
      supportsInteractiveCommands: false,
      supportsResize: false,
      approvalModes: ["preflight", "session"],
      defaultApprovalMode: "preflight",
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
  private readonly nodePty = loadNodePtyModule();

  describe(): TerminalBackendCapability {
    return {
      kind: this.kind,
      available: Boolean(this.nodePty),
      interactive: true,
      supportsInteractiveCommands: Boolean(this.nodePty),
      supportsResize: true,
      approvalModes: ["preflight", "deferred", "session"],
      defaultApprovalMode: "preflight",
      reason: this.nodePty ? "node-pty backend" : "node-pty is unavailable; falling back to buffered pipe backend.",
    };
  }

  start(params: { shell: string; cwd: string; cols?: number; rows?: number }): TerminalBackendHandle {
    if (!this.nodePty) {
      throw new Error("PTY backend is not available yet.");
    }

    const pty = this.nodePty.spawn(params.shell, buildShellArgs(params.shell), {
      name: process.env.TERM ?? "xterm-256color",
      cols: params.cols ?? 120,
      rows: params.rows ?? 30,
      cwd: params.cwd,
      env: process.env as Record<string, string>,
    });

    return new PtyTerminalHandle(pty);
  }
}

class PtyTerminalHandle implements TerminalBackendHandle {
  constructor(private readonly pty: import("node-pty").IPty) {}

  get pid(): number | undefined {
    return this.pty.pid;
  }

  write(input: string): void {
    this.pty.write(input);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    this.pty.kill();
  }

  onData(listener: (chunk: string) => void): void {
    this.pty.onData(listener);
  }

  onExit(listener: (result: { exitCode?: number; failureReason?: string }) => void): void {
    this.pty.onExit(({ exitCode }) => {
      listener({ exitCode });
    });
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

function resolveTerminalCwd(workspace: WorkspaceProfile, cwd?: string): string {
  const resolved = cwd ? resolve(workspace.rootPath, cwd) : workspace.rootPath;

  if (workspace.sandboxMode !== "danger-full-access" && !isPathInside(workspace.rootPath, resolved)) {
    throw new Error(`Terminal cwd is outside the workspace: ${resolved}`);
  }

  return resolved;
}

function resolveTerminalShell(workspace: WorkspaceProfile, shell?: string): string {
  const candidate = shell ?? workspace.shell;
  const shellName = basename(candidate).toLowerCase();

  if (!ALLOWED_TERMINAL_SHELLS.has(shellName)) {
    throw new Error(`Terminal shell is not allowed: ${candidate}`);
  }

  if (shell && shell !== workspace.shell && basename(shell) !== shell) {
    throw new Error(`Terminal shell is not allowed: ${candidate}`);
  }

  return candidate;
}

function buildShellArgs(shell: string): string[] {
  const normalized = shell.toLowerCase();

  if (normalized.includes("powershell")) {
    return ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"];
  }

  if (normalized.includes("bash")) {
    return ["-i"];
  }

  return [];
}

function loadNodePtyModule(): NodePtyModule | null {
  try {
    return require("node-pty") as NodePtyModule;
  } catch {
    return null;
  }
}
