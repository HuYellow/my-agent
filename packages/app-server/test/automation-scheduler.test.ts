import { describe, expect, it, vi } from "vitest";
import { AutomationScheduler } from "../src/automation-scheduler.js";

describe("AutomationScheduler", () => {
  it("runs only due active interval automations", async () => {
    const handle = vi.fn().mockResolvedValue({ result: { ok: true } });
    const runtime = {
      database: {
        listAutomations: () => [
          dueAutomation("automation-due"),
          { ...dueAutomation("automation-paused"), status: "paused" as const },
          { ...dueAutomation("automation-manual"), scheduleType: "manual" as const },
          { ...dueAutomation("automation-running"), lastRunStatus: "running" as const },
          { ...dueAutomation("automation-future"), nextRunAt: new Date(Date.now() + 60_000).toISOString() },
        ],
      },
      server: {
        handle,
      },
    } as any;
    const scheduler = new AutomationScheduler(runtime, 5_000);

    await scheduler.tick();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "automation/run",
        params: expect.objectContaining({
          automationId: "automation-due",
          trigger: "scheduler",
          runner: "app-server",
        }),
      }),
    );
  });

  it("prevents overlapping ticks while automation runs are in flight", async () => {
    let resolveHandle: (() => void) | undefined;
    const handle = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHandle = () => resolve({ result: { ok: true } });
        }),
    );
    const runtime = {
      database: {
        listAutomations: () => [dueAutomation("automation-due")],
      },
      server: {
        handle,
      },
    } as any;
    const scheduler = new AutomationScheduler(runtime, 5_000);

    const firstTick = scheduler.tick();
    const secondTick = scheduler.tick();
    await Promise.resolve();

    expect(handle).toHaveBeenCalledTimes(1);

    resolveHandle?.();
    await Promise.all([firstTick, secondTick]);
  });
});

function dueAutomation(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    kind: "workflow" as const,
    projectId: "project-1",
    scheduleType: "interval" as const,
    intervalMinutes: 5,
    status: "active" as const,
    lastRunStatus: "idle" as const,
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}
