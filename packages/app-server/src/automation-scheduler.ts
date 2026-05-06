import { type RuntimeKernel } from "@my-agent/core/runtime-kernel";

export class AutomationScheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly inflightAutomationIds = new Set<string>();
  private running = false;

  constructor(
    private readonly runtime: RuntimeKernel,
    private readonly pollIntervalMs = 30_000,
  ) {}

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const now = Date.now();
      const dueAutomations = this.runtime.database
        .listAutomations()
        .filter(
          (automation) =>
            automation.status === "active" &&
            automation.scheduleType === "interval" &&
            automation.lastRunStatus !== "running" &&
            Boolean(automation.nextRunAt) &&
            new Date(automation.nextRunAt!).getTime() <= now &&
            !this.inflightAutomationIds.has(automation.id),
        );

      for (const automation of dueAutomations) {
        this.inflightAutomationIds.add(automation.id);

        try {
          await this.runtime.server.handle({
            jsonrpc: "2.0",
            id: `automation-run:${automation.id}:${now}`,
            method: "automation/run",
            params: {
              automationId: automation.id,
              trigger: "scheduler",
              runner: "app-server",
              initiatedBy: "app-server scheduler",
            },
          });
        } finally {
          this.inflightAutomationIds.delete(automation.id);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
