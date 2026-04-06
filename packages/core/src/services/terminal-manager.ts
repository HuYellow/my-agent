import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { type TerminalSessionRecord, type WorkspaceProfile } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

interface LiveTerminalSession {
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  record: TerminalSessionRecord;
}

export class TerminalManager {
  private readonly sessions = new Map<string, LiveTerminalSession>();

  constructor(
    private readonly database: HarnessDatabase,
    private readonly onUpdate: (session: TerminalSessionRecord) => void,
  ) {}

  createSession(workspace: WorkspaceProfile, options: { threadId?: string; cwd?: string; shell?: string }): TerminalSessionRecord {
    const shell = options.shell ?? workspace.shell;
    const cwd = options.cwd ? resolve(workspace.rootPath, options.cwd) : workspace.rootPath;
    const child = spawnShell(shell, cwd);
    const now = new Date().toISOString();
    const record: TerminalSessionRecord = {
      id: createId("terminal"),
      threadId: options.threadId,
      workspaceId: workspace.id,
      cwd,
      shell,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };

    const live: LiveTerminalSession = {
      child,
      buffer: "",
      record: this.database.createTerminalSession(record),
    };

    child.stdout.on("data", (chunk) => {
      live.buffer += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      live.buffer += chunk.toString();
    });
    child.on("close", () => {
      const closed = this.database.updateTerminalSession({
        ...live.record,
        status: "closed",
        updatedAt: new Date().toISOString(),
      });
      live.record = closed;
      this.onUpdate(closed);
      this.sessions.delete(closed.id);
    });

    this.sessions.set(record.id, live);
    this.onUpdate(record);
    return record;
  }

  writeInput(sessionId: string, input: string): TerminalSessionRecord {
    const live = this.requireSession(sessionId);
    live.child.stdin.write(input);
    live.record = this.database.updateTerminalSession({
      ...live.record,
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(live.record);
    return live.record;
  }

  readOutput(sessionId: string): { session: TerminalSessionRecord; output: string } {
    const live = this.requireSession(sessionId);
    const output = live.buffer;
    live.buffer = "";
    return {
      session: live.record,
      output,
    };
  }

  resizeSession(sessionId: string): TerminalSessionRecord {
    const live = this.requireSession(sessionId);
    live.record = this.database.updateTerminalSession({
      ...live.record,
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(live.record);
    return live.record;
  }

  closeSession(sessionId: string): TerminalSessionRecord {
    const stored = this.database.getTerminalSession(sessionId);

    if (!stored) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    const live = this.sessions.get(sessionId);

    if (live) {
      live.child.kill();
      this.sessions.delete(sessionId);
    }

    const closed = this.database.updateTerminalSession({
      ...stored,
      status: "closed",
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(closed);
    return closed;
  }

  closeThreadSessions(threadId: string): void {
    for (const session of this.database.listTerminalSessions(threadId)) {
      if (session.status === "open") {
        this.closeSession(session.id);
      }
    }
  }

  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  private requireSession(sessionId: string): LiveTerminalSession {
    const live = this.sessions.get(sessionId);

    if (!live) {
      throw new Error(`Terminal session not found or not active: ${sessionId}`);
    }

    return live;
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
