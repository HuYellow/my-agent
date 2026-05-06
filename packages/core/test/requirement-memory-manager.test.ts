import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentTaskRecord, ProjectRecord, RequirementRecord, ThreadRecord, WorkflowRecord } from "@my-agent/protocol";
import { RequirementMemoryManager } from "../src/services/requirement-memory-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("RequirementMemoryManager", () => {
  it("normalizes manual memory and renders a prompt context section", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-req-memory-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = createProject(database, "project-primary", "Primary Project", root);
    const requirement = createRequirement(database, "requirement-1", project.id);
    const manager = new RequirementMemoryManager(database, () => undefined);

    const updated = manager.updateManualMemory(requirement.id, {
      brief: "  Build a durable coding agent.  ",
      goals: ["Ship tests", "Ship tests", ""],
      constraints: ["Keep sandboxed execution"],
      decisions: ["Use SQLite persistence", "Use SQLite persistence"],
      openQuestions: ["How should approvals be surfaced?"],
      definitionOfDone: ["Desktop UI renders structured runtime state"],
    });
    const rebuilt = manager.rebuild(requirement.id);
    const prompt = manager.buildPromptContextSection(requirement.id);

    expect(updated.manual).toEqual({
      brief: "Build a durable coding agent.",
      goals: ["Ship tests"],
      constraints: ["Keep sandboxed execution"],
      decisions: ["Use SQLite persistence"],
      openQuestions: ["How should approvals be surfaced?"],
      definitionOfDone: ["Desktop UI renders structured runtime state"],
    });
    expect(rebuilt.lastRebuiltAt).toBeTruthy();
    expect(prompt).toContain("# Requirement Context");
    expect(prompt).toContain("Requirement: Ship requirement");
    expect(prompt).toContain("Goals: Ship tests");
    expect(prompt).toContain("Definition of done: Desktop UI renders structured runtime state");
  });

  it("rebuilds derived memory from linked threads, reviews, workflow runs, and agent outputs", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-req-memory-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const primaryProject = createProject(database, "project-primary", "Primary Project", join(root, "primary"));
    const relatedProject = createProject(database, "project-related", "Related Project", join(root, "related"));
    const requirement = createRequirement(database, "requirement-1", primaryProject.id, [relatedProject.id]);
    const now = new Date().toISOString();
    const visibleThread = createThread(database, {
      id: "thread-visible",
      title: "Visible Thread",
      projectId: primaryProject.id,
      requirementId: requirement.id,
      sandboxMode: primaryProject.sandboxMode,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    const hiddenThread = createThread(database, {
      id: "thread-hidden",
      title: "Delegated Thread",
      projectId: relatedProject.id,
      requirementId: requirement.id,
      sandboxMode: relatedProject.sandboxMode,
      hidden: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    database.createTurn({
      id: "turn-visible",
      threadId: visibleThread.id,
      status: "completed",
      input: "Ship the memory layer",
      createdAt: now,
      updatedAt: now,
    });
    database.createItem({
      id: "item-file-change",
      threadId: visibleThread.id,
      turnId: "turn-visible",
      kind: "fileChange",
      status: "completed",
      title: "File change: src/app.ts",
      body: "{}",
      metadata: { path: "src/app.ts" },
      createdAt: now,
      updatedAt: now,
    });
    database.createItem({
      id: "item-agent-message",
      threadId: visibleThread.id,
      turnId: "turn-visible",
      kind: "agentMessage",
      status: "completed",
      title: "Agent response",
      body: "Requirement memory now explains current state.",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    database.createTurn({
      id: "turn-hidden",
      threadId: hiddenThread.id,
      status: "failed",
      input: "Try a delegated update",
      createdAt: now,
      updatedAt: now,
    });
    database.createItem({
      id: "item-hidden-agent-message",
      threadId: hiddenThread.id,
      turnId: "turn-hidden",
      kind: "agentMessage",
      status: "failed",
      title: "Agent response",
      body: "Delegated update failed during verification.",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    database.createReview({
      id: "review-1",
      projectId: primaryProject.id,
      requirementId: requirement.id,
      threadId: hiddenThread.id,
      status: "completed",
      source: { kind: "workspace" },
      summary: "Review completed with one follow-up.",
      findings: [],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    const workflow = createWorkflow(database, root, primaryProject.id);
    database.createWorkflowRun({
      id: "workflow-run-1",
      workflowId: workflow.id,
      projectId: primaryProject.id,
      requirementId: requirement.id,
      threadId: visibleThread.id,
      status: "completed",
      pendingStepIds: [],
      pausedStepIds: [],
      completedStepIds: ["step-1"],
      failedStepIds: [],
      steps: [
        {
          stepId: "step-1",
          status: "completed",
          attempts: 1,
          artifactSummary: "Generated a release checklist.",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    database.createAgentTask({
      id: "agent-1",
      parentThreadId: visibleThread.id,
      childThreadId: hiddenThread.id,
      title: "Delegate memory update",
      status: "completed",
      summary: {
        finalMessage: "Memory update applied.",
        toolCallCount: 2,
        fileChangeCount: 1,
        commandCount: 1,
        approvalRequestCount: 0,
        changedPaths: ["src/memory.ts"],
      },
      finalOutput: "Memory update applied.",
      createdAt: now,
      updatedAt: now,
    } as AgentTaskRecord);

    const manager = new RequirementMemoryManager(database, () => undefined);
    const rebuilt = manager.rebuild(requirement.id);

    expect(rebuilt.derived.linkedProjects).toMatchObject([
      {
        projectId: primaryProject.id,
        role: "primary",
      },
      {
        projectId: relatedProject.id,
        role: "related",
      },
    ]);
    expect(rebuilt.derived.linkedThreads).toMatchObject([
      {
        threadId: "thread-visible",
        hidden: false,
      },
      {
        threadId: "thread-hidden",
        hidden: true,
      },
    ]);
    expect(rebuilt.derived.recentReviews).toMatchObject([
      {
        reviewId: "review-1",
        summary: "Review completed with one follow-up.",
      },
    ]);
    expect(rebuilt.derived.recentArtifacts.map((artifact) => artifact.source)).toEqual(
      expect.arrayContaining(["review", "workflow", "agent"]),
    );
    expect(rebuilt.derived.recentChanges).toEqual(["src/app.ts", "src/memory.ts"]);
    expect(rebuilt.derived.activitySummary).toContain("2 linked threads");
    expect(rebuilt.derived.activitySummary).toContain("1 delegated thread");
    expect(rebuilt.derived.activitySummary).toContain("1 review");
    expect(rebuilt.derived.activitySummary).toContain("1 workflow run");
    expect((rebuilt.derived as any).threadSummaries).toMatchObject([
      {
        threadId: "thread-visible",
        title: "Visible Thread",
        hidden: false,
        latestTurnStatus: "completed",
        latestFinalMessage: "Requirement memory now explains current state.",
      },
      {
        threadId: "thread-hidden",
        title: "Delegated Thread",
        hidden: true,
        latestTurnStatus: "failed",
        latestFinalMessage: "Delegated update failed during verification.",
      },
    ]);
    expect((rebuilt.derived as any).recentTurns).toMatchObject([
      {
        turnId: "turn-visible",
        threadId: "thread-visible",
        threadTitle: "Visible Thread",
        status: "completed",
        finalMessage: "Requirement memory now explains current state.",
      },
      {
        turnId: "turn-hidden",
        threadId: "thread-hidden",
        threadTitle: "Delegated Thread",
        status: "failed",
        finalMessage: "Delegated update failed during verification.",
      },
    ]);
  });

  it("renders prompt context in requirement memory order", () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-req-memory-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = createProject(database, "project-primary", "Primary Project", root);
    const requirement = createRequirement(database, "requirement-1", project.id);
    const manager = new RequirementMemoryManager(database, () => undefined);
    const now = new Date().toISOString();

    manager.updateManualMemory(requirement.id, {
      goals: ["Keep requirement context deterministic"],
      decisions: ["Use structured runtime state only"],
    });
    createThread(database, {
      id: "thread-1",
      title: "Implementation thread",
      projectId: project.id,
      requirementId: requirement.id,
      sandboxMode: project.sandboxMode,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    database.createTurn({
      id: "turn-1",
      threadId: "thread-1",
      status: "completed",
      input: "Implement requirement context",
      createdAt: now,
      updatedAt: now,
    });
    database.createItem({
      id: "item-final",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "agentMessage",
      status: "completed",
      title: "Agent response",
      body: "Requirement context builder landed.",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    database.createItem({
      id: "item-change",
      threadId: "thread-1",
      turnId: "turn-1",
      kind: "fileChange",
      status: "completed",
      title: "File change: src/context.ts",
      body: "{}",
      metadata: { path: "src/context.ts" },
      createdAt: now,
      updatedAt: now,
    });

    manager.rebuild(requirement.id);
    const prompt = manager.buildPromptContextSection(requirement.id)!;

    expect(prompt).toContain("## Goals / Constraints / Decisions");
    expect(prompt).toContain("## Current Activity Digest");
    expect(prompt).toContain("## Recent Artifacts");
    expect(prompt).toContain("## Recent Changed Paths");
    expect(prompt).toContain("## Linked Thread Status");
    expect(prompt.indexOf("## Goals / Constraints / Decisions")).toBeLessThan(prompt.indexOf("## Current Activity Digest"));
    expect(prompt.indexOf("## Current Activity Digest")).toBeLessThan(prompt.indexOf("## Recent Artifacts"));
    expect(prompt.indexOf("## Recent Artifacts")).toBeLessThan(prompt.indexOf("## Recent Changed Paths"));
    expect(prompt.indexOf("## Recent Changed Paths")).toBeLessThan(prompt.indexOf("## Linked Thread Status"));
    expect(prompt).toContain("Implementation thread: completed");
  });
});

function createProject(database: HarnessDatabase, id: string, name: string, rootPath: string): ProjectRecord {
  const now = new Date().toISOString();
  return database.createProject({
    id,
    name,
    rootPath,
    shell: process.platform === "win32" ? "powershell" : "bash",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    createdAt: now,
    updatedAt: now,
  });
}

function createRequirement(
  database: HarnessDatabase,
  id: string,
  primaryProjectId: string,
  relatedProjectIds: string[] = [],
): RequirementRecord {
  const now = new Date().toISOString();
  return database.createRequirement({
    id,
    title: "Ship requirement",
    status: "active",
    primaryProjectId,
    relatedProjectIds,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

function createThread(database: HarnessDatabase, thread: ThreadRecord): ThreadRecord {
  return database.createThread(thread);
}

function createWorkflow(database: HarnessDatabase, root: string, projectId: string): WorkflowRecord {
  const now = new Date().toISOString();
  return database.upsertWorkflow({
    id: "workflow-1",
    name: "Requirement workflow",
    description: "Collect release notes",
    path: join(root, "workflow.toml"),
    source: "user",
    steps: [],
    createdAt: now,
    updatedAt: now,
  });
}
