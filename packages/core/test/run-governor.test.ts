import { describe, expect, it } from "vitest";
import {
  ControlledRunAbortError,
  RunGovernor,
  type RunBudgetPolicy,
} from "../src/agents/run-governor.js";

const TEST_POLICY: RunBudgetPolicy = {
  maxTurns: 12,
  maxWallClockMs: 30_000,
  maxToolCalls: 6,
  maxRepeatedToolCallSignature: 2,
  maxSequentialRepeatedToolCallSignature: 2,
  maxHandoffPairBounces: 1,
  softTurnWarningBuffer: 2,
};

describe("RunGovernor", () => {
  it("stops repeated identical tool calls", () => {
    const governor = new RunGovernor(TEST_POLICY);

    governor.beforeToolCall("read_file", { path: "src/app.ts" });
    governor.beforeToolCall("read_file", { path: "src/app.ts" });

    expect(() => governor.beforeToolCall("read_file", { path: "src/app.ts" })).toThrowError(ControlledRunAbortError);
    expect(governor.getDecision()?.kind).toBe("duplicate_tool_call");
  });

  it("stops when a handoff pair bounces too many times", () => {
    const governor = new RunGovernor(TEST_POLICY);

    expect(governor.noteHandoff("triage", "coder")).toBeUndefined();

    const decision = governor.noteHandoff("triage", "coder");

    expect(decision?.kind).toBe("handoff_bounce");
  });

  it("restores state from a snapshot", () => {
    const governor = new RunGovernor(TEST_POLICY);

    governor.updateProgress(4, TEST_POLICY.maxTurns);
    governor.beforeToolCall("read_file", { path: "src/app.ts" });
    governor.noteHandoff("triage", "coder");

    const restored = RunGovernor.fromSnapshot(governor.toSnapshot(), TEST_POLICY);

    expect(restored.buildMetadata()).toMatchObject({
      observedTurn: 4,
      totalToolCalls: 1,
      totalHandoffs: 1,
    });
  });
});
