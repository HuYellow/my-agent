import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeKernel } from "../src/runtime-kernel.js";

describe("HarnessServer protocol compatibility", () => {
  it("accepts review/list, requirement/list, automation/list, and turn/steer methods", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-kernel-"));
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
      const toolList = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "tool-list",
        method: "tool/list",
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
      expect("result" in toolList && Array.isArray((toolList as any).result.tools)).toBe(true);
      expect("error" in steer && steer.error.message).toContain("Turn not found");
      expect("error" in terminalApproval && terminalApproval.error.message).toContain("Terminal session not found");
      expect("error" in terminalArchive && terminalArchive.error.message).toContain("Terminal session not found");
      expect("error" in terminalClear && terminalClear.error.message).toContain("Terminal session not found");
    } finally {
      kernel.dispose();
    }
  });

  it("returns structured tool error data for RPC failures", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-kernel-"));
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
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-kernel-"));
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
    } finally {
      kernel.dispose();
    }
  });

  it("returns structured plan and diff snapshots when resuming a thread", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "my-agent-kernel-"));
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
});
