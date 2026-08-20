import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { type ProjectRecord, type WorktreeRecord } from "@yellow-flow/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { isPathInside } from "../utils/path-utils.js";

export class WorktreeManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (worktree: WorktreeRecord) => void,
  ) {}

  list(projectId?: string): WorktreeRecord[] {
    return this.database.listWorktrees(projectId);
  }

  get(worktreeId: string): WorktreeRecord | null {
    return this.database.getWorktree(worktreeId);
  }

  create(params: {
    project: ProjectRecord;
    requirementId?: string;
    threadId?: string;
    agentId?: string;
    branch?: string;
    baseRef?: string;
  }): WorktreeRecord {
    const now = new Date().toISOString();
    const branch = normalizeWorktreeBranch(params.branch?.trim() || buildDefaultBranchName(params.threadId, params.agentId));
    const managedRoot = getManagedWorktreeRoot(params.project.rootPath);
    const worktreePath = resolve(managedRoot, branch);
    assertManagedWorktreePath(managedRoot, worktreePath);
    mkdirSync(managedRoot, { recursive: true });

    const record = this.database.createWorktree({
      id: createId("worktree"),
      projectId: params.project.id,
      requirementId: params.requirementId,
      threadId: params.threadId,
      agentId: params.agentId,
      branch,
      path: worktreePath,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    });
    this.emit(record);

    const result = spawnSync(
      "git",
      ["worktree", "add", worktreePath, "-b", branch, params.baseRef?.trim() || "HEAD"],
      {
        cwd: params.project.rootPath,
        encoding: "utf8",
        windowsHide: true,
      },
    );

    if (result.status !== 0) {
      cleanupManagedWorktreePath(managedRoot, worktreePath);
      const failed = this.database.updateWorktree({
        ...record,
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
      this.emit(failed);
      throw new Error(result.stderr?.trim() || result.stdout?.trim() || `Unable to create worktree ${worktreePath}`);
    }

    const ready = this.database.updateWorktree({
      ...record,
      status: "ready",
      updatedAt: new Date().toISOString(),
    });
    this.emit(ready);
    return ready;
  }

  remove(worktreeId: string): WorktreeRecord {
    const worktree = this.database.getWorktree(worktreeId);

    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    const project = this.database.getProject(worktree.projectId);
    const resolvedWorktreePath = resolve(worktree.path);

    if (!project) {
      throw new Error(`Project not found for worktree ${worktree.id}. Refusing to remove an unmanaged path.`);
    }

    const managedRoot = getManagedWorktreeRoot(project.rootPath);
    assertManagedWorktreePath(managedRoot, resolvedWorktreePath);

    const result = spawnSync("git", ["worktree", "remove", "--force", resolvedWorktreePath], {
      cwd: project.rootPath,
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status !== 0) {
      cleanupManagedWorktreePath(managedRoot, resolvedWorktreePath);
    }

    const removed = this.database.updateWorktree({
      ...worktree,
      status: "removed",
      updatedAt: new Date().toISOString(),
    });
    this.emit(removed);
    return removed;
  }
}

function buildDefaultBranchName(threadId?: string, agentId?: string): string {
  const suffix = (agentId ?? threadId ?? createId("branch")).replace(/^[^_]+_/, "").slice(0, 12);
  return `codex/${suffix}`;
}

function getManagedWorktreeRoot(projectRootPath: string): string {
  return resolve(projectRootPath, ".yellow-flow", "worktrees");
}

function cleanupManagedWorktreePath(managedRoot: string, worktreePath: string): void {
  assertManagedWorktreePath(managedRoot, worktreePath);
  rmSync(worktreePath, { recursive: true, force: true });
}

function assertManagedWorktreePath(managedRoot: string, worktreePath: string): void {
  if (!isPathInside(managedRoot, worktreePath)) {
    throw new Error(`Refusing to manage a worktree path outside the managed root: ${worktreePath}`);
  }
}

function normalizeWorktreeBranch(branch: string): string {
  const normalized = branch.trim().replace(/\\/g, "/");

  if (!normalized) {
    throw new Error("Worktree branch cannot be empty.");
  }

  if (
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("//") ||
    normalized.includes("..") ||
    normalized.includes("@{") ||
    normalized.includes(".lock") ||
    /[\s~^:?*\[\]]/.test(normalized)
  ) {
    throw new Error(`Unsafe worktree branch name: ${branch}`);
  }

  return normalized;
}
