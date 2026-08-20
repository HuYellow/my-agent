import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkflowRecord } from "@yellow-flow/protocol";
import { createRuntimeKernel } from "../src/runtime-kernel.js";

describe("HarnessServer protocol compatibility", () => {
  it("accepts review/list, requirement/list, automation/list/logs, template scaffolding, plugin/internal tool management, and turn/steer methods", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "yellow-flow-kernel-"));
    const kernel = createRuntimeKernel({
      homeDir,
      emitEvent: () => undefined,
    });

    try {
      const reviewList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "review-list",
        method: "review/list",
      });
      const requirementList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "requirement-list",
        method: "requirement/list",
      });
      const automationList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "automation-list",
        method: "automation/list",
      });
      const automationLogs = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "automation-logs",
        method: "automation/logs",
      });
      const toolList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "tool-list",
        method: "tool/list",
      });
      const templateList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "template-list",
        method: "template/list",
      });
      const templateScaffold = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "template-scaffold",
        method: "template/scaffold",
        params: {
          templateId: "skill-basic",
          target: "user",
          name: "Protocol Test Skill",
          directoryName: "protocol-test-skill",
        },
      });
      const pluginList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "plugin-list",
        method: "plugin/list",
      });
      const internalToolList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "internal-tool-list",
        method: "internalTool/list",
      });
      const pluginUpdate = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "plugin-update",
        method: "plugin/update",
        params: {
          pluginId: "missing-plugin",
          patch: {
            enabled: false,
          },
        },
      });
      const internalToolUpdate = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "internal-tool-update",
        method: "internalTool/update",
        params: {
          internalToolId: "missing-internal-tool",
          patch: {
            enabled: false,
          },
        },
      });
      const steer = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "turn-steer",
        method: "turn/steer",
        params: {
          turnId: "missing-turn",
          input: "Pause and summarize.",
        },
      });
      const terminalApproval = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "terminal-approval",
        method: "terminal/approval/respond",
        params: {
          sessionId: "missing-terminal",
          decision: "reject",
        },
      });
      const terminalArchive = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "terminal-archive",
        method: "terminal/archive",
        params: {
          sessionId: "missing-terminal",
        },
      });
      const terminalClear = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "terminal-clear",
        method: "terminal/clear",
        params: {
          sessionId: "missing-terminal",
        },
      });

      expect("result" in reviewList && Array.isArray((reviewList as any).result.reviews)).toBe(true);
      expect("result" in requirementList && Array.isArray((requirementList as any).result.requirements)).toBe(true);
      expect("result" in automationList && Array.isArray((automationList as any).result.automations)).toBe(true);
      expect("result" in automationLogs && Array.isArray((automationLogs as any).result.logs)).toBe(true);
      expect("result" in toolList && Array.isArray((toolList as any).result.tools)).toBe(true);
      expect("result" in templateList && Array.isArray((templateList as any).result.templates)).toBe(true);
      expect("result" in templateScaffold && Array.isArray((templateScaffold as any).result.createdPaths)).toBe(true);
      expect("result" in pluginList && Array.isArray((pluginList as any).result.plugins)).toBe(true);
      expect("result" in internalToolList && Array.isArray((internalToolList as any).result.internalTools)).toBe(true);
      expect("error" in pluginUpdate && pluginUpdate.error.message).toContain("Plugin not found");
      expect("error" in internalToolUpdate && internalToolUpdate.error.message).toContain("Internal tool not found");
      expect("error" in steer && steer.error.message).toContain("Turn not found");
      expect("error" in terminalApproval && terminalApproval.error.message).toContain("Terminal session not found");
      expect("error" in terminalArchive && terminalArchive.error.message).toContain("Terminal session not found");
      expect("error" in terminalClear && terminalClear.error.message).toContain("Terminal session not found");
    } finally {
      kernel.dispose();
    }
  });

  it("returns structured tool error data for RPC failures", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "yellow-flow-kernel-"));
    const kernel = createRuntimeKernel({
      homeDir,
      emitEvent: () => undefined,
    });

    try {
      const started = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "thread-start",
        method: "thread/start",
        params: {
          title: "Readonly thread",
          sandboxMode: "read-only",
        },
      });
      const threadId = "result" in started ? (started as any).result.thread.id : undefined;
      const writePatch = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "write-patch",
        method: "fs/writePatch",
        params: {
          threadId,
          path: "notes/todo.txt",
          content: "hello",
        },
      });

      expect("error" in writePatch && writePatch.error.message).toContain("Read-only sandbox");
      expect("error" in writePatch && (writePatch as any).error.data?.kind).toBe("tool_error");
      expect("error" in writePatch && (writePatch as any).error.data?.toolError?.code).toBe("blocked");
      expect("error" in writePatch && (writePatch as any).error.data?.toolError?.tool?.source?.type).toBe("local");
    } finally {
      kernel.dispose();
    }
  });

  it("exposes protocol compatibility metadata and governed tool sources during initialize", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "yellow-flow-kernel-"));
    const kernel = createRuntimeKernel({
      homeDir,
      emitEvent: () => undefined,
    });

    try {
      const initialized = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "initialize",
        method: "initialize",
      });

      expect("result" in initialized && (initialized as any).result.compatibility.protocolVersion).toBe("0.1.0");
      expect("result" in initialized && (initialized as any).result.compatibility.requiredToolSources).toEqual(
        expect.arrayContaining(["local", "plugin", "mcp", "internal"]),
      );
      expect("result" in initialized && (initialized as any).result.tools.some((tool: any) => tool.source.type === "local")).toBe(true);
      expect("result" in initialized && Array.isArray((initialized as any).result.automationRunLogs)).toBe(true);
      expect("result" in initialized && Array.isArray((initialized as any).result.templates)).toBe(true);
    } finally {
      kernel.dispose();
    }
  });

  it("returns structured plan and diff snapshots when resuming a thread", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "yellow-flow-kernel-"));
    const kernel = createRuntimeKernel({
      homeDir,
      emitEvent: () => undefined,
    });

    try {
      const now = new Date().toISOString();
      const project = kernel.database.listProjects()[0]!;
      const thread = kernel.database.createThread({
        id: "thread-plan-diff",
        title: "Plan + diff thread",
        projectId: project.id,
        sandboxMode: project.sandboxMode,
        createdAt: now,
        updatedAt: now,
      });
      const turn = kernel.database.createTurn({
        id: "turn-plan-diff",
        threadId: thread.id,
        status: "completed",
        input: "[Plan mode]\nPlan this change before editing.",
        createdAt: now,
        updatedAt: now,
      });
      kernel.database.createItem({
        id: "item-plan",
        threadId: thread.id,
        turnId: turn.id,
        kind: "agentMessage",
        status: "completed",
        title: "Agent response",
        body: ["Implementation plan", "1. Inspect the runtime event model", "2. Add structured diff events", "3. Update the desktop store"].join("\n"),
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      kernel.database.createItem({
        id: "item-diff",
        threadId: thread.id,
        turnId: turn.id,
        kind: "fileChange",
        status: "completed",
        title: "File change: src/runtime.ts",
        body: "{\"path\":\"src/runtime.ts\",\"bytesWritten\":42}",
        metadata: {
          path: "src/runtime.ts",
        },
        createdAt: now,
        updatedAt: now,
      });

      const resumed = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "resume-plan-diff",
        method: "thread/resume",
        params: {
          threadId: thread.id,
        },
      });

      expect("result" in resumed && (resumed as any).result.turnPlans?.[0]?.steps?.length).toBe(3);
      expect("result" in resumed && (resumed as any).result.turnDiffs?.[0]?.files?.[0]?.path).toBe("src/runtime.ts");
    } finally {
      kernel.dispose();
    }
  });

  it("inherits selected requirement for review, workflow, and automation entrypoints", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "yellow-flow-kernel-"));
    const kernel = createRuntimeKernel({
      homeDir,
      emitEvent: () => undefined,
    });

    try {
      const now = new Date().toISOString();
      const project = kernel.database.listProjects()[0]!;
      const requirement = kernel.database.createRequirement({
        id: "requirement-selected",
        title: "Selected requirement",
        status: "active",
        primaryProjectId: project.id,
        relatedProjectIds: [],
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      kernel.database.writeConfig({
        ...kernel.database.getConfig(),
        selectedProjectId: project.id,
        selectedRequirementId: requirement.id,
      });
      const workflow: WorkflowRecord = kernel.database.upsertWorkflow({
        id: "workflow-selected",
        name: "Selected requirement workflow",
        description: "No-op workflow",
        path: join(homeDir, "workflow.toml"),
        source: "user",
        steps: [],
        createdAt: now,
        updatedAt: now,
      });

      const review = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "review-start-selected",
        method: "review/start",
        params: {
          projectId: project.id,
          source: { kind: "workspace" },
        },
      });
      const workflowRun = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "workflow-run-selected",
        method: "workflow/run",
        params: {
          workflowId: workflow.id,
          projectId: project.id,
          nonInteractive: true,
        },
      });
      const automation = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "automation-create-selected",
        method: "automation/create",
        params: {
          name: "Selected automation",
          kind: "workflow",
          projectId: project.id,
          workflowId: workflow.id,
        },
      });
      const automationId = "result" in automation ? (automation as any).result.automation.id : undefined;
      const automationRun = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "automation-run-selected",
        method: "automation/run",
        params: {
          automationId,
        },
      });

      expect("result" in review && (review as any).result.review.requirementId).toBe(requirement.id);
      expect("result" in workflowRun && (workflowRun as any).result.run.requirementId).toBe(requirement.id);
      expect("result" in automation && (automation as any).result.automation.requirementId).toBe(requirement.id);
      expect("result" in automationRun && (automationRun as any).result.run.requirementId).toBe(requirement.id);
    } finally {
      kernel.dispose();
    }
  });

  it("uses thread requirement before selected requirement and returns refreshed memory when unassigning", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "yellow-flow-kernel-"));
    const kernel = createRuntimeKernel({
      homeDir,
      emitEvent: () => undefined,
    });

    try {
      const now = new Date().toISOString();
      const project = kernel.database.listProjects()[0]!;
      const selectedRequirement = kernel.database.createRequirement({
        id: "requirement-selected",
        title: "Selected requirement",
        status: "active",
        primaryProjectId: project.id,
        relatedProjectIds: [],
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      const threadRequirement = kernel.database.createRequirement({
        id: "requirement-thread",
        title: "Thread requirement",
        status: "active",
        primaryProjectId: project.id,
        relatedProjectIds: [],
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      const thread = kernel.database.createThread({
        id: "thread-requirement",
        title: "Requirement-bound thread",
        projectId: project.id,
        requirementId: threadRequirement.id,
        sandboxMode: project.sandboxMode,
        hidden: false,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      kernel.database.writeConfig({
        ...kernel.database.getConfig(),
        selectedProjectId: project.id,
        selectedRequirementId: selectedRequirement.id,
      });

      const review = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "review-start-thread",
        method: "review/start",
        params: {
          threadId: thread.id,
          source: { kind: "workspace" },
        },
      });
      const unassigned = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "requirement-unassign",
        method: "requirement/unassignThread",
        params: {
          threadId: thread.id,
        },
      });

      expect("result" in review && (review as any).result.review.requirementId).toBe(threadRequirement.id);
      expect("result" in unassigned && (unassigned as any).result.thread.requirementId).toBeUndefined();
      expect("result" in unassigned && (unassigned as any).result.requirementId).toBe(threadRequirement.id);
      expect("result" in unassigned && (unassigned as any).result.memory.requirementId).toBe(threadRequirement.id);
      expect("result" in unassigned && (unassigned as any).result.memory.derived.linkedThreads).toEqual([]);
    } finally {
      kernel.dispose();
    }
  });
});
