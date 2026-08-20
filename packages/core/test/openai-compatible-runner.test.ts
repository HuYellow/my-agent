import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TurnRecord, TurnSteerRecord } from "@yellow-flow/protocol";
import { OpenAiCompatibleRunner } from "../src/agents/openai-compatible-runner.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("OpenAiCompatibleRunner steer injection", () => {
  it("injects queued steer instructions into model instructions", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-runner-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const runner = new OpenAiCompatibleRunner(database, {} as never, () => undefined);
    const turn: TurnRecord = {
      id: "turn-1",
      threadId: "thread-1",
      status: "running",
      input: "Fix the bug",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (runner as any).runtimeManager.startTurn(turn.id);

    const steerOne: TurnSteerRecord = {
      id: "steer-1",
      turnId: turn.id,
      threadId: turn.threadId,
      input: "Pause and summarize the current plan.",
      priority: "normal",
      visibility: "user",
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    const steerTwo: TurnSteerRecord = {
      ...steerOne,
      id: "steer-2",
      input: "Run tests before making changes.",
      priority: "high",
    };

    expect(runner.steerTurn(steerOne)).toBe(true);
    expect(runner.steerTurn(steerTwo)).toBe(true);

    const filter = (runner as any).createCallModelInputFilter(turn, {
      buildAdaptiveInstructions: () => "Keep the run under budget.",
    });
    const result = filter({ modelData: { instructions: "Base instructions" } });

    expect(result.instructions).toContain("# Runtime Steer");
    expect(result.instructions).toContain("Pause and summarize the current plan.");
    expect(result.instructions).toContain("Run tests before making changes.");
    expect(result.instructions).toContain("# Budget Reminder");
  });

  it("rejects steer after the runtime is finished", () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-runner-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const runner = new OpenAiCompatibleRunner(database, {} as never, () => undefined);
    const turn: TurnSteerRecord = {
      id: "steer-1",
      turnId: "turn-1",
      threadId: "thread-1",
      input: "Stop and explain.",
      priority: "normal",
      visibility: "user",
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    (runner as any).runtimeManager.startTurn(turn.turnId);
    (runner as any).runtimeManager.finishTurn(turn.turnId);

    expect(runner.steerTurn(turn)).toBe(false);
  });
});
