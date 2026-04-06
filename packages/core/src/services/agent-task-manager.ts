import { type AgentTaskRecord, type EnvironmentRecord, type ProjectRecord, type ProviderProfile, type WorkspaceProfile, type WorktreeRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { ProviderService, type ChatMessage } from "./provider-service.js";
import { EnvironmentManager } from "./environment-manager.js";
import { WorktreeManager } from "./worktree-manager.js";

interface LiveAgentTask {
  task: AgentTaskRecord;
  controller: AbortController;
  messages: ChatMessage[];
  currentRun?: Promise<AgentTaskRecord>;
  worktree?: WorktreeRecord;
  environment?: EnvironmentRecord;
}

export class AgentTaskManager {
  private readonly tasks = new Map<string, LiveAgentTask>();
  private readonly providerService = new ProviderService();

  constructor(
    private readonly database: HarnessDatabase,
    private readonly worktreeManager: WorktreeManager,
    private readonly environmentManager: EnvironmentManager,
    private readonly onUpdate: (task: AgentTaskRecord) => void,
  ) {}

  spawn(params: {
    provider: ProviderProfile;
    workspace: WorkspaceProfile;
    project: ProjectRecord;
    parentThreadId: string;
    parentTurnId?: string;
    title: string;
    input: string;
    inheritHistory?: boolean;
  }): AgentTaskRecord {
    const now = new Date().toISOString();
    const taskId = createId("agent");
    const worktree = canCreateWorktree(params.project) ? this.worktreeManager.create({ project: params.project, agentId: taskId }) : undefined;
    const environment = this.environmentManager.detect({
      project: params.project,
      threadId: params.parentThreadId,
      worktreeId: worktree?.id,
      cwd: worktree?.path ?? params.workspace.rootPath,
    });
    const task = this.database.createAgentTask({
      id: taskId,
      parentThreadId: params.parentThreadId,
      parentTurnId: params.parentTurnId,
      title: params.title,
      status: "running",
      worktreeId: worktree?.id,
      environmentId: environment.id,
      createdAt: now,
      updatedAt: now,
    });
    const live: LiveAgentTask = {
      task,
      controller: new AbortController(),
      messages: [
        {
          role: "system",
          content: [
            "You are a delegated coding sub-agent.",
            `Workspace root: ${params.workspace.rootPath}`,
            worktree ? `Worktree path: ${worktree.path}` : undefined,
            environment ? `Environment cwd: ${environment.cwd}` : undefined,
            environment?.detectedTools.length ? `Detected tools: ${environment.detectedTools.join(", ")}` : undefined,
            "Respond concisely and focus only on the delegated task.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        {
          role: "user",
          content: params.input,
        },
      ],
      worktree,
      environment,
    };

    this.tasks.set(task.id, live);
    live.currentRun = this.runTask(live, params.provider);
    this.onUpdate(task);
    return task;
  }

  async sendInput(agentId: string, input: string, provider: ProviderProfile): Promise<AgentTaskRecord> {
    const live = this.requireTask(agentId);
    live.messages.push({
      role: "user",
      content: input,
    });
    live.task = this.database.updateAgentTask({
      ...live.task,
      status: "running",
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(live.task);
    live.currentRun = this.runTask(live, provider);
    return live.currentRun;
  }

  async wait(agentId: string, timeoutMs = 30_000): Promise<AgentTaskRecord> {
    const live = this.requireTask(agentId);

    if (!live.currentRun) {
      return live.task;
    }

    return Promise.race([
      live.currentRun,
      new Promise<AgentTaskRecord>((resolve) => {
        const timer = setTimeout(() => resolve(live.task), timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  close(agentId: string): AgentTaskRecord {
    const live = this.requireTask(agentId);
    live.controller.abort();
    if (live.worktree) {
      try {
        this.worktreeManager.remove(live.worktree.id);
      } catch {
        // best effort cleanup
      }
    }
    live.task = this.database.updateAgentTask({
      ...live.task,
      status: live.task.status === "completed" ? "completed" : "cancelled",
      updatedAt: new Date().toISOString(),
    });
    this.onUpdate(live.task);
    return live.task;
  }

  get(agentId: string): AgentTaskRecord | null {
    return this.database.getAgentTask(agentId);
  }

  dispose(): void {
    for (const live of this.tasks.values()) {
      live.controller.abort();
    }
    this.tasks.clear();
  }

  private async runTask(live: LiveAgentTask, provider: ProviderProfile): Promise<AgentTaskRecord> {
    try {
      const message = await this.providerService.complete({
        provider,
        messages: live.messages,
        tools: [],
        abortSignal: live.controller.signal,
      });
      const content = message.content ?? "";
      live.messages.push({
        role: "assistant",
        content,
      });
      live.task = this.database.updateAgentTask({
        ...live.task,
        status: "completed",
        finalOutput: content,
        updatedAt: new Date().toISOString(),
      });
      this.onUpdate(live.task);
      return live.task;
    } catch (error) {
      live.task = this.database.updateAgentTask({
        ...live.task,
        status: live.controller.signal.aborted ? "cancelled" : "failed",
        finalOutput: normalizeAgentTaskError(error),
        updatedAt: new Date().toISOString(),
      });
      this.onUpdate(live.task);
      return live.task;
    }
  }

  private requireTask(agentId: string): LiveAgentTask {
    const live = this.tasks.get(agentId);

    if (!live) {
      throw new Error(`Agent task not found: ${agentId}`);
    }

    return live;
  }
}

function canCreateWorktree(project: ProjectRecord): boolean {
  return Boolean(project.rootPath);
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
