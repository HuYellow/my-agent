import {
  Agent,
  OpenAIProvider,
  Runner,
  RunMessageOutputItem,
  RunReasoningItem,
  RunState,
  RunToolApprovalItem,
  RunToolCallItem,
  RunToolCallOutputItem,
  tool,
  type AgentInputItem,
  type RunStreamEvent,
  type StreamedRunResult,
} from "@openai/agents";
import {
  type ApprovalResponseParams,
  type HarnessEvent,
  type ItemRecord,
  type PendingApproval,
  type ProviderProfile,
  type SkillDescriptor,
  type ThreadRecord,
  type TurnRecord,
  type WorkspaceProfile,
} from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { RuntimeManager } from "../services/runtime-manager.js";
import { SqliteSession } from "../services/sqlite-session.js";
import { ToolService } from "../tools/tool-service.js";
import { ToolExecutionAbortedError, type PlannedToolExecution } from "../tools/types.js";
import { createId } from "../utils/ids.js";

interface RunnerContext {
  provider: ProviderProfile;
  workspace: WorkspaceProfile;
  thread: ThreadRecord;
  turn: TurnRecord;
  discoveredSkills: SkillDescriptor[];
  selectedSkills: SkillDescriptor[];
  userInput: string;
  globalInstructions: string;
}

interface PendingRuntime {
  serializedState: string;
  systemPrompt: string;
  callId?: string;
  approvalKey?: string;
}

interface StreamTracker {
  messageItem?: ItemRecord;
}

export class OpenAiCompatibleRunner {
  private readonly runtimeManager = new RuntimeManager();

  constructor(
    private readonly database: HarnessDatabase,
    private readonly promptBuilder: PromptBuilder,
    private readonly emit: (event: HarnessEvent) => void,
  ) {}

  interruptTurn(turnId: string): boolean {
    return this.runtimeManager.abortTurn(turnId);
  }

  async runTurn(context: RunnerContext): Promise<TurnRecord> {
    const builtPrompt = this.promptBuilder.build({
      cwd: context.workspace.rootPath,
      workspace: context.workspace,
      globalInstructions: context.globalInstructions,
      userInput: context.userInput,
      selectedSkills: context.selectedSkills,
      discoveredSkills: context.discoveredSkills,
    });
    const toolService = new ToolService(context.workspace, {
      database: this.database,
      threadId: context.thread.id,
    });

    await this.ensureThreadSessionSeeded(context.thread.id);

    this.createItem({
      turn: context.turn,
      threadId: context.thread.id,
      kind: "userMessage",
      title: "User request",
      body: context.userInput,
      metadata: {},
      status: "completed",
    });

    if (!context.provider.baseUrl || !context.provider.model) {
      this.createItem({
        turn: context.turn,
        threadId: context.thread.id,
        kind: "agentMessage",
        title: "Agent response",
        body: "Provider is not configured yet. Open Settings, fill in baseUrl, apiKey, and model, then retry this thread.",
        metadata: {},
        status: "completed",
      });
      return this.completeTurn({ ...context.turn, status: "completed", updatedAt: now() });
    }

    const controller = this.runtimeManager.startTurn(context.turn.id);
    const agent = this.createAgent({
      provider: context.provider,
      workspace: context.workspace,
      systemPrompt: builtPrompt.systemPrompt,
      turn: context.turn,
      threadId: context.thread.id,
      toolService,
    });
    const runner = this.createRunner(context.provider, context.thread.id);
    const session = new SqliteSession(this.database, context.thread.id);

    try {
      const stream = await runner.run(agent, builtPrompt.userMessage, {
        stream: true,
        maxTurns: 10,
        session,
        signal: controller.signal,
        sessionInputCallback: trimSessionHistory,
      });

      await this.consumeStream(stream, context.turn, context.thread.id);
      return this.finishStream(
        context.turn,
        context.thread.id,
        context.workspace.approvalPolicy,
        stream,
        builtPrompt.systemPrompt,
        toolService,
      );
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return this.cancelTurn(context.turn, context.thread.id, "Run interrupted by user.");
      }

      this.createItem({
        turn: context.turn,
        threadId: context.thread.id,
        kind: "error",
        title: "Run failed",
        body: error instanceof Error ? error.message : String(error),
        metadata: {},
        status: "failed",
      });
      return this.failTurn(context.turn, error instanceof Error ? error.message : String(error));
    } finally {
      this.runtimeManager.finishTurn(context.turn.id);
    }
  }

  async resumeAfterApproval(
    context: {
      approval: PendingApproval;
      turn: TurnRecord;
      thread: ThreadRecord;
      workspace: WorkspaceProfile;
      provider: ProviderProfile;
    },
    params: ApprovalResponseParams,
  ): Promise<TurnRecord> {
    const pending = this.database.getPendingApproval(context.approval.id);

    if (!pending) {
      throw new Error("Pending approval state was not found.");
    }

    const runtime = pending.runtime as unknown as PendingRuntime;
    const toolService = new ToolService(context.workspace, {
      database: this.database,
      threadId: context.thread.id,
    });

    await this.ensureThreadSessionSeeded(context.thread.id);
    const agent = this.createAgent({
      provider: context.provider,
      workspace: context.workspace,
      systemPrompt: runtime.systemPrompt,
      turn: context.turn,
      threadId: context.thread.id,
      toolService,
    });
    const runner = this.createRunner(context.provider, context.thread.id);
    const state = await RunState.fromString(agent, runtime.serializedState);
    const approvalItem = this.findApprovalItem(state.getInterruptions(), runtime.callId, context.approval);
    const session = new SqliteSession(this.database, context.thread.id);

    if (!approvalItem) {
      throw new Error("The requested approval item is no longer available.");
    }

    if (params.decision === "approve") {
      state.approve(approvalItem, {
        alwaysApprove: params.scope === "session",
      });

      if (params.scope === "session" && runtime.approvalKey) {
        toolService.rememberSessionApproval(context.thread.id, context.approval.toolName, runtime.approvalKey);
      }
    } else {
      state.reject(approvalItem, {
        alwaysReject: params.scope === "session",
        message: "User rejected the requested action.",
      });
    }

    this.database.deletePendingApproval(context.approval.id);
    this.emit({
      type: "serverRequest/resolved",
      payload: {
        approvalId: context.approval.id,
        decision: params.decision,
      },
    });

    this.createItem({
      turn: context.turn,
      threadId: context.thread.id,
      kind: "approvalResult",
      title: `Approval ${params.decision}`,
      body: `${context.approval.toolName} was ${params.decision}.`,
      metadata: { approvalId: context.approval.id, scope: params.scope ?? "once" },
      status: "completed",
    });

    const runningTurn = this.database.updateTurn({
      ...context.turn,
      status: "running",
      updatedAt: now(),
    });
    const controller = this.runtimeManager.startTurn(runningTurn.id);

    try {
      const stream = await runner.run(agent, state, {
        stream: true,
        maxTurns: 10,
        session,
        signal: controller.signal,
        sessionInputCallback: trimSessionHistory,
      });

      await this.consumeStream(stream, runningTurn, context.thread.id);
      return this.finishStream(
        runningTurn,
        context.thread.id,
        context.workspace.approvalPolicy,
        stream,
        runtime.systemPrompt,
        toolService,
      );
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return this.cancelTurn(runningTurn, context.thread.id, "Run interrupted by user.");
      }

      return this.failTurn(runningTurn, error instanceof Error ? error.message : String(error));
    } finally {
      this.runtimeManager.finishTurn(runningTurn.id);
    }
  }

  private createAgent(params: {
    provider: ProviderProfile;
    workspace: WorkspaceProfile;
    systemPrompt: string;
    turn: TurnRecord;
    threadId: string;
    toolService: ToolService;
  }): Agent<any, any> {
    const tools = params.toolService.getDefinitions().map((definition) =>
      tool({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as never,
        strict: definition.strict,
        needsApproval: async (_runContext: unknown, input: unknown) => {
          const plan = params.toolService.planExecution(definition.name, input);
          return plan.permission.requiresApproval;
        },
        execute: async (input: unknown, _runContext: unknown, details?: { signal?: AbortSignal }) =>
          this.executeToolForSdk(params.toolService, definition.name, input, {
            workspace: params.workspace,
            turn: params.turn,
            threadId: params.threadId,
            signal: details?.signal,
          }),
      }),
    );

    return new Agent({
      name: "my-agent",
      instructions: params.systemPrompt,
      handoffDescription: "A local coding assistant with workspace tools, skills, and approval-aware execution.",
      model: params.provider.model,
      tools,
    });
  }

  private createRunner(provider: ProviderProfile, threadId: string): Runner {
    const modelProvider = new OpenAIProvider({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
      useResponses: provider.apiFlavor === "responses",
    });

    return new Runner({
      modelProvider,
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
      workflowName: "my-agent-runtime",
      groupId: threadId,
    });
  }

  private buildAgentInput(threadId: string): AgentInputItem[] {
    const history = this.database.listItems(threadId);
    const items: AgentInputItem[] = [];

    for (const item of history) {
      if (item.kind === "userMessage") {
        items.push({
          role: "user",
          content: item.body,
        });
      }

      if (item.kind === "agentMessage") {
        items.push({
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: item.body,
            },
          ],
        });
      }
    }

    return items;
  }

  private async ensureThreadSessionSeeded(threadId: string): Promise<void> {
    if (this.database.countSessionItems(threadId) > 0) {
      return;
    }

    const seedItems = this.buildAgentInput(threadId);

    if (seedItems.length === 0) {
      return;
    }

    const session = new SqliteSession(this.database, threadId);
    await session.addItems(seedItems);
  }

  private async consumeStream(stream: StreamedRunResult<any, Agent<any, any>>, turn: TurnRecord, threadId: string): Promise<void> {
    const tracker: StreamTracker = {};

    try {
      for await (const event of stream) {
        this.handleStreamEvent(event, turn, threadId, tracker);
      }

      await stream.completed;
    } finally {
      if (tracker.messageItem) {
        this.completeItem(tracker.messageItem, {
          status: stream.cancelled || stream.error ? "failed" : "completed",
        });
        tracker.messageItem = undefined;
      }
    }
  }

  private finishStream(
    turn: TurnRecord,
    threadId: string,
    approvalPolicy: WorkspaceProfile["approvalPolicy"],
    stream: StreamedRunResult<any, Agent<any, any>>,
    systemPrompt: string,
    toolService: ToolService,
  ): TurnRecord {
    const interruptions = stream.interruptions;

    if (interruptions.length > 0) {
      const approvalItem = interruptions[0]!;
      const approval = this.createApproval(turn, threadId, approvalItem, approvalPolicy, toolService);
      const item = this.createItem({
        turn,
        threadId,
        kind: "approvalRequest",
        title: `Approval required: ${approval.toolName}`,
        body: approval.reason,
        metadata: {
          args: approval.args,
          toolName: approval.toolName,
        },
        status: "completed",
      });

      this.database.putPendingApproval(approval, {
        serializedState: stream.state.toString(),
        systemPrompt,
        callId: getApprovalCallId(approvalItem),
        approvalKey: this.getApprovalKey(toolService, approval.toolName, approval.args),
      } satisfies PendingRuntime);

      const pendingTurn = this.database.updateTurn({
        ...turn,
        status: "awaiting_approval",
        updatedAt: now(),
      });

      this.emit({
        type: "approval/requested",
        payload: { approval, item },
      });

      return pendingTurn;
    }

    return this.completeTurn({
      ...turn,
      status: "completed",
      updatedAt: now(),
    });
  }

  private handleStreamEvent(event: RunStreamEvent, turn: TurnRecord, threadId: string, tracker: StreamTracker): void {
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
      if (!tracker.messageItem) {
        tracker.messageItem = this.createItem({
          turn,
          threadId,
          kind: "agentMessage",
          title: "Agent response",
          body: "",
          metadata: {},
          status: "in_progress",
        });
      }

      tracker.messageItem = this.appendItemDelta(tracker.messageItem, event.data.delta);
      return;
    }

    if (event.type !== "run_item_stream_event") {
      return;
    }

    if (event.name === "message_output_created" && event.item instanceof RunMessageOutputItem) {
      const body = extractMessageOutputText(event.item);

      if (tracker.messageItem) {
        tracker.messageItem = this.completeItem(tracker.messageItem, {
          body: body || tracker.messageItem.body,
          status: "completed",
        });
        tracker.messageItem = undefined;
        return;
      }

      this.createItem({
        turn,
        threadId,
        kind: "agentMessage",
        title: "Agent response",
        body,
        metadata: { agent: event.item.agent.name },
        status: "completed",
      });
      return;
    }

    if (event.name === "reasoning_item_created" && event.item instanceof RunReasoningItem) {
      this.createItem({
        turn,
        threadId,
        kind: "reasoning",
        title: "Model reasoning",
        body: extractReasoningText(event.item),
        metadata: { agent: event.item.agent.name },
        status: "completed",
      });
      return;
    }

    if (event.name === "tool_called" && event.item instanceof RunToolCallItem) {
      const raw = event.item.rawItem as { name?: string; arguments?: string };
      this.createItem({
        turn,
        threadId,
        kind: "toolCall",
        title: `Tool call: ${raw.name ?? "unknown"}`,
        body: raw.arguments ?? "",
        metadata: { toolName: raw.name ?? "unknown" },
        status: "completed",
      });
      return;
    }

    if (event.name === "tool_output" && event.item instanceof RunToolCallOutputItem) {
      const raw = event.item.rawItem as { name?: string };
      this.createItem({
        turn,
        threadId,
        kind: "toolResult",
        title: `Tool result: ${raw.name ?? "unknown"}`,
        body: stringifyUnknown(event.item.output),
        metadata: { toolName: raw.name ?? "unknown" },
        status: "completed",
      });
    }
  }

  private createItem(params: {
    turn: TurnRecord;
    threadId: string;
    kind: ItemRecord["kind"];
    title: string;
    body: string;
    metadata: Record<string, unknown>;
    status: ItemRecord["status"];
  }): ItemRecord {
    const item: ItemRecord = {
      id: createId("item"),
      threadId: params.threadId,
      turnId: params.turn.id,
      kind: params.kind,
      title: params.title,
      body: params.body,
      metadata: params.metadata,
      status: params.status,
      createdAt: now(),
      updatedAt: now(),
    };

    this.database.createItem(item);
    this.emit({ type: "item/started", payload: { item } });

    if (item.status !== "in_progress") {
      this.emit({ type: "item/completed", payload: { item } });
    }

    return item;
  }

  private appendItemDelta(item: ItemRecord, delta: string): ItemRecord {
    const updated = this.database.updateItem({
      ...item,
      body: `${item.body}${delta}`,
      updatedAt: now(),
    });
    this.emit({ type: "item/delta", payload: { itemId: updated.id, delta } });
    return updated;
  }

  private completeItem(item: ItemRecord, patch: Partial<Pick<ItemRecord, "body" | "title" | "metadata" | "status">> = {}): ItemRecord {
    const updated = this.database.updateItem({
      ...item,
      ...patch,
      status: patch.status ?? "completed",
      body: patch.body ?? item.body,
      title: patch.title ?? item.title,
      metadata: patch.metadata ?? item.metadata,
      updatedAt: now(),
    });
    this.emit({ type: "item/completed", payload: { item: updated } });
    return updated;
  }

  private async executeToolForSdk(
    toolService: ToolService,
    toolName: string,
    args: unknown,
    context: { workspace: WorkspaceProfile; turn: TurnRecord; threadId: string; signal?: AbortSignal },
  ): Promise<string> {
    const plan = toolService.planExecution(toolName, args);

    if (toolName === "run_shell") {
      let commandItem = this.createItem({
        turn: context.turn,
        threadId: context.threadId,
        kind: "commandExecution",
        title: `Command: ${String(plan.args.command)}`,
        body: "",
        metadata: {
          args: plan.args,
          approvalKey: plan.permission.approvalKey,
        },
        status: "in_progress",
      });

      try {
        const payload = await toolService.executePlanned(plan, {
          workspace: context.workspace,
          signal: context.signal,
          emitCommandDelta: (delta) => {
            commandItem = this.appendItemDelta(commandItem, delta);
          },
        });

        this.completeItem(commandItem, {
          status: "completed",
        });
        return payload;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.completeItem(commandItem, {
          status: "failed",
          body: commandItem.body ? `${commandItem.body}\n\n${message}` : message,
        });
        throw error;
      }
    }

    if (toolName === "write_patch") {
      try {
        const payload = await toolService.executePlanned(plan, {
          workspace: context.workspace,
          signal: context.signal,
          emitCommandDelta: () => undefined,
        });
        this.createItem({
          turn: context.turn,
          threadId: context.threadId,
          kind: "fileChange",
          title: `File change: ${String(plan.args.path)}`,
          body: payload,
          metadata: {
            path: plan.args.path,
            approvalKey: plan.permission.approvalKey,
          },
          status: "completed",
        });
        return payload;
      } catch (error) {
        this.createItem({
          turn: context.turn,
          threadId: context.threadId,
          kind: "error",
          title: `File change failed: ${String(plan.args.path)}`,
          body: error instanceof Error ? error.message : String(error),
          metadata: { path: plan.args.path },
          status: "failed",
        });
        throw error;
      }
    }

    return toolService.executePlanned(plan, {
      workspace: context.workspace,
      signal: context.signal,
      emitCommandDelta: () => undefined,
    });
  }

  private createApproval(
    turn: TurnRecord,
    threadId: string,
    approvalItem: RunToolApprovalItem,
    approvalPolicy: WorkspaceProfile["approvalPolicy"],
    toolService: ToolService,
  ): PendingApproval {
    const toolName = approvalItem.name ?? "unknown";
    const args = parseApprovalArguments(approvalItem.arguments);
    const plan = safePlan(toolService, toolName, args);

    return {
      id: createId("approval"),
      turnId: turn.id,
      threadId,
      toolName,
      reason:
        plan?.permission.approvalReason ??
        ToolService.approvalReason(toolName, `Tool ${toolName} requires approval under policy ${approvalPolicy}.`),
      args,
      scope: "once",
      createdAt: now(),
    };
  }

  private getApprovalKey(toolService: ToolService, toolName: string, args: Record<string, unknown>): string | undefined {
    return safePlan(toolService, toolName, args)?.permission.approvalKey;
  }

  private findApprovalItem(items: RunToolApprovalItem[], callId: string | undefined, approval: PendingApproval): RunToolApprovalItem | undefined {
    return items.find((item) => {
      const itemCallId = getApprovalCallId(item);

      if (callId && itemCallId) {
        return itemCallId === callId;
      }

      return item.name === approval.toolName;
    });
  }

  private completeTurn(turn: TurnRecord): TurnRecord {
    const updated = this.database.updateTurn(turn);
    this.emit({ type: "turn/completed", payload: { turn: updated } });
    return updated;
  }

  private cancelTurn(turn: TurnRecord, threadId: string, message: string): TurnRecord {
    this.createItem({
      turn,
      threadId,
      kind: "error",
      title: "Run cancelled",
      body: message,
      metadata: {},
      status: "failed",
    });

    const updated = this.database.updateTurn({
      ...turn,
      status: "cancelled",
      updatedAt: now(),
    });
    this.emit({ type: "turn/cancelled", payload: { turn: updated, message } });
    return updated;
  }

  private failTurn(turn: TurnRecord, message: string): TurnRecord {
    const updated = this.database.updateTurn({
      ...turn,
      status: "failed",
      updatedAt: now(),
    });
    this.emit({ type: "turn/failed", payload: { turn: updated, message } });
    return updated;
  }
}

function now(): string {
  return new Date().toISOString();
}

function trimSessionHistory(historyItems: AgentInputItem[], newItems: AgentInputItem[]): AgentInputItem[] {
  const trimmedHistory = historyItems.length > 200 ? historyItems.slice(-200) : historyItems;
  return [...trimmedHistory, ...newItems];
}

function extractReasoningText(item: RunReasoningItem): string {
  const raw = item.rawItem as { content?: Array<{ text?: string }>; rawContent?: Array<{ text?: string }> };
  const parts = [...(raw.rawContent ?? []), ...(raw.content ?? [])].map((entry) => entry.text ?? "").filter(Boolean);
  return parts.join("\n");
}

function extractMessageOutputText(item: RunMessageOutputItem): string {
  const raw = item.rawItem as { content?: Array<{ type?: string; text?: string }> };
  return (raw.content ?? [])
    .filter((entry) => entry.type === "output_text")
    .map((entry) => entry.text ?? "")
    .join("");
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function parseApprovalArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }

  try {
    return JSON.parse(rawArguments) as Record<string, unknown>;
  } catch {
    return {
      raw: rawArguments,
    };
  }
}

function getApprovalCallId(item: RunToolApprovalItem): string | undefined {
  const raw = item.rawItem as { callId?: string; call_id?: string; id?: string };
  return raw.callId ?? raw.call_id ?? raw.id;
}

function safePlan(toolService: ToolService, toolName: string, args: Record<string, unknown>): PlannedToolExecution | null {
  try {
    return toolService.planExecution(toolName, args);
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof ToolExecutionAbortedError ||
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      typeof (error as { name?: unknown }).name === "string" &&
      (error as { name: string }).name === "AbortError")
  );
}
