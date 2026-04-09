import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeKernel } from "../src/runtime-kernel.js";

describe("HarnessServer protocol compatibility", () => {
  it("accepts review/list, requirement/list, and turn/steer methods", async () => {
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
      expect("error" in steer && steer.error.message).toContain("Turn not found");
      expect("error" in terminalApproval && terminalApproval.error.message).toContain("Terminal session not found");
      expect("error" in terminalArchive && terminalArchive.error.message).toContain("Terminal session not found");
      expect("error" in terminalClear && terminalClear.error.message).toContain("Terminal session not found");
    } finally {
      kernel.dispose();
    }
  });
});
