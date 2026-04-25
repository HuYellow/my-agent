import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RequirementMemoryRecord, ReviewArtifactRecord, ReviewRecord, ToolCatalogRecord } from "@my-agent/protocol";
import { useAppStore } from "./store";

const initialSession = {
  turns: [],
  items: [],
  turnContexts: [],
  turnPlans: [],
  turnDiffs: [],
  pendingApproval: null,
  submitting: false,
};

afterEach(() => {
  useAppStore.setState({
    agentTasks: [],
    environments: [],
    executionContexts: [],
    requirementMemories: [],
    requirements: [],
    reviews: [],
    reviewArtifacts: {},
    runtimeTools: [],
    protocolCompatibility: undefined,
    terminals: [],
    templates: [],
    terminalOutputArchives: [],
    terminalCapabilities: [],
    terminalOutputs: {},
    threadSessions: {},
    workflows: [],
    workflowRuns: [],
    worktrees: [],
  } as never);
});

describe("desktop thread smoke", () => {
  it("passes the active requirement into new threads, reviews, and automations", async () => {
    const calls: { startThread: unknown[]; startReview: unknown[]; createAutomation: unknown[] } = {
      startThread: [],
      startReview: [],
      createAutomation: [],
    };
    const now = new Date().toISOString();

    (globalThis as any).window = {
      myAgent: {
        startThread: async (params: unknown) => {
          calls.startThread.push(params);
          return {
            thread: {
              id: "thread-created",
              title: "New Thread",
              projectId: "project-1",
              requirementId: "requirement-1",
              sandboxMode: "workspace-write",
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
            },
          };
        },
        startReview: async (params: unknown) => {
          calls.startReview.push(params);
          return {
            review: {
              id: "review-created",
              projectId: "project-1",
              requirementId: "requirement-1",
              status: "running",
              source: { kind: "workspace" },
              findings: [],
              createdAt: now,
              updatedAt: now,
            },
          };
        },
        createAutomation: async (params: unknown) => {
          calls.createAutomation.push(params);
          return {
            automation: {
              id: "automation-created",
              name: "Daily check",
              kind: "prompt",
              projectId: "project-1",
              requirementId: "requirement-1",
              prompt: "Check status",
              scheduleType: "manual",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          };
        },
      },
    };
    useAppStore.setState({
      projects: [
        {
          id: "project-1",
          name: "Project",
          rootPath: "/workspace",
          shell: "bash",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: now,
          updatedAt: now,
        },
      ],
      requirements: [
        {
          id: "requirement-1",
          title: "Requirement",
          status: "active",
          primaryProjectId: "project-1",
          relatedProjectIds: [],
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        },
      ],
      activeProjectId: "project-1",
      activeRequirementId: "requirement-1",
      activeThreadId: undefined,
      config: {
        globalInstructions: "",
        selectedProjectId: "project-1",
        selectedRequirementId: "requirement-1",
        provider: {
          id: "provider",
          name: "Provider",
          baseUrl: "",
          apiKey: "",
          model: "model",
          apiFlavor: "responses",
        },
        workspace: {
          id: "workspace",
          name: "Workspace",
          rootPath: "/workspace",
          shell: "bash",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
        },
        disabledSkillIds: [],
      },
    } as never);

    await useAppStore.getState().createThread();
    await useAppStore.getState().startReview({ projectId: "project-1", source: { kind: "workspace" } });
    await useAppStore.getState().createAutomation({
      name: "Daily check",
      kind: "prompt",
      projectId: "project-1",
      prompt: "Check status",
      scheduleType: "manual",
    });

    expect(calls.startThread[0]).toMatchObject({ requirementId: "requirement-1" });
    expect(calls.startReview[0]).toMatchObject({ requirementId: "requirement-1" });
    expect(calls.createAutomation[0]).toMatchObject({ requirementId: "requirement-1" });
  });

  it("updates requirement memory immediately from unassign responses", async () => {
    const now = new Date().toISOString();
    const refreshedMemory: RequirementMemoryRecord = {
      requirementId: "requirement-1",
      manual: {
        brief: "",
        goals: [],
        constraints: [],
        decisions: [],
        openQuestions: [],
        definitionOfDone: [],
      },
      derived: {
        linkedProjects: [],
        linkedThreads: [],
        recentReviews: [],
        recentArtifacts: [],
        recentChanges: [],
        activitySummary: "0 linked threads",
      },
      updatedAt: now,
      lastRebuiltAt: now,
    };

    (globalThis as any).window = {
      myAgent: {
        unassignThreadFromRequirement: async () => ({
          thread: {
            id: "thread-1",
            title: "Thread",
            projectId: "project-1",
            sandboxMode: "workspace-write",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          },
          requirementId: "requirement-1",
          memory: refreshedMemory,
        }),
      },
    };
    useAppStore.setState({
      activeRequirementId: "requirement-1",
      activeThreadId: undefined,
      threads: [
        {
          id: "thread-1",
          title: "Thread",
          projectId: "project-1",
          requirementId: "requirement-1",
          sandboxMode: "workspace-write",
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        },
      ],
      requirementMemories: [
        {
          ...refreshedMemory,
          derived: {
            ...refreshedMemory.derived,
            linkedThreads: [
              {
                threadId: "thread-1",
                title: "Thread",
                projectId: "project-1",
                updatedAt: now,
                hidden: false,
              },
            ],
            activitySummary: "1 linked thread",
          },
        },
      ],
    } as never);

    await useAppStore.getState().unassignThreadFromRequirement("thread-1");

    expect(useAppStore.getState().threads[0]?.requirementId).toBeUndefined();
    expect(useAppStore.getState().activeRequirementId).toBe("requirement-1");
    expect(useAppStore.getState().requirementMemories[0]?.derived.linkedThreads).toEqual([]);
  });

  it("binds steer and review events into UI state", () => {
    useAppStore.setState({
      reviews: [],
      terminalOutputs: {},
      threadSessions: {
        "thread-1": { ...initialSession },
      },
    } as never);

    useAppStore.getState().handleEvent({
      type: "turn/steered",
      payload: {
        steer: {
          id: "steer-1",
          turnId: "turn-1",
          threadId: "thread-1",
          input: "Stop and summarize first.",
          priority: "high",
          visibility: "user",
          status: "queued",
          createdAt: new Date().toISOString(),
        },
      },
    });

    const review: ReviewRecord = {
      id: "review-1",
      projectId: "project-1",
      threadId: "thread-1",
      status: "completed",
      source: { kind: "workspace" },
      summary: "One review issue found.",
      findings: [
        {
          id: "finding-1",
          severity: "medium",
          summary: "Add a missing test",
          file: "src/app.ts",
          line: 9,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    useAppStore.getState().handleEvent({
      type: "review/result",
      payload: {
        review,
        artifact: {
          sourceLabel: "Workspace diff",
          findingCounts: {
            total: 1,
            critical: 0,
            high: 0,
            medium: 1,
            low: 0,
          },
        } satisfies ReviewArtifactRecord,
      },
    });

    const state = useAppStore.getState();
    expect(state.threadSessions["thread-1"]?.items).toMatchObject([
      {
        id: "steer-1",
        title: "Steer input",
        body: "Stop and summarize first.",
      },
    ]);
    expect(state.reviews).toMatchObject([
      {
        id: "review-1",
        findings: [
          {
            id: "finding-1",
            summary: "Add a missing test",
          },
        ],
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "terminal/updated",
      payload: {
        session: {
          id: "terminal-1",
          threadId: "thread-1",
          workspaceId: "project-1",
          cwd: "/workspace",
          shell: "bash",
          backend: "pipe",
          status: "failed",
          exitCode: 1,
          failureReason: "spawn failed",
          startedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    expect(useAppStore.getState().terminals).toMatchObject([
      {
        id: "terminal-1",
        status: "failed",
        exitCode: 1,
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "terminal/output",
      payload: {
        sessionId: "terminal-1",
        threadId: "thread-1",
        delta: "hello from terminal\n",
        timestamp: new Date().toISOString(),
      },
    });

    expect(useAppStore.getState().terminalOutputs["terminal-1"]).toContain("hello from terminal");

    useAppStore.getState().handleEvent({
      type: "terminal/outputArchived",
      payload: {
        archive: {
          id: "archive-1",
          sessionId: "terminal-1",
          threadId: "thread-1",
          reason: "manual_archive",
          output: "older output",
          createdAt: new Date().toISOString(),
        },
      },
    });
    expect(useAppStore.getState().terminalOutputArchives).toMatchObject([
      {
        id: "archive-1",
        sessionId: "terminal-1",
        reason: "manual_archive",
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "terminal/outputCleared",
      payload: {
        sessionId: "terminal-1",
        threadId: "thread-1",
        timestamp: new Date().toISOString(),
      },
    });
    expect(useAppStore.getState().terminalOutputs["terminal-1"]).toBe("");

    useAppStore.getState().handleEvent({
      type: "agent/updated",
      payload: {
        task: {
          id: "agent-1",
          parentThreadId: "thread-1",
          title: "Delegate fix",
          status: "running",
          executionContextId: "exec-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
    useAppStore.getState().handleEvent({
      type: "executionContext/updated",
      payload: {
        executionContext: {
          id: "exec-1",
          projectId: "project-1",
          kind: "workflow",
          threadId: "thread-1",
          cwd: "/workspace",
          shell: "bash",
          envJson: {},
          detectedTools: ["git"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
    useAppStore.getState().handleEvent({
      type: "workflow/run",
      payload: {
        run: {
          id: "workflow-run-1",
          workflowId: "workflow-1",
          projectId: "project-1",
          status: "running",
          pendingStepIds: [],
          pausedStepIds: [],
          completedStepIds: ["step-1"],
          failedStepIds: [],
          steps: [
            {
              stepId: "step-1",
              status: "completed",
              attempts: 1,
              artifactSummary: "Prepared output",
              executionContextId: "exec-1",
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const runtimeState = useAppStore.getState();
    expect(runtimeState.agentTasks).toMatchObject([
      {
        id: "agent-1",
        executionContextId: "exec-1",
      },
    ]);
    expect(runtimeState.executionContexts).toMatchObject([
      {
        id: "exec-1",
        kind: "workflow",
      },
    ]);
    expect(runtimeState.workflowRuns).toMatchObject([
      {
        id: "workflow-run-1",
        steps: [
          {
            stepId: "step-1",
            executionContextId: "exec-1",
          },
        ],
      },
    ]);
    expect(state.reviewArtifacts["review-1"]).toMatchObject({
      sourceLabel: "Workspace diff",
      findingCounts: {
        total: 1,
      },
    });

    useAppStore.getState().handleEvent({
      type: "turn/planUpdated",
      payload: {
        plan: {
          turnId: "turn-1",
          threadId: "thread-1",
          title: "Execution plan",
          steps: [
            {
              id: "step-1",
              title: "Wire structured events",
              status: "pending",
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });
    useAppStore.getState().handleEvent({
      type: "turn/diffUpdated",
      payload: {
        diff: {
          id: "turn-1",
          turnId: "turn-1",
          threadId: "thread-1",
          label: "Turn 1",
          stats: {
            fileCount: 1,
            additions: 4,
            deletions: 1,
          },
          files: [
            {
              itemId: "item-diff-1",
              turnId: "turn-1",
              path: "src/runtime.ts",
              title: "File change: src/runtime.ts",
              status: "modified",
              additions: 4,
              deletions: 1,
              patch: "@@ -1 +1 @@",
              updatedAt: new Date().toISOString(),
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    expect(useAppStore.getState().threadSessions["thread-1"]?.turnPlans).toMatchObject([
      {
        turnId: "turn-1",
        steps: [
          {
            title: "Wire structured events",
          },
        ],
      },
    ]);
    expect(useAppStore.getState().threadSessions["thread-1"]?.turnDiffs).toMatchObject([
      {
        turnId: "turn-1",
        files: [
          {
            path: "src/runtime.ts",
            additions: 4,
          },
        ],
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "tools/catalogUpdated",
      payload: {
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            enabled: true,
            source: {
              type: "local",
              label: "Local workspace",
            },
            capability: {
              writes: false,
              network: false,
              interactive: false,
              approvalModes: ["none"],
              riskLevel: "safe_read",
              streamedOutput: false,
              resumable: false,
            },
          },
        ] satisfies ToolCatalogRecord[],
      },
    });
    expect(useAppStore.getState().runtimeTools).toMatchObject([
      {
        name: "read_file",
        source: {
          type: "local",
        },
      },
    ]);
  });

  it("renders review and steer entrypoints in the thread view source", () => {
    const source = readFileSync(join(process.cwd(), "src", "renderer", "App.tsx"), "utf8");

    expect(source).toContain("ReviewSummaryCard");
    expect(source).toContain("SteerCard");
    expect(source).toContain("TerminalCard");
    expect(source).toContain("DiffPatchPanel");
    expect(source).toContain("PlanWorkspacePanel");
    expect(source).toContain("ReviewFindingsPanel");
    expect(source).toContain("ThreadRuntimePanel");
    expect(source).toContain("threadWorkspaceView");
    expect(source).toContain("Review Findings");
    expect(source).toContain("Runtime");
    expect(source).toContain("Templates & Distribution");
    expect(source).toContain("DistributionTemplatesCard");
    expect(source).toContain("Scaffold Template");
    expect(source).toContain("Plan");
    expect(source).toContain("Open Turn");
    expect(source).toContain("Open Review");
    expect(source).toContain("Open Child Thread");
    expect(source).toContain("Runtime Detail");
    expect(source).toContain("Diff / Patch");
    expect(source).toContain("workspace-toggle");
    expect(source).toContain("buildThreadChangeSets");
    expect(source).toContain("threadTerminals");
    expect(source).toContain("selectedTerminalId");
    expect(source).toContain("reviewMenuOpen");
    expect(source).toContain("triggerReview");
    expect(source).toContain("terminalSessions");
    expect(source).toContain("terminalCapabilities");
    expect(source).toContain("createTerminalSession");
    expect(source).toContain("sendTerminalInput");
    expect(source).toContain("respondTerminalApproval");
    expect(source).toContain("archiveTerminal");
    expect(source).toContain("clearTerminal");
    expect(source).toContain("Archived output");
    expect(source).toContain("artifactSummary");
    expect(source).toContain("executionContextId");
    expect(source).toContain("Failure artifacts");
    expect(source).toContain("Retry step");
    expect(source).toContain("retainedFailures");
    expect(source).toContain("RuntimeMetaSection");
    expect(source).toContain("RuntimeAgentTree");
    expect(source).toContain("RuntimeContextLineage");
    expect(source).toContain("buildExecutionContextLineage");
    expect(source).toContain("buildAgentTree");
    expect(source).toContain("workflow-runtime-grid");
    expect(source).toContain("RequirementOverview");
    expect(source).toContain("RequirementsPanel");
    expect(source).toContain("activeRequirementId");
    expect(source).toContain("Requirement Memory");
    expect(source).toContain("Unassigned Threads");
    expect(source).toContain("RunContextCard");
    expect(source).toContain("Create Automation");
    expect(source).toContain("Run Automation");
    expect(source).toContain("visibleAutomations");
    expect(source).toContain("Execution Context Lineage");
    expect(source).toContain("executionContexts");
    expect(source).toContain("agentTasks");
    expect(source).toContain("buildThreadExecutionContextLineage");
    expect(source).toContain("collectAgentTreeIds");
    expect(source).toContain("findChangeSetSelectionForFile");
    expect(source).toContain("getConversationEntryAnchor");
    expect(source).toContain("conversationFocusTarget");
    expect(source).toContain("requestedSelection");
    expect(source).toContain("compareReviewSeverity");
    expect(source).not.toContain('window.setInterval(() => {\n      void readOutput();');
  });

  it("keeps desktop bridge methods in sync for turn/steer and review APIs", () => {
    const mainSource = readFileSync(join(process.cwd(), "src", "main", "index.ts"), "utf8");
    const preloadSource = readFileSync(join(process.cwd(), "src", "preload", "index.ts"), "utf8");
    const envSource = readFileSync(join(process.cwd(), "src", "renderer", "env.d.ts"), "utf8");

    expect(mainSource).toContain('"turn:steer"');
    expect(mainSource).toContain('"review:start"');
    expect(mainSource).toContain('"review:list"');
    expect(mainSource).toContain('"automation:create"');
    expect(mainSource).toContain('"automation:run"');
    expect(preloadSource).toContain("steerTurn");
    expect(preloadSource).toContain("startReview");
    expect(preloadSource).toContain("listReviews");
    expect(preloadSource).toContain("createAutomation");
    expect(preloadSource).toContain("runAutomation");
    expect(preloadSource).toContain("listAutomationRuns");
    expect(preloadSource).toContain("listTemplates");
    expect(preloadSource).toContain("scaffoldTemplate");
    expect(preloadSource).toContain("respondTerminalApproval");
    expect(preloadSource).toContain("createTerminal");
    expect(preloadSource).toContain("writeTerminal");
    expect(preloadSource).toContain("readTerminal");
    expect(preloadSource).toContain("closeTerminal");
    expect(preloadSource).toContain("archiveTerminal");
    expect(preloadSource).toContain("clearTerminal");
    expect(preloadSource).toContain("retryFailedStepIds");
    expect(preloadSource).toContain("listExecutionContexts");
    expect(preloadSource).toContain("listAgentTasks");
    expect(envSource).toContain("steerTurn");
    expect(envSource).toContain("startReview");
    expect(envSource).toContain("listReviews");
    expect(envSource).toContain("createAutomation");
    expect(envSource).toContain("runAutomation");
    expect(envSource).toContain("listAutomationRuns");
    expect(envSource).toContain("listTemplates");
    expect(envSource).toContain("scaffoldTemplate");
    expect(envSource).toContain("respondTerminalApproval");
    expect(envSource).toContain("createTerminal");
    expect(envSource).toContain("writeTerminal");
    expect(envSource).toContain("readTerminal");
    expect(envSource).toContain("closeTerminal");
    expect(envSource).toContain("archiveTerminal");
    expect(envSource).toContain("clearTerminal");
    expect(envSource).toContain("retryFailedStepIds");
    expect(envSource).toContain("listExecutionContexts");
    expect(envSource).toContain("listAgentTasks");
    expect(mainSource).toContain('"terminal:approval:respond"');
    expect(mainSource).toContain('"terminal:create"');
    expect(mainSource).toContain('"terminal:write"');
    expect(mainSource).toContain('"terminal:read"');
    expect(mainSource).toContain('"terminal:close"');
    expect(mainSource).toContain('"terminal:archive"');
    expect(mainSource).toContain('"terminal:clear"');
    expect(mainSource).toContain('"workflow:resume"');
    expect(mainSource).toContain('"template:list"');
    expect(mainSource).toContain('"template:scaffold"');
    expect(mainSource).toContain("retryFailedStepIds");
    expect(mainSource).toContain('"executionContext:list"');
    expect(mainSource).toContain('"agent:list"');
  });
});
