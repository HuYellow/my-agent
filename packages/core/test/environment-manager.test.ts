import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import type { ProjectRecord } from "@yellow-flow/protocol";
import { EnvironmentManager } from "../src/services/environment-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("EnvironmentManager", () => {
  const originalEnv = {
    PATH: process.env.PATH,
    VIRTUAL_ENV: process.env.VIRTUAL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.PATH = originalEnv.PATH;
    process.env.VIRTUAL_ENV = originalEnv.VIRTUAL_ENV;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
  });

  it("detects tool availability and captures selected environment metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-env-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = createProject(database, root);
    const emitted: string[] = [];
    process.env.PATH = process.env.PATH ?? root;
    process.env.VIRTUAL_ENV = join(root, ".venv");
    process.env.NODE_ENV = "test";

    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if ((command === "where" || command === "which") && ["git", "node", "python"].includes(String(args[0]))) {
        return { status: 0 };
      }

      if (command === "node" && args[0] === "--version") {
        return {
          status: 0,
          stdout: "v22.2.0\n",
          stderr: "",
        };
      }

      return { status: 1, stdout: "", stderr: "" };
    });

    const manager = new EnvironmentManager(database, (environment) => {
      emitted.push(environment.id);
    });

    const environment = manager.detect({
      project,
      threadId: "thread-1",
      worktreeId: "worktree-1",
      cwd: join(root, "workspace"),
    });

    expect(environment.threadId).toBe("thread-1");
    expect(environment.worktreeId).toBe("worktree-1");
    expect(environment.detectedTools).toEqual(["git", "node", "python"]);
    expect(environment.nodeVersion).toBe("v22.2.0");
    expect(environment.pythonVenvPath).toBe(join(root, ".venv"));
    expect(environment.envJson).toMatchObject({
      PATH: expect.any(String),
      VIRTUAL_ENV: join(root, ".venv"),
      NODE_ENV: "test",
    });
    expect(database.listEnvironments(project.id)).toMatchObject([
      {
        id: environment.id,
        detectedTools: ["git", "node", "python"],
      },
    ]);
    expect(emitted).toEqual([environment.id]);
  });
});

function createProject(database: HarnessDatabase, root: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id: "project-env",
    name: "Environment Project",
    rootPath: root,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });
}
