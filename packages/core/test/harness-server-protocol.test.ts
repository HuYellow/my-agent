import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntimeKernel } from "../src/runtime-kernel.js";

describe("HarnessServer protocol compatibility", () => {
  it("accepts review/list and turn/steer methods", async () => {
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
      const steer = await kernel.server.handle({
        jsonrpc: "2.0",
        id: "turn-steer",
        method: "turn/steer",
        params: {
          turnId: "missing-turn",
          input: "Pause and summarize.",
        },
      });

      expect("result" in reviewList && Array.isArray((reviewList as any).result.reviews)).toBe(true);
      expect("error" in steer && steer.error.message).toContain("Turn not found");
    } finally {
      kernel.dispose();
    }
  });
});
