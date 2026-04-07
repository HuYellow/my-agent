export class RuntimeManager {
  private readonly runtimes = new Map<
    string,
    {
      controller: AbortController;
      steerQueue: Array<{
        id: string;
        input: string;
        priority: "low" | "normal" | "high";
      }>;
    }
  >();

  startTurn(turnId: string): AbortController {
    const existing = this.runtimes.get(turnId);

    if (existing) {
      existing.controller.abort();
    }

    const controller = new AbortController();
    this.runtimes.set(turnId, {
      controller,
      steerQueue: [],
    });
    return controller;
  }

  abortTurn(turnId: string): boolean {
    const runtime = this.runtimes.get(turnId);

    if (!runtime) {
      return false;
    }

    runtime.controller.abort();
    this.runtimes.delete(turnId);
    return true;
  }

  finishTurn(turnId: string): void {
    this.runtimes.delete(turnId);
  }

  isActive(turnId: string): boolean {
    return this.runtimes.has(turnId);
  }

  queueSteer(
    turnId: string,
    steer: {
      id: string;
      input: string;
      priority: "low" | "normal" | "high";
    },
  ): boolean {
    const runtime = this.runtimes.get(turnId);

    if (!runtime) {
      return false;
    }

    runtime.steerQueue.push(steer);
    return true;
  }

  drainSteers(turnId: string): Array<{
    id: string;
    input: string;
    priority: "low" | "normal" | "high";
  }> {
    const runtime = this.runtimes.get(turnId);

    if (!runtime || runtime.steerQueue.length === 0) {
      return [];
    }

    const queued = [...runtime.steerQueue];
    runtime.steerQueue.length = 0;
    return queued;
  }
}
