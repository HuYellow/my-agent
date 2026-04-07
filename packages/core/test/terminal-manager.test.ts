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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores PTY-ready session metadata while still using the pipe backend", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-terminal-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const child = new MockChild();
    spawnMock.mockReturnValue(child);
    const manager = new TerminalManager(database, () => undefined);

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

    const resized = manager.resizeSession(session.id, 140, 50);
    expect(resized).toMatchObject({ cols: 140, rows: 50 });

    const closed = manager.closeSession(session.id);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).toBeTruthy();
  });
});
