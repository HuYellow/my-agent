export interface RunBudgetPolicy {
  maxTurns: number;
  maxWallClockMs: number;
  maxToolCalls: number;
  maxRepeatedToolCallSignature: number;
  maxSequentialRepeatedToolCallSignature: number;
  maxHandoffPairBounces: number;
  softTurnWarningBuffer: number;
}

export interface RunGovernorSnapshot {
  startedAt: string;
  observedTurn: number;
  observedMaxTurns: number;
  totalToolCalls: number;
  totalHandoffs: number;
  consecutiveRepeatedToolCalls: number;
  lastToolSignature?: string;
  toolSignatureCounts: Array<[string, number]>;
  handoffPairCounts: Array<[string, number]>;
  decision?: RunGuardrailDecision;
}

export type RunGuardrailKind =
  | "max_turns"
  | "wall_clock_budget"
  | "tool_call_budget"
  | "duplicate_tool_call"
  | "handoff_bounce";

export interface RunGuardrailDecision {
  kind: RunGuardrailKind;
  message: string;
  userMessage: string;
  metadata: Record<string, unknown>;
}

export const DEFAULT_RUN_BUDGET_POLICY: RunBudgetPolicy = {
  maxTurns: 18,
  maxWallClockMs: 90_000,
  maxToolCalls: 24,
  maxRepeatedToolCallSignature: 3,
  maxSequentialRepeatedToolCallSignature: 2,
  maxHandoffPairBounces: 2,
  softTurnWarningBuffer: 3,
};

export class ControlledRunAbortError extends Error {
  constructor(readonly decision: RunGuardrailDecision) {
    super(decision.message);
    this.name = "ControlledRunAbortError";
  }
}

export class RunGovernor {
  private readonly toolSignatureCounts = new Map<string, number>();
  private readonly handoffPairCounts = new Map<string, number>();
  private observedTurn = 0;
  private observedMaxTurns: number;
  private totalToolCalls = 0;
  private totalHandoffs = 0;
  private consecutiveRepeatedToolCalls = 0;
  private lastToolSignature?: string;
  private decision?: RunGuardrailDecision;
  private diagnosticsEmitted = false;

  constructor(
    readonly policy: RunBudgetPolicy = DEFAULT_RUN_BUDGET_POLICY,
    private readonly startedAt = new Date(),
  ) {
    this.observedMaxTurns = policy.maxTurns;
  }

  static fromSnapshot(snapshot: RunGovernorSnapshot, policy: RunBudgetPolicy = DEFAULT_RUN_BUDGET_POLICY): RunGovernor {
    const governor = new RunGovernor(policy, new Date(snapshot.startedAt));
    governor.observedTurn = snapshot.observedTurn;
    governor.observedMaxTurns = snapshot.observedMaxTurns || policy.maxTurns;
    governor.totalToolCalls = snapshot.totalToolCalls;
    governor.totalHandoffs = snapshot.totalHandoffs;
    governor.consecutiveRepeatedToolCalls = snapshot.consecutiveRepeatedToolCalls;
    governor.lastToolSignature = snapshot.lastToolSignature;
    governor.decision = snapshot.decision;

    for (const [signature, count] of snapshot.toolSignatureCounts) {
      governor.toolSignatureCounts.set(signature, count);
    }

    for (const [pair, count] of snapshot.handoffPairCounts) {
      governor.handoffPairCounts.set(pair, count);
    }

    return governor;
  }

  toSnapshot(): RunGovernorSnapshot {
    return {
      startedAt: this.startedAt.toISOString(),
      observedTurn: this.observedTurn,
      observedMaxTurns: this.observedMaxTurns,
      totalToolCalls: this.totalToolCalls,
      totalHandoffs: this.totalHandoffs,
      consecutiveRepeatedToolCalls: this.consecutiveRepeatedToolCalls,
      lastToolSignature: this.lastToolSignature,
      toolSignatureCounts: [...this.toolSignatureCounts.entries()],
      handoffPairCounts: [...this.handoffPairCounts.entries()],
      decision: this.decision,
    };
  }

  updateProgress(currentTurn: number | undefined, maxTurns: number | undefined): void {
    if (typeof currentTurn === "number" && Number.isFinite(currentTurn)) {
      this.observedTurn = Math.max(this.observedTurn, currentTurn);
    }

    if (typeof maxTurns === "number" && Number.isFinite(maxTurns) && maxTurns > 0) {
      this.observedMaxTurns = maxTurns;
    }
  }

  beforeToolCall(toolName: string, args: unknown): void {
    const signature = `${toolName}:${stableStringify(args)}`;
    const totalToolCalls = this.totalToolCalls + 1;
    const repeatedCount = (this.toolSignatureCounts.get(signature) ?? 0) + 1;
    const sequentialRepeatedToolCalls = this.lastToolSignature === signature ? this.consecutiveRepeatedToolCalls + 1 : 1;

    if (totalToolCalls > this.policy.maxToolCalls) {
      throw new ControlledRunAbortError(
        this.activateDecision({
          kind: "tool_call_budget",
          message: `Stopped after ${totalToolCalls} tool calls to avoid an unbounded run.`,
          userMessage: [
            "I stopped this run because it exceeded the tool-call budget before reaching a confident answer.",
            `Budget snapshot: turns ${this.observedTurn || "?"}/${this.observedMaxTurns}, tool calls ${totalToolCalls}/${this.policy.maxToolCalls}.`,
            "Please inspect the last few tool calls and either tighten the prompt or raise the run budget in packages/core/src/agents/run-governor.ts.",
          ].join("\n"),
          metadata: {
            toolName,
            attemptedSignature: signature,
            totalToolCalls,
            maxToolCalls: this.policy.maxToolCalls,
          },
        }),
      );
    }

    if (
      repeatedCount > this.policy.maxRepeatedToolCallSignature ||
      sequentialRepeatedToolCalls > this.policy.maxSequentialRepeatedToolCallSignature
    ) {
      throw new ControlledRunAbortError(
        this.activateDecision({
          kind: "duplicate_tool_call",
          message: `Stopped to avoid repeating ${toolName} with the same arguments ${repeatedCount} times.`,
          userMessage: [
            "I stopped this run because it was repeating the same tool call without making enough progress.",
            `Repeated tool: ${toolName}`,
            `Budget snapshot: turns ${this.observedTurn || "?"}/${this.observedMaxTurns}, tool calls ${totalToolCalls}/${this.policy.maxToolCalls}.`,
            "Check the tool output or prompt instructions before retrying this thread.",
          ].join("\n"),
          metadata: {
            toolName,
            attemptedSignature: signature,
            repeatedCount,
            sequentialRepeatedToolCalls,
            maxRepeatedToolCallSignature: this.policy.maxRepeatedToolCallSignature,
            maxSequentialRepeatedToolCallSignature: this.policy.maxSequentialRepeatedToolCallSignature,
          },
        }),
      );
    }

    this.totalToolCalls = totalToolCalls;
    this.toolSignatureCounts.set(signature, repeatedCount);
    this.lastToolSignature = signature;
    this.consecutiveRepeatedToolCalls = sequentialRepeatedToolCalls;
  }

  noteToolResult(): void {
    return;
  }

  noteHandoff(fromAgent: string, toAgent: string): RunGuardrailDecision | undefined {
    const pair = `${fromAgent}->${toAgent}`;
    const pairCount = (this.handoffPairCounts.get(pair) ?? 0) + 1;
    this.handoffPairCounts.set(pair, pairCount);
    this.totalHandoffs += 1;

    if (pairCount <= this.policy.maxHandoffPairBounces) {
      return undefined;
    }

    return this.activateDecision({
      kind: "handoff_bounce",
      message: `Stopped after bouncing between agents on ${pair} ${pairCount} times.`,
      userMessage: [
        "I stopped this run because the agent orchestration started bouncing between the same agents.",
        `Handoff pair: ${pair}`,
        `Budget snapshot: turns ${this.observedTurn || "?"}/${this.observedMaxTurns}, handoffs ${this.totalHandoffs}.`,
        "Review your handoff routing or specialist-agent boundaries before retrying.",
      ].join("\n"),
      metadata: {
        pair,
        pairCount,
        maxHandoffPairBounces: this.policy.maxHandoffPairBounces,
        totalHandoffs: this.totalHandoffs,
      },
    });
  }

  activateMaxTurnsDecision(): RunGuardrailDecision {
    return this.activateDecision({
      kind: "max_turns",
      message: `Stopped after exhausting the turn budget of ${this.observedMaxTurns}.`,
      userMessage: [
        "I stopped this run because it hit the turn budget before converging on a final answer.",
        `Budget snapshot: turns ${this.observedTurn || this.observedMaxTurns}/${this.observedMaxTurns}, tool calls ${this.totalToolCalls}/${this.policy.maxToolCalls}.`,
        "Please review the last steps, tighten the task, or raise the turn budget in packages/core/src/agents/run-governor.ts if this longer run is intentional.",
      ].join("\n"),
      metadata: this.buildMetadata(),
    });
  }

  activateWallClockDecision(): RunGuardrailDecision {
    return this.activateDecision({
      kind: "wall_clock_budget",
      message: `Stopped after running for ${this.policy.maxWallClockMs} ms to avoid a hanging workflow.`,
      userMessage: [
        "I stopped this run because it exceeded the wall-clock budget before finishing.",
        `Budget snapshot: turns ${this.observedTurn || "?"}/${this.observedMaxTurns}, tool calls ${this.totalToolCalls}/${this.policy.maxToolCalls}.`,
        "Inspect long-running commands or increase the wall-clock budget in packages/core/src/agents/run-governor.ts if this workload is expected.",
      ].join("\n"),
      metadata: {
        ...this.buildMetadata(),
        maxWallClockMs: this.policy.maxWallClockMs,
        elapsedMs: this.getElapsedMs(),
      },
    });
  }

  getDecision(): RunGuardrailDecision | undefined {
    return this.decision;
  }

  buildBudgetItemBody(): string {
    return [
      `Turns: ${this.policy.maxTurns}`,
      `Wall clock: ${this.policy.maxWallClockMs} ms`,
      `Tool calls: ${this.policy.maxToolCalls}`,
      `Repeated tool signature: ${this.policy.maxRepeatedToolCallSignature}`,
      `Sequential repeated tool signature: ${this.policy.maxSequentialRepeatedToolCallSignature}`,
      `Handoff pair bounces: ${this.policy.maxHandoffPairBounces}`,
    ].join("\n");
  }

  buildAdaptiveInstructions(): string | undefined {
    const nearTurnBudget =
      this.observedMaxTurns > 0 && this.observedTurn >= Math.max(1, this.observedMaxTurns - this.policy.softTurnWarningBuffer);
    const nearToolBudget = this.totalToolCalls >= Math.max(1, this.policy.maxToolCalls - 3);

    if (!nearTurnBudget && !nearToolBudget) {
      return undefined;
    }

    return [
      "You are close to the run budget.",
      "Do not call another tool unless it is necessary to produce a materially better answer.",
      "Prefer a concise final answer, or explain the missing information and the next step.",
    ].join(" ");
  }

  buildMetadata(): Record<string, unknown> {
    return {
      observedTurn: this.observedTurn,
      observedMaxTurns: this.observedMaxTurns,
      totalToolCalls: this.totalToolCalls,
      totalHandoffs: this.totalHandoffs,
      elapsedMs: this.getElapsedMs(),
      policy: this.policy,
    };
  }

  hasDiagnosticsEmitted(): boolean {
    return this.diagnosticsEmitted;
  }

  markDiagnosticsEmitted(): void {
    this.diagnosticsEmitted = true;
  }

  private activateDecision(decision: RunGuardrailDecision): RunGuardrailDecision {
    this.decision = decision;
    return decision;
  }

  private getElapsedMs(): number {
    return Date.now() - this.startedAt.getTime();
  }
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }

  return JSON.stringify(String(value));
}
