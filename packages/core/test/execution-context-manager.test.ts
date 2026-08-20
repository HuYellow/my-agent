import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnvironmentRecord, ExecutionContextRecord, ProjectRecord, WorktreeRecord } from "@yellow-flow/protocol";
import { ExecutionContextManager } from "../src/services/execution-context-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("ExecutionContextManager", () => {
  it("creates and updates execution contexts using environment metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-exec-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = createProject(database, root);
    const emitted: ExecutionContextRecord[] = [];
    const manager = new ExecutionContextManager(database, (executionContext) => {
      emitted.push(executionContext);
    });
    const environment: EnvironmentRecord = {
      id: "env-1",
      projectId: project.id,
      threadId: "thread-1",
      cwd: join(root, "workspace"),
      shell: process.platform === "win32" ? "powershell" : "bash",
      envJson: { PATH: process.env.PATH ?? "" },
      detectedTools: ["git", "node"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const worktree: WorktreeRecord = {
      id: "worktree-1",
      projectId: project.id,
      branch: "codex/context",
      path: join(root, ".yellow-flow", "worktrees", "codex", "context"),
      status: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = manager.create({
      project,
      kind: "workflow",
      requirementId: "requirement-1",
      threadId: "thread-1",
      worktree,
      environment,
    });

    expect(created).toMatchObject({
      projectId: project.id,
      kind: "workflow",
      requirementId: "requirement-1",
      threadId: "thread-1",
      worktreeId: "worktree-1",
      environmentId: "env-1",
      detectedTools: ["git", "node"],
    });

    const updated = manager.update({
      ...created,
      cwd: join(root, "workspace", "subdir"),
      detectedTools: ["git", "node", "rg"],
    });

    expect(updated.cwd).toBe(join(root, "workspace", "subdir"));
    expect(updated.detectedTools).toEqual(["git", "node", "rg"]);
    expect(manager.list(project.id)).toMatchObject([
      {
        id: created.id,
        cwd: join(root, "workspace", "subdir"),
      },
    ]);
    expect(emitted.map((record) => record.id)).toEqual([created.id, created.id]);
  });
});

function createProject(database: HarnessDatabase, root: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id: "project-exec",
    name: "Execution Context Project",
    rootPath: root,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });
}
