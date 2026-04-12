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
