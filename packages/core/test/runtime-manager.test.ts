import { describe, expect, it } from "vitest";
import { RuntimeManager } from "../src/services/runtime-manager.js";

describe("RuntimeManager steer queue", () => {
  it("queues and drains multiple steer inputs in order", () => {
    const manager = new RuntimeManager();

    manager.startTurn("turn-1");

    expect(
      manager.queueSteer("turn-1", {
        id: "steer-1",
        input: "Summarize before editing.",
        priority: "normal",
      }),
    ).toBe(true);
    expect(
      manager.queueSteer("turn-1", {
        id: "steer-2",
        input: "Run tests first.",
        priority: "high",
      }),
    ).toBe(true);

    expect(manager.drainSteers("turn-1")).toEqual([
      {
        id: "steer-1",
        input: "Summarize before editing.",
        priority: "normal",
      },
      {
        id: "steer-2",
        input: "Run tests first.",
        priority: "high",
      },
    ]);
    expect(manager.drainSteers("turn-1")).toEqual([]);
  });

  it("rejects steer once the turn is finished", () => {
    const manager = new RuntimeManager();

    manager.startTurn("turn-1");
    manager.finishTurn("turn-1");

    expect(
      manager.queueSteer("turn-1", {
        id: "steer-1",
        input: "Switch to read-only analysis.",
        priority: "low",
      }),
    ).toBe(false);
  });
});
