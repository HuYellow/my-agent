import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockStream extends EventEmitter {
  write = vi.fn();
}

class MockChild extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  stdin = new MockStream();
  pid = 1234;
  kill = vi.fn(() => {
    this.emit("close", 0);
  });
}

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { TerminalManager } from "../src/services/terminal-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("TerminalManager", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    process.env.MY_AGENT_TERMINAL_BACKEND = "pipe";
  });

  afterEach(() => {
    delete process.env.MY_AGENT_TERMINAL_BACKEND;
    vi.restoreAllMocks();
  });

  it("stores PTY-ready session metadata while still using the pipe backend", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-terminal-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const child = new MockChild();
    spawnMock.mockReturnValue(child);
    const manager = new TerminalManager(database, () => undefined, () => undefined, () => undefined, () => undefined);

    expect(manager.listCapabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pipe", available: true, supportsInteractiveCommands: false }),
        expect.objectContaining({ kind: "pty", supportsResize: true, approvalModes: expect.arrayContaining(["preflight", "session"]) }),
      ]),
    );

    const session = manager.createSession(
      {
        id: "workspace-1",
        name: "Workspace",
        rootPath: root,
        shell: process.platform === "win32" ? "powershell.exe" : "bash",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
      { threadId: "thread-1", cols: 120, rows: 40 },
    );

    expect(session).toMatchObject({
      backend: "pipe",
      status: "open",
      cols: 120,
      rows: 40,
      pid: 1234,
    });

    child.stdout.emit("data", Buffer.from("hello"));
    const read = manager.readOutput(session.id);
    expect(read.output).toBe("hello");

    child.stdout.emit("data", Buffer.from("archivable output"));
    const archived = manager.archiveOutputBuffer(session.id);
    expect(archived.id).toBe(session.id);
    expect(database.listTerminalOutputArchives(session.id)).toMatchObject([
      {
        sessionId: session.id,
        reason: "manual_archive",
        output: "archivable output",
      },
    ]);

    child.stdout.emit("data", Buffer.from("clearable output"));
    manager.clearOutputBuffer(session.id);
    expect(database.listTerminalOutputArchives(session.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "manual_clear", output: "clearable output" }),
      ]),
    );

    const resized = manager.resizeSession(session.id, 140, 50);
    expect(resized).toMatchObject({ cols: 140, rows: 50 });

    const assessed = manager.recordCommandAssessment(session.id, {
      command: "sudo rm -rf build",
      risk: "privileged",
      approvalState: "required",
      requiresApproval: true,
      reason: "Privileged command execution requires explicit approval.",
    });
    expect(assessed).toMatchObject({
      lastCommand: "sudo rm -rf build",
      lastCommandRisk: "privileged",
      lastCommandApprovalState: "required",
      lastCommandRequiresApproval: true,
    });

    const pending = manager.setPendingApproval(session.id, {
      mode: "preflight",
      command: "sudo rm -rf build",
      reason: "Approval required before execution.",
    });
    expect(pending).toMatchObject({
      pendingApprovalMode: "preflight",
      pendingApprovalCommand: "sudo rm -rf build",
    });

    const cleared = manager.clearPendingApproval(session.id);
    expect(cleared.pendingApprovalMode).toBeUndefined();
    expect(cleared.pendingApprovalCommand).toBeUndefined();

    const closed = manager.closeSession(session.id);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBeTruthy();
  });
});
