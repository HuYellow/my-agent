import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { type ProjectRecord, type WorktreeRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

export class WorktreeManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (worktree: WorktreeRecord) => void,
  ) {}

  list(projectId?: string): WorktreeRecord[] {
    return this.database.listWorktrees(projectId);
  }

  create(params: {
    project: ProjectRecord;
    threadId?: string;
    agentId?: string;
    branch?: string;
    baseRef?: string;
  }): WorktreeRecord {
    const now = new Date().toISOString();
    const branch = params.branch?.trim() || buildDefaultBranchName(params.threadId, params.agentId);
    const worktreePath = join(params.project.rootPath, ".my-agent", "worktrees", branch);
    mkdirSync(resolve(worktreePath, ".."), { recursive: true });

    const record = this.database.createWorktree({
      id: createId("worktree"),
      projectId: params.project.id,
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

    if (project) {
      const result = spawnSync("git", ["worktree", "remove", "--force", worktree.path], {
        cwd: project.rootPath,
        encoding: "utf8",
        windowsHide: true,
      });

      if (result.status !== 0) {
        rmSync(worktree.path, { recursive: true, force: true });
      }
    } else {
      rmSync(worktree.path, { recursive: true, force: true });
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
