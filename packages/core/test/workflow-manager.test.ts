import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
