import {
  type ApprovalResponseParams,
  type ArchiveThreadParams,
  type AppConfig,
  type CommandExecParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type ForkThreadParams,
  type HarnessEvent,
  type InitializeResult,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type ProjectRecord,
  type JsonRpcResponse,
  type ProviderTestResult,
  type ProviderModelsResult,
  type ReadFileParams,
  type ResumeThreadParams,
  type ResumeThreadResult,
  type StartThreadParams,
  type StartThreadResult,
  type StartTurnParams,
  type StartTurnResult,
  type ThreadRecord,
  type TurnInputAttachment,
  type TurnRecord,
  type UpdateProjectParams,
  type WritePatchParams,
} from "@my-agent/protocol";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { OpenAiCompatibleRunner } from "../agents/openai-compatible-runner.js";
import { syncExternalCodexProvider, watchExternalCodexConfig } from "../services/codex-config.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { ProviderService } from "../services/provider-service.js";
import { SkillService } from "../services/skill-service.js";
import { HarnessDatabase } from "../store/database.js";
import { ToolService } from "../tools/tool-service.js";
import { createId } from "../utils/ids.js";

export class HarnessServer {
  private readonly providerService = new ProviderService();
  private skills: ReturnType<SkillService["listSkills"]>;
  private readonly runner: OpenAiCompatibleRunner;
  private readonly stopWatchingExternalConfig: () => void;

  constructor(
    private readonly database: HarnessDatabase,
    private readonly skillService: SkillService,
    private readonly promptBuilder: PromptBuilder,
    private readonly emitRaw: (notification: JsonRpcNotification) => void,
  ) {
    const config = this.syncProjectSelection(this.database.getConfig());
    const activeProject = this.resolveWorkspaceByProjectId(config.selectedProjectId);
    this.skills = this.skillService.listSkills(activeProject.rootPath, config.disabledSkillIds);
    this.runner = new OpenAiCompatibleRunner(this.database, this.promptBuilder, (event) => this.emit(event));
    this.skillService.startWatching(activeProject.rootPath, config.disabledSkillIds);
    this.stopWatchingExternalConfig = watchExternalCodexConfig(() => {
      this.emit({
        type: "config/changed",
        payload: {
          config: this.database.getConfig(),
        },
      });
    });
  }

  dispose(): void {
    this.stopWatchingExternalConfig();
    this.skillService.dispose();
  }

  async handle(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const result = await this.route(message);
      return {
        jsonrpc: "2.0",
        id: message.id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async route(message: JsonRpcRequest): Promise<unknown> {
    switch (message.method) {
      case "initialize":
        return this.initialize();
      case "project/create":
        return this.createProject((message.params ?? {}) as CreateProjectParams);
      case "project/update":
        return this.updateProject(message.params as UpdateProjectParams);
      case "thread/start":
        return this.startThread((message.params ?? {}) as StartThreadParams);
      case "thread/resume":
        return this.resumeThread(message.params as ResumeThreadParams);
      case "thread/list":
        return { threads: this.database.listThreads() };
      case "thread/archive":
        return this.archiveThread(message.params as ArchiveThreadParams);
      case "thread/fork":
        return this.forkThread(message.params as ForkThreadParams);
      case "turn/start":
        return this.startTurn(message.params as StartTurnParams);
      case "turn/interrupt":
        return this.interruptTurn(String((message.params as { turnId: string }).turnId));
      case "approval/respond":
        return this.respondApproval(message.params as ApprovalResponseParams);
      case "command/exec":
        return this.execCommand(message.params as CommandExecParams);
      case "fs/readFile":
        return this.readFile(message.params as ReadFileParams);
      case "fs/writePatch":
        return this.writePatch(message.params as WritePatchParams);
      case "skills/list":
        return { skills: this.refreshSkills() };
      case "skills/config/write":
        return this.writeSkillConfig((message.params ?? {}) as { disabledSkillIds: string[] });
      case "provider/test":
        return this.providerTest();
      case "provider/models":
        return this.providerModels();
      case "config/read":
        return { config: this.database.getConfig() };
      case "config/write":
        return this.writeConfig(message.params as ConfigWriteParams);
      default:
        throw new Error(`Unknown method: ${message.method}`);
    }
  }

  private initialize(): InitializeResult {
    const config = this.syncProjectSelection(this.database.getConfig());
    const skills = this.refreshSkills(config.selectedProjectId);
    return {
      protocolVersion: "0.1.0",
      server: {
        name: "my-agent-core",
        version: "0.1.0",
      },
      config,
      projects: this.database.listProjects(),
      threads: this.database.listThreads(),
      skills,
    };
  }

  private createProject(params: CreateProjectParams): { project: ProjectRecord } {
    const config = this.database.getConfig();

    if (!existsSync(params.rootPath)) {
      throw new Error(`Project path does not exist: ${params.rootPath}`);
    }

    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: createId("project"),
      name: params.name?.trim() || basename(params.rootPath) || "New Project",
      rootPath: params.rootPath,
      shell: params.shell ?? config.workspace.shell,
      sandboxMode: params.sandboxMode ?? config.workspace.sandboxMode,
      approvalPolicy: params.approvalPolicy ?? config.workspace.approvalPolicy,
      createdAt: now,
      updatedAt: now,
    };

    this.database.createProject(project);
    this.database.writeConfig({
      ...config,
      selectedProjectId: project.id,
    });
    this.refreshSkills(project.id);
    return { project };
  }

  private updateProject(params: UpdateProjectParams): { project: ProjectRecord } {
    const project = this.database.getProject(params.projectId);

    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }

    if (params.patch.rootPath && !existsSync(params.patch.rootPath)) {
      throw new Error(`Project path does not exist: ${params.patch.rootPath}`);
    }

    const updated = this.database.updateProject({
      ...project,
      ...params.patch,
      updatedAt: new Date().toISOString(),
    });

    if (this.database.getConfig().selectedProjectId === updated.id) {
      this.refreshSkills(updated.id);
    }

    return { project: updated };
  }

  private startThread(params: StartThreadParams): StartThreadResult {
    const config = this.database.getConfig();
    const project = this.requireProject(params.projectId ?? config.selectedProjectId);
    const now = new Date().toISOString();
    const thread: ThreadRecord = {
      id: createId("thread"),
      title: params.title?.trim() || "New Thread",
      projectId: project.id,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.database.writeConfig({
      ...config,
      selectedProjectId: project.id,
    });
    this.database.createThread(thread);
    this.emit({ type: "thread/started", payload: { thread } });
    return { thread };
  }

  private resumeThread(params: ResumeThreadParams): ResumeThreadResult {
    const thread = this.database.getThread(params.threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }

    this.syncProjectSelection(
      this.database.writeConfig({
        ...this.database.getConfig(),
        selectedProjectId: thread.projectId,
      }),
    );
    this.refreshSkills(thread.projectId);

    return {
      thread,
      turns: this.database.listTurns(thread.id),
      items: this.database.listItems(thread.id),
      pendingApproval: this.database.listTurns(thread.id)
        .map((turn) => this.database.getPendingApprovalForTurn(turn.id))
        .find(Boolean) ?? null,
    };
  }

  private archiveThread(params: ArchiveThreadParams): { thread: ThreadRecord } {
    const thread = this.database.getThread(params.threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }

    const updated = this.database.updateThread({
      ...thread,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return { thread: updated };
  }

  private forkThread(params: ForkThreadParams): { thread: ThreadRecord } {
    const source = this.database.getThread(params.threadId);

    if (!source) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }

    const now = new Date().toISOString();
    const thread: ThreadRecord = {
      id: createId("thread"),
      title: params.title?.trim() || `${source.title} (fork)`,
      projectId: source.projectId,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    this.database.createThread(thread);
    for (const item of this.database.listItems(source.id)) {
      this.database.createItem({
        ...item,
        id: createId("item"),
        threadId: thread.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { thread };
  }

  private async startTurn(params: StartTurnParams): Promise<StartTurnResult> {
    const thread = this.database.getThread(params.threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }

    const config = this.database.getConfig();
    const project = this.requireProject(thread.projectId);
    const turn: TurnRecord = {
      id: createId("turn"),
      threadId: thread.id,
      status: "running",
      input: params.input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.database.createTurn(turn);
    this.emit({ type: "turn/started", payload: { turn } });

    this.syncProjectSelection(
      this.database.writeConfig({
        ...config,
        selectedProjectId: project.id,
      }),
    );
    const discoveredSkills = this.refreshSkills(project.id);
    const selectedSkills = this.skillService.resolveSelectedSkills(params.input, params.selectedSkillIds, discoveredSkills);
    const finalTurn = await this.runner.runTurn({
      provider: config.provider,
      workspace: project,
      thread,
      turn,
      discoveredSkills,
      selectedSkills,
      userInput: params.input,
      userAttachments: params.attachments ?? [],
      globalInstructions: config.globalInstructions,
    });

    this.database.updateThread({
      ...thread,
      title: thread.title === "New Thread" ? inferThreadTitle(params.input) : thread.title,
      updatedAt: new Date().toISOString(),
    });

    return { turn: finalTurn };
  }

  private interruptTurn(turnId: string): { turn: TurnRecord } {
    const turn = this.database.getTurn(turnId);

    if (!turn) {
      throw new Error(`Turn not found: ${turnId}`);
    }

    const interrupted = this.runner.interruptTurn(turnId);

    if (interrupted) {
      const updated = this.database.updateTurn({
        ...turn,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      });
      return { turn: updated };
    }

    const pendingApproval = this.database.getPendingApprovalForTurn(turnId);

    if (pendingApproval) {
      this.database.deletePendingApproval(pendingApproval.id);
      const updated = this.database.updateTurn({
        ...turn,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      });
      this.emit({
        type: "turn/cancelled",
        payload: {
          turn: updated,
          message: "Turn cancelled while awaiting approval.",
        },
      });
      return { turn: updated };
    }

    const updated = this.database.updateTurn({
      ...turn,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    });
    return { turn: updated };
  }

  private async respondApproval(params: ApprovalResponseParams): Promise<{ turn: TurnRecord }> {
    const pending = this.database.getPendingApproval(params.approvalId);

    if (!pending) {
      throw new Error(`Approval not found: ${params.approvalId}`);
    }

    const thread = this.database.getThread(pending.approval.threadId);
    const turn = this.database.getTurn(pending.approval.turnId);
    const config = this.database.getConfig();

    if (!thread || !turn) {
      throw new Error("Thread or turn not found for approval.");
    }

    const project = this.requireProject(thread.projectId);

    const updated = await this.runner.resumeAfterApproval(
      {
        approval: pending.approval,
        turn,
        thread,
        workspace: project,
        provider: config.provider,
      },
      params,
    );

    return { turn: updated };
  }

  private async execCommand(params: CommandExecParams): Promise<{ code: number; stdout: string; stderr: string }> {
    const workspace = this.resolveWorkspace(params.threadId);
    const toolService = new ToolService(workspace, {
      database: this.database,
      threadId: params.threadId,
    });
    const raw = await toolService.executeTool(
      "run_shell",
      { command: params.command, cwd: params.cwd },
      {
        workspace,
        emitCommandDelta: () => undefined,
      },
    );
    return JSON.parse(raw) as { code: number; stdout: string; stderr: string };
  }

  private async readFile(params: ReadFileParams): Promise<{ path: string; content: string }> {
    const workspace = this.resolveWorkspace();
    const toolService = new ToolService(workspace, {
      database: this.database,
      threadId: undefined,
    });
    const content = await toolService.executeTool(
      "read_file",
      { path: params.path },
      {
        workspace,
        emitCommandDelta: () => undefined,
      },
    );
    return {
      path: resolve(workspace.rootPath, params.path),
      content,
    };
  }

  private async writePatch(params: WritePatchParams): Promise<{ path: string; bytesWritten: number }> {
    const workspace = this.resolveWorkspace(params.threadId);
    const toolService = new ToolService(workspace, {
      database: this.database,
      threadId: params.threadId,
    });
    const raw = await toolService.executeTool(
      "write_patch",
      { path: params.path, content: params.content },
      {
        workspace,
        emitCommandDelta: () => undefined,
      },
    );

    return JSON.parse(raw) as { path: string; bytesWritten: number };
  }

  private writeSkillConfig(params: { disabledSkillIds: string[] }): { skills: ReturnType<HarnessServer["refreshSkills"]> } {
    const config = this.database.getConfig();
    this.database.writeConfig({
      ...config,
      disabledSkillIds: params.disabledSkillIds,
    });
    return { skills: this.refreshSkills(config.selectedProjectId) };
  }

  private async providerTest(): Promise<ProviderTestResult> {
    return this.providerService.test(this.database.getConfig().provider);
  }

  private async providerModels(): Promise<ProviderModelsResult> {
    return {
      models: await this.providerService.listModels(this.database.getConfig().provider),
    };
  }

  private writeConfig(params: ConfigWriteParams): { config: AppConfig } {
    const current = this.database.getConfig();
    const next: AppConfig = {
      ...current,
      ...params.config,
      provider: {
        ...current.provider,
        ...(params.config.provider ?? {}),
      },
      workspace: {
        ...current.workspace,
        ...(params.config.workspace ?? {}),
      },
      disabledSkillIds: params.config.disabledSkillIds ?? current.disabledSkillIds,
    };

    const stored = this.database.writeConfig(next);

    if (params.config.provider) {
      syncExternalCodexProvider(stored.provider);
    }

    const synced = this.syncProjectSelection(stored);
    this.emit({
      type: "config/changed",
      payload: {
        config: synced,
      },
    });
    this.refreshSkills(synced.selectedProjectId);
    return { config: synced };
  }

  private refreshSkills(projectId?: string) {
    const config = this.database.getConfig();
    const workspace = this.resolveWorkspaceByProjectId(projectId ?? config.selectedProjectId);
    this.skillService.startWatching(workspace.rootPath, config.disabledSkillIds);
    this.skills = this.skillService.listSkills(workspace.rootPath, config.disabledSkillIds);
    this.emit({ type: "skills/changed", payload: { skills: this.skills } });
    return this.skills;
  }

  private requireProject(projectId?: string): ProjectRecord {
    const project = this.resolveWorkspaceByProjectId(projectId);

    if (!project) {
      throw new Error("No project is available. Create a project first.");
    }

    return project;
  }

  private resolveWorkspace(threadId?: string): ProjectRecord {
    if (threadId) {
      const thread = this.database.getThread(threadId);

      if (thread) {
        return this.requireProject(thread.projectId);
      }
    }

    return this.requireProject(this.database.getConfig().selectedProjectId);
  }

  private resolveWorkspaceByProjectId(projectId?: string): ProjectRecord {
    if (projectId) {
      const project = this.database.getProject(projectId);

      if (project) {
        return project;
      }
    }

    const fallback = this.database.listProjects()[0];

    if (fallback) {
      return fallback;
    }

    const config = this.database.getConfig();
    const now = new Date().toISOString();
    return this.database.createProject({
      id: createId("project"),
      name: config.workspace.name,
      rootPath: config.workspace.rootPath,
      shell: config.workspace.shell,
      sandboxMode: config.workspace.sandboxMode,
      approvalPolicy: config.workspace.approvalPolicy,
      createdAt: now,
      updatedAt: now,
    });
  }

  private syncProjectSelection(config: AppConfig): AppConfig {
    const project = this.resolveWorkspaceByProjectId(config.selectedProjectId);

    if (config.selectedProjectId === project.id) {
      return config;
    }

    return this.database.writeConfig({
      ...config,
      selectedProjectId: project.id,
    });
  }

  private emit(event: HarnessEvent): void {
    this.emitRaw({
      jsonrpc: "2.0",
      method: event.type,
      params: event.payload,
    });
  }
}

function inferThreadTitle(input: string): string {
  return input.trim().slice(0, 48) || "New Thread";
}
