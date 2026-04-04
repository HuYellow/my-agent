export class RuntimeManager {
  private readonly controllers = new Map<string, AbortController>();

  startTurn(turnId: string): AbortController {
    const existing = this.controllers.get(turnId);

    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    this.controllers.set(turnId, controller);
    return controller;
  }

  abortTurn(turnId: string): boolean {
    const controller = this.controllers.get(turnId);

    if (!controller) {
      return false;
    }

    controller.abort();
    this.controllers.delete(turnId);
    return true;
  }

  finishTurn(turnId: string): void {
    this.controllers.delete(turnId);
  }

  isActive(turnId: string): boolean {
    return this.controllers.has(turnId);
  }
}
