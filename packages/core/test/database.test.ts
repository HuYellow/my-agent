import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HarnessDatabase } from "../src/store/database.js";

describe("HarnessDatabase projects", () => {
  it("seeds a default project and stores threads by projectId", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const projects = database.listProjects();

    expect(projects.length).toBeGreaterThan(0);
    expect(database.getConfig().selectedProjectId).toBe(projects[0]?.id);

    const thread = database.createThread({
      id: "thread-1",
      title: "Project thread",
      projectId: projects[0]!.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    });

    expect(database.getThread(thread.id)).toMatchObject({
      id: "thread-1",
      projectId: projects[0]!.id,
      sandboxMode: projects[0]!.sandboxMode,
    });
  });

  it("hides hidden threads from the default listing and persists execution contexts", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    database.createThread({
      id: "thread-visible",
      title: "Visible",
      projectId: project.id,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    database.createThread({
      id: "thread-hidden",
      title: "Hidden",
      projectId: project.id,
      hidden: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    database.createExecutionContext({
      id: "exec-1",
      projectId: project.id,
      kind: "agent",
      threadId: "thread-hidden",
      agentId: "agent-1",
      cwd: root,
      shell: process.platform === "win32" ? "powershell" : "bash",
      envJson: { PATH: process.env.PATH ?? "" },
      detectedTools: ["git"],
      createdAt: now,
      updatedAt: now,
    });

    expect(database.listThreads().map((thread) => thread.id)).toEqual(["thread-visible"]);
    expect(database.listThreads({ includeHidden: true }).map((thread) => thread.id)).toContain("thread-hidden");
    expect(database.listExecutionContexts(project.id)).toMatchObject([
      {
        id: "exec-1",
        kind: "agent",
        threadId: "thread-hidden",
        agentId: "agent-1",
      },
    ]);
  });

  it("persists review runs with structured findings", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    database.createReview({
      id: "review-1",
      projectId: project.id,
      threadId: "thread-visible",
      executionContextId: "exec-1",
      status: "completed",
      source: { kind: "workspace" },
      summary: "One actionable issue found.",
      findings: [
        {
          id: "finding-1",
          severity: "high",
          summary: "Null guard is missing",
          detail: "A missing null check can crash the request path.",
          file: "src/app.ts",
          line: 42,
        },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    expect(database.listReviews(project.id)).toMatchObject([
      {
        id: "review-1",
        projectId: project.id,
        threadId: "thread-visible",
        executionContextId: "exec-1",
        summary: "One actionable issue found.",
        findings: [
          {
            id: "finding-1",
            severity: "high",
            file: "src/app.ts",
            line: 42,
          },
        ],
      },
    ]);
  });

  it("persists extended terminal session state for future PTY backends", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const now = new Date().toISOString();

    database.createTerminalSession({
      id: "terminal-1",
      threadId: "thread-visible",
      workspaceId: "workspace-1",
      cwd: root,
      shell: process.platform === "win32" ? "powershell" : "bash",
      backend: "pipe",
      status: "open",
      cols: 120,
      rows: 40,
      pid: 4321,
      startedAt: now,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    });

    expect(database.getTerminalSession("terminal-1")).toMatchObject({
      backend: "pipe",
      status: "open",
      cols: 120,
      rows: 40,
      pid: 4321,
      startedAt: now,
      lastActiveAt: now,
    });
  });
});
