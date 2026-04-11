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

  it("stores requirement entities, thread bindings, and structured memories", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const primaryProject = database.listProjects()[0]!;
    const relatedProject = database.createProject({
      id: "project-related",
      name: "Related",
      rootPath: root,
      shell: process.platform === "win32" ? "powershell" : "bash",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();

    database.createRequirement({
      id: "requirement-1",
      title: "Ship requirement memory",
      status: "active",
      primaryProjectId: primaryProject.id,
      relatedProjectIds: [relatedProject.id],
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    database.upsertRequirementMemory({
      requirementId: "requirement-1",
      manual: {
        brief: "Shared memory for a requirement.",
        goals: ["Ship the new model"],
        constraints: [],
        decisions: ["Keep one thread per requirement binding"],
        openQuestions: [],
        definitionOfDone: ["Desktop UI loads requirements"],
      },
      derived: {
        linkedProjects: [],
        linkedThreads: [],
        recentReviews: [],
        recentArtifacts: [],
        recentChanges: ["src/app.ts"],
        activitySummary: "1 changed path",
      },
      updatedAt: now,
      lastRebuiltAt: now,
    });
    database.createThread({
      id: "thread-requirement",
      title: "Requirement thread",
      projectId: primaryProject.id,
      requirementId: "requirement-1",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    expect(database.getRequirement("requirement-1")).toMatchObject({
      primaryProjectId: primaryProject.id,
      relatedProjectIds: [relatedProject.id],
    });
    expect(database.getRequirementMemory("requirement-1")).toMatchObject({
      manual: {
        brief: "Shared memory for a requirement.",
      },
      derived: {
        recentChanges: ["src/app.ts"],
      },
    });
    expect(database.getThread("thread-requirement")).toMatchObject({
      requirementId: "requirement-1",
    });
  });

  it("stores automations and run history", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();

    database.createAutomation({
      id: "automation-1",
      name: "Nightly review",
      kind: "workflow",
      projectId: project.id,
      workflowId: "workflow-1",
      scheduleType: "interval",
      intervalMinutes: 60,
      status: "active",
      lastRunStatus: "idle",
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    });
    database.createAutomationRun({
      id: "automation-run-1",
      automationId: "automation-1",
      kind: "workflow",
      projectId: project.id,
      status: "completed",
      trigger: "manual",
      runner: "core",
      artifacts: [],
      workflowRunId: "workflow-run-1",
      summary: "Completed successfully.",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    expect(database.getAutomation("automation-1")).toMatchObject({
      kind: "workflow",
      intervalMinutes: 60,
    });
    expect(database.listAutomationRuns({ projectId: project.id })).toMatchObject([
      {
        id: "automation-run-1",
        automationId: "automation-1",
        workflowRunId: "workflow-run-1",
      },
    ]);
  });

  it("stores managed plugin and internal tool metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-db-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const now = new Date().toISOString();

    database.upsertPlugin({
      id: "plugin-1",
      name: "Sample plugin",
      version: "1.0.0",
      path: join(root, "plugins", "sample-plugin"),
      manifestPath: join(root, "plugins", "sample-plugin", ".codex-plugin", "plugin.json"),
      source: "repo",
      enabled: true,
      trusted: true,
      capabilities: ["network"],
      toolName: "sample_echo",
      sandboxMode: "read-only",
      command: process.execPath,
      args: ["-v"],
      validationErrors: [],
      createdAt: now,
      updatedAt: now,
    });

    database.upsertInternalTool({
      id: "internal-tool-1",
      name: "notify_team",
      description: "Send an internal notification",
      path: join(root, "internal-tools", "notify.json"),
      source: "user",
      enabled: false,
      endpoint: "https://example.test/internal",
      method: "POST",
      timeoutMs: 15_000,
      approvalRequired: true,
      approvalReason: "Contacts an internal API.",
      writes: false,
      network: true,
      parametersSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
        additionalProperties: false,
      },
      validationErrors: ["Missing API token header."],
      createdAt: now,
      updatedAt: now,
    });

    expect(database.getPlugin("plugin-1")).toMatchObject({
      manifestPath: join(root, "plugins", "sample-plugin", ".codex-plugin", "plugin.json"),
      trusted: true,
      toolName: "sample_echo",
    });
    expect(database.listInternalTools()).toMatchObject([
      {
        id: "internal-tool-1",
        enabled: false,
        timeoutMs: 15_000,
        approvalRequired: true,
        validationErrors: ["Missing API token header."],
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

    database.upsertTerminalApprovalRule({
      sessionId: "terminal-1",
      approvalKey: "run_shell:key",
      createdAt: now,
      updatedAt: now,
    });

    expect(database.hasTerminalApprovalRule("terminal-1", "run_shell:key")).toBe(true);
    database.clearTerminalApprovalRules("terminal-1");
    expect(database.hasTerminalApprovalRule("terminal-1", "run_shell:key")).toBe(false);
  });
});
