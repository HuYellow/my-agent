import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentTaskManager } from "../src/services/agent-task-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("AgentTaskManager", () => {
  it("runs delegated tasks through a hidden child thread and records a summary", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-agent-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    database.createThread({
      id: "thread-parent",
      title: "Parent",
      projectId: project.id,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    const manager = new AgentTaskManager(
      database,
      {
        create: () => ({
          id: "worktree-1",
          projectId: project.id,
          agentId: "agent-placeholder",
          branch: "codex/test",
          path: root,
          status: "ready",
          createdAt: now,
          updatedAt: now,
        }),
        remove: () => undefined,
      } as never,
      {
        detect: ({ threadId, worktreeId, cwd }: { threadId?: string; worktreeId?: string; cwd?: string }) => ({
          id: "env-1",
          projectId: project.id,
          threadId,
          worktreeId,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: { PATH: process.env.PATH ?? "" },
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: ({ threadId, agentId, environment, worktree }: { threadId?: string; agentId?: string; environment: { id: string }; worktree?: { id: string } }) => ({
          id: "exec-1",
          projectId: project.id,
          kind: "agent",
          threadId,
          agentId,
          worktreeId: worktree?.id,
          environmentId: environment.id,
          cwd: root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: { PATH: process.env.PATH ?? "" },
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        interruptTurn: () => true,
        resumeAfterApproval: async () => {
          throw new Error("not used");
        },
        runTurn: async (context: { turn: { id: string; threadId: string }; thread: { id: string } }) => {
          const completedTurn = database.updateTurn({
            ...database.getTurn(context.turn.id)!,
            status: "completed",
            updatedAt: new Date().toISOString(),
          });

          database.createItem({
            id: "item-agent-message",
            threadId: context.thread.id,
            turnId: context.turn.id,
            kind: "agentMessage",
            status: "completed",
            title: "Agent response",
            body: "Delegated fix complete.",
            createdAt: now,
            updatedAt: now,
          });
          database.createItem({
            id: "item-file-change",
            threadId: context.thread.id,
            turnId: context.turn.id,
            kind: "fileChange",
            status: "completed",
            title: "File change: src/app.ts",
            body: "{}",
            metadata: { path: "src/app.ts" },
            createdAt: now,
            updatedAt: now,
          });

          return completedTurn;
        },
      } as never,
      () => undefined,
    );

    const task = manager.spawn({
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: project.approvalPolicy,
      },
      project,
      parentThreadId: "thread-parent",
      parentTurnId: undefined,
      title: "Delegated task",
      input: "Fix the bug",
      globalInstructions: "",
    });

    const settled = await manager.wait(task.id, 1_000);

    expect(settled.status).toBe("completed");
    expect(settled.childThreadId).toBeTruthy();
    expect(settled.executionContextId).toBe("exec-1");
    expect(settled.summary).toMatchObject({
      finalMessage: "Delegated fix complete.",
      fileChangeCount: 1,
      changedPaths: ["src/app.ts"],
    });
    expect(database.listThreads().map((thread) => thread.id)).toEqual(["thread-parent"]);
  });

  it("waits for a running task to settle when timeout is infinite", async () => {
    vi.useFakeTimers();

    try {
      const root = mkdtempSync(join(tmpdir(), "yellow-flow-agent-"));
      const database = new HarnessDatabase(join(root, "app.db"));
      const project = database.listProjects()[0]!;
      const now = new Date().toISOString();

      database.createThread({
        id: "thread-parent-infinite",
        title: "Parent",
        projectId: project.id,
        hidden: false,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });

      const manager = new AgentTaskManager(
        database,
        {
          create: () => ({
            id: "worktree-infinite",
            projectId: project.id,
            agentId: "agent-placeholder",
            branch: "codex/test",
            path: root,
            status: "ready",
            createdAt: now,
            updatedAt: now,
          }),
          remove: () => undefined,
        } as never,
        {
          detect: ({ threadId, worktreeId, cwd }: { threadId?: string; worktreeId?: string; cwd?: string }) => ({
            id: "env-infinite",
            projectId: project.id,
            threadId,
            worktreeId,
            cwd: cwd ?? root,
            shell: process.platform === "win32" ? "powershell" : "bash",
            envJson: { PATH: process.env.PATH ?? "" },
            detectedTools: ["git", "node"],
            createdAt: now,
            updatedAt: now,
          }),
        } as never,
        {
          create: ({ threadId, agentId, environment, worktree }: { threadId?: string; agentId?: string; environment: { id: string }; worktree?: { id: string } }) => ({
            id: "exec-infinite",
            projectId: project.id,
            kind: "agent",
            threadId,
            agentId,
            worktreeId: worktree?.id,
            environmentId: environment.id,
            cwd: root,
            shell: process.platform === "win32" ? "powershell" : "bash",
            envJson: { PATH: process.env.PATH ?? "" },
            detectedTools: ["git", "node"],
            createdAt: now,
            updatedAt: now,
          }),
        } as never,
        {
          interruptTurn: () => true,
          resumeAfterApproval: async () => {
            throw new Error("not used");
          },
          runTurn: async (context: { turn: { id: string; threadId: string }; thread: { id: string } }) => {
            await new Promise<void>((resolve) => setTimeout(resolve, 250));
            const completedTurn = database.updateTurn({
              ...database.getTurn(context.turn.id)!,
              status: "completed",
              updatedAt: new Date().toISOString(),
            });

            database.createItem({
              id: "item-agent-message-infinite",
              threadId: context.thread.id,
              turnId: context.turn.id,
              kind: "agentMessage",
              status: "completed",
              title: "Agent response",
              body: "Infinite wait complete.",
              createdAt: now,
              updatedAt: now,
            });

            return completedTurn;
          },
        } as never,
        () => undefined,
      );

      const task = manager.spawn({
        provider: database.getConfig().provider,
        workspace: {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          shell: project.shell,
          sandboxMode: project.sandboxMode,
          approvalPolicy: project.approvalPolicy,
        },
        project,
        parentThreadId: "thread-parent-infinite",
        parentTurnId: undefined,
        title: "Delegated task",
        input: "Fix the bug",
        globalInstructions: "",
      });

      const settledPromise = manager.wait(task.id, Number.POSITIVE_INFINITY);
      const earlyResult = await Promise.race([
        settledPromise.then((settled) => settled.status),
        Promise.resolve("still-waiting"),
      ]);

      expect(earlyResult).toBe("still-waiting");

      await vi.advanceTimersByTimeAsync(250);

      await expect(settledPromise).resolves.toMatchObject({
        status: "completed",
        finalOutput: "Infinite wait complete.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
