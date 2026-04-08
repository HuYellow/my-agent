import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkflowManager } from "../src/services/workflow-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("WorkflowManager", () => {
  it("records executionContextId and artifactSummary for workflow steps", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-workflow-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const manager = new WorkflowManager(
      database,
      {
        create: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-1",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as never,
      {
        create: ({ environment }: { environment: { id: string; cwd: string; shell: string; envJson: {}; detectedTools: string[] } }) => ({
          id: "exec-1",
          projectId: project.id,
          kind: "workflow",
          cwd: environment.cwd,
          shell: environment.shell,
          envJson: environment.envJson,
          detectedTools: environment.detectedTools,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      } as never,
      {
        start: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        spawn: () => {
          throw new Error("not needed");
        },
      } as never,
      () => undefined,
      () => undefined,
    );

    const workflow = database.upsertWorkflow({
      id: "workflow-1",
      name: "Echo workflow",
      description: "Run a simple command",
      path: join(root, "echo.toml"),
      source: "user",
      steps: [
        {
          id: "step-1",
          type: "command",
          title: "Echo",
          command: "echo hello workflow",
          worktreeStrategy: "inherit",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await manager.run({
      workflowId: workflow.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      nonInteractive: true,
    });

    expect(result.stepsRun).toMatchObject([
      {
        stepId: "step-1",
        executionContextId: "exec-1",
      },
    ]);
    expect(result.stepsRun[0]?.artifactSummary).toBeTruthy();
  });

  it("executes review steps through the shared execution unit path", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-workflow-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    const workflow = database.upsertWorkflow({
      id: "workflow-review",
      name: "Review workflow",
      description: "Run a review step",
      path: join(root, "review.toml"),
      source: "user",
      steps: [
        {
          id: "step-review",
          type: "review",
          title: "Review staged changes",
          prompt: "Focus on correctness and missing tests.",
          reviewSource: { kind: "staged" },
          worktreeStrategy: "inherit",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const manager = new WorkflowManager(
      database,
      {
        create: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-1",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: () => ({
          id: "exec-review",
          projectId: project.id,
          kind: "workflow",
          cwd: root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        start: () => {
          const review = database.createReview({
            id: "review-1",
            projectId: project.id,
            status: "running",
            source: { kind: "staged" },
            findings: [],
            createdAt: now,
            updatedAt: now,
          });

          setTimeout(() => {
            database.updateReview({
              ...review,
              status: "completed",
              summary: "No blocking issues found.",
              executionContextId: "exec-review-step",
              findings: [],
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            });
          }, 10);

          return review;
        },
      } as never,
      {
        spawn: () => {
          throw new Error("not needed");
        },
      } as never,
      () => undefined,
      () => undefined,
    );

    const result = await manager.run({
      workflowId: workflow.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      nonInteractive: true,
    });

    expect(result.stepsRun).toMatchObject([
      {
        stepId: "step-review",
        status: "completed",
        executionContextId: "exec-review-step",
      },
    ]);
    expect(result.stepsRun[0]?.artifactSummary).toContain("No blocking issues found");
  });

  it("pauses on approval steps and resumes the remaining workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-workflow-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    const workflow = database.upsertWorkflow({
      id: "workflow-approval",
      name: "Approval workflow",
      description: "Pause for approval before continuing",
      path: join(root, "approval.toml"),
      source: "user",
      steps: [
        {
          id: "approve",
          type: "approval",
          title: "Await approval",
          approvalMessage: "Manual review required.",
          worktreeStrategy: "inherit",
        },
        {
          id: "ship",
          type: "command",
          title: "Ship build",
          command: process.platform === "win32" ? "Write-Output shipped" : "echo shipped",
          dependsOn: ["approve"],
          worktreeStrategy: "inherit",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const manager = new WorkflowManager(
      database,
      {
        create: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-approval",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: ({ environment }: { environment: { cwd: string; shell: string; envJson: {}; detectedTools: string[] } }) => ({
          id: `exec-${Math.random().toString(36).slice(2, 8)}`,
          projectId: project.id,
          kind: "workflow",
          cwd: environment.cwd,
          shell: environment.shell,
          envJson: environment.envJson,
          detectedTools: environment.detectedTools,
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        start: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        spawn: () => {
          throw new Error("not needed");
        },
      } as never,
      () => undefined,
      () => undefined,
    );

    const initial = await manager.run({
      workflowId: workflow.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      nonInteractive: false,
    });

    expect(initial.run.status).toBe("paused");
    expect(initial.run.pausedStepIds).toEqual(["approve"]);
    expect(initial.stepsRun).toEqual([]);

    const resumed = await manager.resume({
      runId: initial.run.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      approvePausedSteps: true,
    });

    expect(resumed.run.status).toBe("completed");
    expect(resumed.run.pausedStepIds).toEqual([]);
    expect(resumed.run.completedStepIds).toEqual(expect.arrayContaining(["approve", "ship"]));
    expect(resumed.stepsRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "approve",
          status: "completed",
          output: "Manual review required.",
        }),
        expect.objectContaining({
          stepId: "ship",
          status: "completed",
        }),
      ]),
    );
    expect(resumed.run.steps.find((step) => step.stepId === "approve")?.attempts).toBe(2);
  });

  it("executes agent steps through the shared execution unit path", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-workflow-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();
    const spawn = vi.fn().mockReturnValue({
      id: "agent-1",
      parentThreadId: "workflow-thread",
      title: "Delegate bugfix",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    const wait = vi.fn().mockResolvedValue({
      id: "agent-1",
      parentThreadId: "workflow-thread",
      title: "Delegate bugfix",
      status: "completed",
      finalOutput: "Delegated fix complete.",
      environmentId: "env-agent-step",
      executionContextId: "exec-agent-step",
      summary: {
        finalMessage: "Delegated fix complete.",
        toolCallCount: 2,
        fileChangeCount: 1,
        commandCount: 1,
        approvalRequestCount: 0,
        changedPaths: ["src/app.ts"],
      },
      createdAt: now,
      updatedAt: now,
    });

    const workflow = database.upsertWorkflow({
      id: "workflow-agent",
      name: "Agent workflow",
      description: "Run a delegated agent step",
      path: join(root, "agent.toml"),
      source: "user",
      steps: [
        {
          id: "delegate",
          type: "agent",
          title: "Delegate bugfix",
          prompt: "Fix the regression and summarize the result.",
          worktreeStrategy: "inherit",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const manager = new WorkflowManager(
      database,
      {
        create: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-workflow-agent",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: ({ environment }: { environment: { cwd: string; shell: string; envJson: {}; detectedTools: string[] } }) => ({
          id: "exec-workflow-agent",
          projectId: project.id,
          kind: "workflow",
          cwd: environment.cwd,
          shell: environment.shell,
          envJson: environment.envJson,
          detectedTools: environment.detectedTools,
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        start: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        spawn,
        wait,
      } as never,
      () => undefined,
      () => undefined,
    );

    const result = await manager.run({
      workflowId: workflow.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      nonInteractive: true,
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delegate bugfix",
        input: "Fix the regression and summarize the result.",
      }),
    );
    expect(wait).toHaveBeenCalledWith("agent-1", 120_000);
    expect(result.stepsRun).toMatchObject([
      {
        stepId: "delegate",
        status: "completed",
        agentId: "agent-1",
        executionContextId: "exec-agent-step",
        artifactSummary: "Delegated fix complete.",
      },
    ]);
  });

  it("retries failed steps and continues downstream workflow execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-workflow-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();
    const failedTask = {
      id: "agent-fail",
      parentThreadId: "workflow-thread",
      title: "Delegate bugfix",
      status: "failed" as const,
      finalOutput: "Initial attempt failed.",
      createdAt: now,
      updatedAt: now,
    };
    const recoveredTask = {
      id: "agent-retry",
      parentThreadId: "workflow-thread",
      title: "Delegate bugfix",
      status: "completed" as const,
      finalOutput: "Delegated fix complete.",
      environmentId: "env-agent-retry",
      executionContextId: "exec-agent-retry",
      summary: {
        finalMessage: "Delegated fix complete.",
        toolCallCount: 2,
        fileChangeCount: 1,
        commandCount: 1,
        approvalRequestCount: 0,
        changedPaths: ["src/app.ts"],
      },
      createdAt: now,
      updatedAt: now,
    };
    const spawn = vi
      .fn()
      .mockReturnValueOnce({
        id: failedTask.id,
        parentThreadId: "workflow-thread",
        title: "Delegate bugfix",
        status: "running",
        createdAt: now,
        updatedAt: now,
      })
      .mockReturnValueOnce({
        id: recoveredTask.id,
        parentThreadId: "workflow-thread",
        title: "Delegate bugfix",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    const wait = vi.fn().mockImplementation(async (agentId: string) => {
      if (agentId === failedTask.id) {
        return failedTask;
      }

      if (agentId === recoveredTask.id) {
        return recoveredTask;
      }

      throw new Error(`Unexpected agent id: ${agentId}`);
    });

    const workflow = database.upsertWorkflow({
      id: "workflow-retry",
      name: "Retry workflow",
      description: "Retry a failed delegated step",
      path: join(root, "retry.toml"),
      source: "user",
      steps: [
        {
          id: "delegate",
          type: "agent",
          title: "Delegate bugfix",
          prompt: "Fix the regression and summarize the result.",
          worktreeStrategy: "inherit",
        },
        {
          id: "ship",
          type: "command",
          title: "Ship build",
          command: process.platform === "win32" ? "Write-Output shipped" : "echo shipped",
          dependsOn: ["delegate"],
          worktreeStrategy: "inherit",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const manager = new WorkflowManager(
      database,
      {
        create: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-retry",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: ({ environment }: { environment: { cwd: string; shell: string; envJson: {}; detectedTools: string[] } }) => ({
          id: `exec-${Math.random().toString(36).slice(2, 8)}`,
          projectId: project.id,
          kind: "workflow",
          cwd: environment.cwd,
          shell: environment.shell,
          envJson: environment.envJson,
          detectedTools: environment.detectedTools,
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        start: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        spawn,
        wait,
      } as never,
      () => undefined,
      () => undefined,
    );

    const initial = await manager.run({
      workflowId: workflow.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      nonInteractive: true,
    });

    expect(initial.run.status).toBe("failed");
    expect(initial.run.failedStepIds).toEqual(["delegate"]);
    expect(initial.run.steps.find((step) => step.stepId === "delegate")?.attempts).toBe(1);

    const resumed = await manager.resume({
      runId: initial.run.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      retryFailedStepIds: ["delegate"],
    });

    expect(resumed.run.status).toBe("completed");
    expect(resumed.run.failedStepIds).toEqual([]);
    expect(resumed.run.completedStepIds).toEqual(expect.arrayContaining(["delegate", "ship"]));
    expect(resumed.run.steps.find((step) => step.stepId === "delegate")?.attempts).toBe(2);
    expect(resumed.run.steps.find((step) => step.stepId === "delegate")?.retainedFailures).toEqual([
      expect.objectContaining({
        attempt: 1,
        output: "Initial attempt failed.",
      }),
    ]);
    expect(resumed.stepsRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "delegate",
          status: "completed",
          executionContextId: "exec-agent-retry",
        }),
        expect.objectContaining({
          stepId: "ship",
          status: "completed",
        }),
      ]),
    );
  });

  it("rejects retry requests for steps that are not failed", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-workflow-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    const workflow = database.upsertWorkflow({
      id: "workflow-invalid-retry",
      name: "Invalid retry workflow",
      description: "Reject invalid retry requests",
      path: join(root, "invalid-retry.toml"),
      source: "user",
      steps: [
        {
          id: "step-1",
          type: "command",
          title: "Echo",
          command: process.platform === "win32" ? "Write-Output ok" : "echo ok",
          worktreeStrategy: "inherit",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const manager = new WorkflowManager(
      database,
      {
        create: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-invalid-retry",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git", "node"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: ({ environment }: { environment: { cwd: string; shell: string; envJson: {}; detectedTools: string[] } }) => ({
          id: "exec-invalid-retry",
          projectId: project.id,
          kind: "workflow",
          cwd: environment.cwd,
          shell: environment.shell,
          envJson: environment.envJson,
          detectedTools: environment.detectedTools,
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        start: () => {
          throw new Error("not needed");
        },
      } as never,
      {
        spawn: () => {
          throw new Error("not needed");
        },
      } as never,
      () => undefined,
      () => undefined,
    );

    const run = await manager.run({
      workflowId: workflow.id,
      project,
      provider: database.getConfig().provider,
      workspace: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        shell: project.shell,
        sandboxMode: project.sandboxMode,
        approvalPolicy: "never",
      },
      nonInteractive: true,
    });

    await expect(
      manager.resume({
        runId: run.run.id,
        project,
        provider: database.getConfig().provider,
        workspace: {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          shell: project.shell,
          sandboxMode: project.sandboxMode,
          approvalPolicy: "never",
        },
        retryFailedStepIds: ["step-1"],
      }),
    ).rejects.toThrow("is not in a failed state");
  });
});
