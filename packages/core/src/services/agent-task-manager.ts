import {
  type AgentTaskRecord,
  type EnvironmentRecord,
  type PendingApproval,
  type ProjectRecord,
  type ProviderProfile,
  type RuntimeRunMode,
  type SkillDescriptor,
  type ThreadRecord,
  type TurnRecord,
  type WorkspaceProfile,
  type WorktreeRecord,
} from "@my-agent/protocol";
import { OpenAiCompatibleRunner } from "../agents/openai-compatible-runner.js";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { type ApprovalResponseParams } from "@my-agent/protocol";
import { EnvironmentManager } from "./environment-manager.js";
import { ExecutionContextManager } from "./execution-context-manager.js";
import { WorktreeManager } from "./worktree-manager.js";

interface AgentTaskRunOptions {
  provider: ProviderProfile;
  globalInstructions?: string;
  runtimeRunMode?: RuntimeRunMode;
  requirementContext?: string;
  discoveredSkills?: SkillDescriptor[];
  selectedSkills?: SkillDescriptor[];
  mcpContext?: Array<{
    mount: import("@my-agent/protocol").McpMountRecord;
    prompts: import("@my-agent/protocol").McpPromptRecord[];
    resources: import("@my-agent/protocol").McpResourceRecord[];
  }>;
}

interface LiveAgentTask {
  task: AgentTaskRecord;
  childThread: ThreadRecord;
  project: ProjectRecord;
  workspace: WorkspaceProfile;
  worktree?: WorktreeRecord;
  environment: EnvironmentRecord;
  currentRun?: Promise<AgentTaskRecord>;
  lastRunOptions: AgentTaskRunOptions;
}

export class AgentTaskManager {
  private readonly tasks = new Map<string, LiveAgentTask>();

  constructor(
    private readonly database: HarnessDatabase,
    private readonly worktreeManager: WorktreeManager,
    private readonly environmentManager: EnvironmentManager,
    private readonly executionContextManager: ExecutionContextManager,
    private readonly runner: OpenAiCompatibleRunner,
    private readonly onUpdate: (task: AgentTaskRecord) => void,
  ) {}

  spawn(params: {
    provider: ProviderProfile;
    workspace: WorkspaceProfile;
    project: ProjectRecord;
    requirementId?: string;
    parentThreadId: string;
    parentTurnId?: string;
    title: string;
    input: string;
    inheritHistory?: boolean;
    globalInstructions?: string;
    runtimeRunMode?: import("@my-agent/protocol").RuntimeRunMode;
    requirementContext?: string;
    discoveredSkills?: SkillDescriptor[];
    selectedSkills?: SkillDescriptor[];
    mcpContext?: AgentTaskRunOptions["mcpContext"];
  }): AgentTaskRecord {
    const now = new Date().toISOString();
    const taskId = createId("agent");
    const worktree = canCreateWorktree(params.project)
      ? this.worktreeManager.create({ project: params.project, requirementId: params.requirementId, agentId: taskId })
      : undefined;
    const delegatedWorkspace = buildDelegatedWorkspace(params.workspace, params.project, worktree);
    const childThread = this.database.createThread({
      id: createId("thread"),
      title: params.title?.trim() || "Delegated task",
      projectId: params.project.id,
      requirementId: params.requirementId,
      sandboxMode: delegatedWorkspace.sandboxMode,
      hidden: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });

    if (params.inheritHistory) {
      this.database.copySessionItems(params.parentThreadId, childThread.id);
    }

    const environment = this.environmentManager.detect({
      project: params.project,
      requirementId: params.requirementId,
      threadId: childThread.id,
      worktreeId: worktree?.id,
      cwd: delegatedWorkspace.rootPath,
    });
    const executionContext = this.executionContextManager.create({
      project: params.project,
      requirementId: params.requirementId,
      kind: "agent",
      threadId: childThread.id,
      agentId: taskId,
      worktree,
      environment,
    });
    const task = this.database.createAgentTask({
      id: taskId,
      parentThreadId: params.parentThreadId,
      parentTurnId: params.parentTurnId,
      title: params.title,
      status: "running",
      childThreadId: childThread.id,
      worktreeId: worktree?.id,
      environmentId: environment.id,
      executionContextId: executionContext.id,
      createdAt: now,
      updatedAt: now,
    });
    const live: LiveAgentTask = {
      task,
      childThread,
      project: params.project,
      workspace: delegatedWorkspace,
      worktree,
      environment,
      lastRunOptions: {
        provider: params.provider,
        globalInstructions: params.globalInstructions,
        runtimeRunMode: params.runtimeRunMode,
        requirementContext: params.requirementContext,
        discoveredSkills: params.discoveredSkills ?? [],
        selectedSkills: params.selectedSkills ?? [],
        mcpContext: params.mcpContext,
      },
    };

    this.tasks.set(task.id, live);
    this.onUpdate(task);
    live.currentRun = this.runTask(live, params.input, live.lastRunOptions);
    return task;
  }

  async sendInput(
    agentId: string,
    input: string,
    options: AgentTaskRunOptions,
  ): Promise<AgentTaskRecord> {
    const live = this.requireTask(agentId);
    live.lastRunOptions = options;
    live.task = this.persistTask({
      ...live.task,
      status: "running",
      updatedAt: new Date().toISOString(),
    });
    live.currentRun = this.runTask(live, input, options);
    return live.currentRun;
  }

  async resumeAfterApproval(
    params: {
      approval: PendingApproval;
      turn: TurnRecord;
      thread: ThreadRecord;
      workspace: WorkspaceProfile;
      provider: ProviderProfile;
    },
    response: ApprovalResponseParams,
  ): Promise<AgentTaskRecord | null> {
    const task = this.database.getAgentTaskByChildThreadId(params.thread.id);

    if (!task) {
      return null;
    }

    const updatedTurn = await this.runner.resumeAfterApproval(params, response);
    return this.syncTaskForHiddenThread(params.thread.id, updatedTurn.id);
  }

  async wait(agentId: string, timeoutMs = 30_000): Promise<AgentTaskRecord> {
    const live = this.requireTask(agentId);

    if (!live.currentRun) {
      return this.database.getAgentTask(agentId) ?? live.task;
    }

    if (timeoutMs === Number.POSITIVE_INFINITY) {
      return live.currentRun;
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return this.database.getAgentTask(agentId) ?? live.task;
    }

    return Promise.race([
      live.currentRun,
      new Promise<AgentTaskRecord>((resolve) => {
        const timer = setTimeout(() => resolve(this.database.getAgentTask(agentId) ?? live.task), timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  close(agentId: string): AgentTaskRecord {
    const live = this.requireTask(agentId);

    if (live.task.lastTurnId) {
      this.runner.interruptTurn(live.task.lastTurnId);
    }

    if (live.worktree) {
      try {
        this.worktreeManager.remove(live.worktree.id);
      } catch {
        // best effort cleanup
      }
    }

    live.task = this.persistTask({
      ...live.task,
      status: live.task.status === "completed" ? "completed" : "cancelled",
      updatedAt: new Date().toISOString(),
    });
    return live.task;
  }

  get(agentId: string): AgentTaskRecord | null {
    return this.database.getAgentTask(agentId);
  }

  syncTaskForHiddenThread(threadId: string, turnId?: string): AgentTaskRecord | null {
    const task = this.database.getAgentTaskByChildThreadId(threadId);

    if (!task) {
      return null;
    }

    const live = this.tasks.get(task.id);
    const turns = this.database.listTurns(threadId);
    const relevantTurn =
      (turnId ? turns.find((entry) => entry.id === turnId) : undefined) ??
      turns
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .at(0);

    if (!relevantTurn) {
      return task;
    }

    const summary = summarizeAgentThread(this.database, threadId, relevantTurn.id);
    const nextStatus = mapTaskStatus(relevantTurn.status);
    const nextTask = this.persistTask({
      ...task,
      status: nextStatus,
      lastTurnId: relevantTurn.id,
      finalOutput: summary.finalMessage ?? task.finalOutput,
      summary,
      updatedAt: new Date().toISOString(),
    });

    if (live) {
      live.task = nextTask;
    }

    return nextTask;
  }

  dispose(): void {
    for (const live of this.tasks.values()) {
      if (live.task.lastTurnId) {
        this.runner.interruptTurn(live.task.lastTurnId);
      }
    }
    this.tasks.clear();
  }

  private async runTask(live: LiveAgentTask, input: string, options: AgentTaskRunOptions): Promise<AgentTaskRecord> {
    const now = new Date().toISOString();
    const turn: TurnRecord = {
      id: createId("turn"),
      threadId: live.childThread.id,
      status: "running",
      input,
      createdAt: now,
      updatedAt: now,
    };
    this.database.createTurn(turn);
    live.task = this.persistTask({
      ...live.task,
      status: "running",
      lastTurnId: turn.id,
      updatedAt: now,
    });

    try {
      const finalTurn = await this.runner.runTurn({
        provider: options.provider,
        workspace: live.workspace,
        thread: live.childThread,
        turn,
        discoveredSkills: options.discoveredSkills ?? [],
        selectedSkills: options.selectedSkills ?? [],
        userInput: input,
        userAttachments: [],
        globalInstructions: options.globalInstructions ?? "",
        runtimeRunMode: options.runtimeRunMode,
        mcpContext: options.mcpContext,
        requirementContext: options.requirementContext,
      });
      const synced = this.syncTaskForHiddenThread(live.childThread.id, finalTurn.id);
      return synced ?? live.task;
    } catch (error) {
      live.task = this.persistTask({
        ...live.task,
        status: "failed",
        lastTurnId: turn.id,
        finalOutput: normalizeAgentTaskError(error),
        updatedAt: new Date().toISOString(),
      });
      return live.task;
    }
  }

  private persistTask(task: AgentTaskRecord): AgentTaskRecord {
    const updated = this.database.updateAgentTask(task);
    this.onUpdate(updated);
    return updated;
  }

  private requireTask(agentId: string): LiveAgentTask {
    const live = this.tasks.get(agentId);

    if (!live) {
      throw new Error(`Agent task not found: ${agentId}`);
    }

    return live;
  }
}

function buildDelegatedWorkspace(workspace: WorkspaceProfile, project: ProjectRecord, worktree?: WorktreeRecord): WorkspaceProfile {
  return {
    id: project.id,
    name: project.name,
    rootPath: worktree?.path ?? project.rootPath,
    shell: project.shell,
    sandboxMode: workspace.sandboxMode,
    approvalPolicy: project.approvalPolicy,
  };
}

function canCreateWorktree(project: ProjectRecord): boolean {
  return Boolean(project.rootPath);
}

function mapTaskStatus(turnStatus: TurnRecord["status"]): AgentTaskRecord["status"] {
  switch (turnStatus) {
    case "awaiting_approval":
      return "awaiting_approval";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}

function summarizeAgentThread(database: HarnessDatabase, threadId: string, turnId: string): NonNullable<AgentTaskRecord["summary"]> {
  const items = database.listItems(threadId).filter((item) => item.turnId === turnId);
  const changedPaths = [...new Set(items.map((item) => (typeof item.metadata?.path === "string" ? item.metadata.path : null)).filter((value): value is string => Boolean(value)))];
  const finalMessage = items
    .filter((item) => item.kind === "agentMessage")
    .slice()
    .reverse()
    .at(0)?.body;

  return {
    finalMessage,
    toolCallCount: items.filter((item) => item.kind === "toolCall" || item.kind === "toolResult").length,
    fileChangeCount: items.filter((item) => item.kind === "fileChange").length,
    commandCount: items.filter((item) => item.kind === "commandExecution").length,
    approvalRequestCount: items.filter((item) => item.kind === "approvalRequest").length,
    changedPaths,
  };
}

function normalizeAgentTaskError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const compact = message.replace(/\s+/g, " ").trim();

  if (/^<!doctype html/i.test(compact) || /^<html[\s>]/i.test(compact) || /<head[\s>]/i.test(compact)) {
    const statusMatch = compact.match(/\b([45]\d{2})\b/);
    const status = statusMatch?.[1];
    return status
      ? `Upstream provider returned an HTML error page (${status}).`
      : "Upstream provider returned an HTML error page.";
  }

  return compact || "Delegated agent request failed.";
}
