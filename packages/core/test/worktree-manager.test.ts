import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import type { ProjectRecord } from "@my-agent/protocol";
import { WorktreeManager } from "../src/services/worktree-manager.js";
import { HarnessDatabase } from "../src/store/database.js";
import { isPathInside } from "../src/utils/path-utils.js";

describe("WorktreeManager", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates ready worktrees inside the managed worktree root", () => {
    const { root, database, project } = createWorktreeHarness();
    const emitted: string[] = [];
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
    });

    const manager = new WorktreeManager(database, (worktree) => {
      emitted.push(worktree.status);
    });

    const worktree = manager.create({
      project,
      threadId: "thread-1",
    });

    expect(worktree.status).toBe("ready");
    expect(worktree.branch).toMatch(/^codex\//);
    expect(isPathInside(resolve(root, ".my-agent", "worktrees"), worktree.path)).toBe(true);
    expect(database.getWorktree(worktree.id)).toMatchObject({
      id: worktree.id,
      status: "ready",
    });
    expect(emitted).toEqual(["creating", "ready"]);
  });

  it("rejects unsafe branch names before creating a worktree", () => {
    const { database, project } = createWorktreeHarness();
    const manager = new WorktreeManager(database, () => undefined);

    expect(() =>
      manager.create({
        project,
        branch: "../escape",
      }),
    ).toThrow("Unsafe worktree branch name");
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(database.listWorktrees(project.id)).toEqual([]);
  });

  it("marks failed worktrees and cleans partial directories when git creation fails", () => {
    const { root, database, project } = createWorktreeHarness();
    spawnSyncMock.mockImplementation((_command: string, args: string[]) => {
      mkdirSync(String(args[2]), { recursive: true });
      return {
        status: 1,
        stdout: "",
        stderr: "fatal: invalid reference",
      };
    });
    const manager = new WorktreeManager(database, () => undefined);

    expect(() =>
      manager.create({
        project,
        branch: "codex/failure-path",
      }),
    ).toThrow("fatal: invalid reference");

    const failed = database.listWorktrees(project.id).at(-1);
    expect(failed).toMatchObject({
      branch: "codex/failure-path",
      status: "failed",
    });
    expect(existsSync(resolve(root, ".my-agent", "worktrees", "codex", "failure-path"))).toBe(false);
  });

  it("refuses to remove worktrees that point outside the managed root", () => {
    const { database, project } = createWorktreeHarness();
    const now = new Date().toISOString();
    const manager = new WorktreeManager(database, () => undefined);
    const outsidePath = resolve(project.rootPath, "..", "escaped-worktree");

    database.createWorktree({
      id: "worktree-outside",
      projectId: project.id,
      branch: "codex/outside",
      path: outsidePath,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    expect(() => manager.remove("worktree-outside")).toThrow("outside the managed root");
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to removing managed directories when git worktree remove fails", () => {
    const { database, project } = createWorktreeHarness();
    const now = new Date().toISOString();
    const worktreePath = resolve(project.rootPath, ".my-agent", "worktrees", "codex", "cleanup");
    mkdirSync(worktreePath, { recursive: true });
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "fatal: not registered",
    });
    const manager = new WorktreeManager(database, () => undefined);

    database.createWorktree({
      id: "worktree-cleanup",
      projectId: project.id,
      branch: "codex/cleanup",
      path: worktreePath,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const removed = manager.remove("worktree-cleanup");

    expect(removed.status).toBe("removed");
    expect(existsSync(worktreePath)).toBe(false);
  });
});

function createWorktreeHarness(): {
  root: string;
  database: HarnessDatabase;
  project: ProjectRecord;
} {
  const root = mkdtempSync(join(tmpdir(), "my-agent-worktree-"));
  const database = new HarnessDatabase(join(root, "app.db"));
  const now = new Date().toISOString();
  const project = database.createProject({
    id: "project-worktree",
    name: "Worktree Project",
    rootPath: root,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });

  return { root, database, project };
}
