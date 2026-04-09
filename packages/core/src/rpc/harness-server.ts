import {
  type AgentCloseParams,
  type AgentSendInputParams,
  type AgentSpawnParams,
  type AgentWaitParams,
  type ApplyPatchParams,
  type ApprovalResponseParams,
  type ArchiveThreadParams,
  type AppConfig,
  type CommandExecParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type ForkThreadParams,
  type HarnessEvent,
  type InitializeResult,
  type McpRefreshParams,
  type McpListResult,
  type McpSessionsResult,
  type McpToolsResult,
  type PluginListResult,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type ProjectRecord,
  type JsonRpcResponse,
  type ProviderActionParams,
  type ProviderTestResult,
  type ProviderModelsResult,
  type ReadFileParams,
  type ReviewListResult,
  type ReviewStartParams,
  type ReviewStartResult,
  type ResumeThreadParams,
  type ResumeThreadResult,
  type TerminalArchiveParams,
  type TerminalCloseParams,
  type TerminalApprovalResponseParams,
  type TerminalClearBufferParams,
  type TerminalCreateParams,
  type TerminalReadParams,
  type TerminalResizeParams,
  type TerminalWriteParams,
  type StartThreadParams,
  type StartThreadResult,
  type StartTurnParams,
  type StartTurnResult,
  type ThreadRecord,
  type TurnInputAttachment,
  type TurnSteerParams,
  type TurnSteerRecord,
  type TurnSteerResult,
  type TurnRecord,
  type WorktreeCreateParams,
  type WorktreeListParams,
  type WorktreeRemoveParams,
  type WorkflowRunParams,
  type WorkflowResumeParams,
  type WorkflowRunsResult,
  type WorkflowRunResult,
  type EnvironmentDetectParams,
  type UpdateProjectParams,
  type WritePatchParams,
  type UpdateThreadParams,
} from "@my-agent/protocol";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { OpenAiCompatibleRunner } from "../agents/openai-compatible-runner.js";
import { AgentTaskManager } from "../services/agent-task-manager.js";
import { detectProviderCapabilities } from "../services/provider-capabilities.js";
import { EnvironmentManager } from "../services/environment-manager.js";
import { ExecutionContextManager } from "../services/execution-context-manager.js";
import { McpManager } from "../services/mcp-manager.js";
import { ensureStoredProviderConfig, syncStoredProviderConfig, watchStoredConfig } from "../services/my-agent-config.js";
import { PluginManager } from "../services/plugin-manager.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { ProviderService } from "../services/provider-service.js";
import { ReviewManager } from "../services/review-manager.js";
import { SkillService } from "../services/skill-service.js";
import { TerminalManager } from "../services/terminal-manager.js";
import { WorkflowManager } from "../services/workflow-manager.js";
import { WorktreeManager } from "../services/worktree-manager.js";
import { HarnessDatabase } from "../store/database.js";
import { ToolService } from "../tools/tool-service.js";
import { createId } from "../utils/ids.js";

export class HarnessServer {
  private readonly providerService = new ProviderService();
  private skills: ReturnType<SkillService["listSkills"]>;
  private readonly runner: OpenAiCompatibleRunner;
  private readonly stopWatchingExternalConfig: () => void;
  private readonly terminalManager: TerminalManager;
  private readonly agentTaskManager: AgentTaskManager;
  private readonly worktreeManager: WorktreeManager;
  private readonly environmentManager: EnvironmentManager;
  private readonly executionContextManager: ExecutionContextManager;
  private readonly workflowManager: WorkflowManager;
  private readonly pluginManager: PluginManager;
  private readonly mcpManager: McpManager;
  private readonly reviewManager: ReviewManager;

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
    this.terminalManager = new TerminalManager(this.database, (session) =>
      this.emit({
        type: "terminal/updated",
        payload: {
          session,
        },
      }),
      (output) =>
        this.emit({
          type: "terminal/output",
          payload: output,
        }),
      (archive) =>
        this.emit({
          type: "terminal/outputArchived",
          payload: { archive },
        }),
      (event) =>
        this.emit({
          type: "terminal/outputCleared",
          payload: event,
        }),
    );
    this.worktreeManager = new WorktreeManager(this.database, (worktree) =>
      this.emit({
        type: "worktree/updated",
        payload: { worktree },
      }),
    );
    this.environmentManager = new EnvironmentManager(this.database, (environment) =>
      this.emit({
        type: "environment/updated",
        payload: { environment },
      }),
    );
    this.executionContextManager = new ExecutionContextManager(this.database, (executionContext) =>
      this.emit({
        type: "executionContext/updated",
        payload: { executionContext },
      }),
    );
    const delegatedRunner = new OpenAiCompatibleRunner(this.database, this.promptBuilder, () => undefined);
    this.agentTaskManager = new AgentTaskManager(
      this.database,
      this.worktreeManager,
      this.environmentManager,
      this.executionContextManager,
      delegatedRunner,
      (task) => {
        this.upsertAgentTaskResultItem(task);
        this.emit({
          type: "agent/updated",
          payload: {
            task,
          },
        });
      },
    );
    this.reviewManager = new ReviewManager(
      this.database,
      this.providerService,
      this.environmentManager,
      this.executionContextManager,
      (event) => this.emit(event),
    );
    this.workflowManager = new WorkflowManager(
      this.database,
      this.worktreeManager,
      this.environmentManager,
      this.executionContextManager,
      this.reviewManager,
      this.agentTaskManager,
      (workflow) =>
        this.emit({
          type: "workflow/updated",
          payload: { workflow },
        }),
      (run) =>
        this.emit({
          type: "workflow/run",
          payload: { run },
        }),
    );
    this.pluginManager = new PluginManager(this.database, (plugin) =>
      this.emit({
        type: "plugin/updated",
        payload: { plugin },
      }),
    );
    this.mcpManager = new McpManager(
      this.database,
      (mount) =>
        this.emit({
          type: "mcp/updated",
          payload: { mount },
        }),
      (session) =>
        this.emit({
          type: "mcp/session",
          payload: { session },
        }),
    );
    void this.mcpManager.refreshAll();
    this.skillService.startWatching(activeProject.rootPath, config.disabledSkillIds);
    ensureStoredProviderConfig(config.provider);
    this.stopWatchingExternalConfig = watchStoredConfig(() => {
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
    this.terminalManager.dispose();
    this.agentTaskManager.dispose();
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
      case "thread/update":
        return this.updateThread(message.params as UpdateThreadParams);
      case "thread/list":
        return { threads: this.database.listThreads() };
      case "thread/archive":
        return this.archiveThread(message.params as ArchiveThreadParams);
      case "thread/fork":
        return this.forkThread(message.params as ForkThreadParams);
      case "turn/start":
        return this.startTurn(message.params as StartTurnParams);
      case "turn/steer":
        return this.steerTurn(message.params as TurnSteerParams);
      case "turn/interrupt":
        return this.interruptTurn(String((message.params as { turnId: string }).turnId));
      case "review/start":
        return this.startReview((message.params ?? {}) as ReviewStartParams);
      case "review/list":
        return this.listReviews(message.params as { projectId?: string; threadId?: string } | undefined);
      case "approval/respond":
        return this.respondApproval(message.params as ApprovalResponseParams);
      case "command/exec":
        return this.execCommand(message.params as CommandExecParams);
      case "fs/readFile":
        return this.readFile(message.params as ReadFileParams);
      case "fs/writePatch":
        return this.writePatch(message.params as WritePatchParams);
      case "fs/applyPatch":
        return this.applyPatch(message.params as ApplyPatchParams);
      case "terminal/create":
        return this.createTerminal(message.params as TerminalCreateParams);
      case "terminal/write":
        return this.writeTerminal(message.params as TerminalWriteParams);
      case "terminal/read":
        return this.readTerminal(message.params as TerminalReadParams);
      case "terminal/archive":
        return this.archiveTerminalOutput(message.params as TerminalArchiveParams);
      case "terminal/clear":
        return this.clearTerminalOutput(message.params as TerminalClearBufferParams);
      case "terminal/resize":
        return this.resizeTerminal(message.params as TerminalResizeParams);
      case "terminal/close":
        return this.closeTerminal(message.params as TerminalCloseParams);
      case "terminal/approval/respond":
        return this.respondTerminalApproval(message.params as TerminalApprovalResponseParams);
      case "agent/spawn":
        return this.spawnAgent(message.params as AgentSpawnParams);
      case "agent/send_input":
        return this.sendAgentInput(message.params as AgentSendInputParams);
      case "agent/wait":
        return this.waitAgent(message.params as AgentWaitParams);
      case "agent/close":
        return this.closeAgent(message.params as AgentCloseParams);
      case "agent/list":
        return this.listAgentTasks((message.params as { projectId?: string } | undefined)?.projectId);
      case "worktree/create":
        return this.createWorktree(message.params as WorktreeCreateParams);
      case "worktree/list":
        return this.listWorktrees(message.params as WorktreeListParams);
      case "worktree/remove":
        return this.removeWorktree(message.params as WorktreeRemoveParams);
      case "environment/detect":
        return this.detectEnvironment(message.params as EnvironmentDetectParams);
      case "environment/list":
        return { environments: this.database.listEnvironments((message.params as { projectId?: string } | undefined)?.projectId) };
      case "executionContext/list":
        return { executionContexts: this.database.listExecutionContexts((message.params as { projectId?: string } | undefined)?.projectId) };
      case "workflow/list":
        return { workflows: this.listWorkflows((message.params as { projectId?: string } | undefined)?.projectId) };
      case "workflow/run":
        return this.runWorkflow(message.params as WorkflowRunParams);
      case "workflow/resume":
        return this.resumeWorkflow(message.params as WorkflowResumeParams);
      case "workflow/runs":
        return this.listWorkflowRuns((message.params as { workflowId?: string } | undefined)?.workflowId);
      case "plugin/list":
        return this.listPlugins();
      case "mcp/list":
        return this.listMcpMounts();
      case "mcp/sessions":
        return this.listMcpSessions();
      case "mcp/refresh":
        return this.refreshMcpMount(message.params as McpRefreshParams);
      case "skills/list":
        return { skills: this.refreshSkills() };
      case "skills/config/write":
        return this.writeSkillConfig((message.params ?? {}) as { disabledSkillIds: string[] });
      case "provider/test":
        return this.providerTest(message.params as ProviderActionParams | undefined);
      case "provider/models":
        return this.providerModels(message.params as ProviderActionParams | undefined);
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
      worktrees: this.database.listWorktrees(config.selectedProjectId),
      environments: this.database.listEnvironments(config.selectedProjectId),
      executionContexts: this.database.listExecutionContexts(config.selectedProjectId),
      terminals: this.database.listTerminalSessions(),
      terminalCapabilities: this.terminalManager.listCapabilities(),
      terminalOutputArchives: this.database.listTerminalOutputArchives(),
      reviews: this.reviewManager.list(config.selectedProjectId),
      workflows: this.listWorkflows(config.selectedProjectId),
      workflowRuns: this.workflowManager.listRuns(),
      agentTasks: this.database.listAgentTasks(config.selectedProjectId),
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
      sandboxMode: params.sandboxMode ?? project.sandboxMode,
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

  private updateThread(params: UpdateThreadParams): { thread: ThreadRecord } {
    const thread = this.database.getThread(params.threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }

    const updated = this.database.updateThread({
      ...thread,
      ...params.patch,
      sandboxMode: params.patch.sandboxMode ?? thread.sandboxMode,
      updatedAt: new Date().toISOString(),
    });

    return { thread: updated };
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
    this.clearThreadSessionApprovals(thread.id);
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
    this.clearThreadSessionApprovals(thread.id);
    this.terminalManager.closeThreadSessions(thread.id);

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
      sandboxMode: source.sandboxMode,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    this.database.createThread(thread);
    const turnIdMap = new Map<string, string>();

    for (const turn of this.database.listTurns(source.id)) {
      const forkedTurn: TurnRecord = {
        ...turn,
        id: createId("turn"),
        threadId: thread.id,
        updatedAt: now,
        createdAt: now,
      };
      this.database.createTurn(forkedTurn);
      turnIdMap.set(turn.id, forkedTurn.id);
    }

    for (const item of this.database.listItems(source.id)) {
      this.database.createItem({
        ...item,
        id: createId("item"),
        threadId: thread.id,
        turnId: turnIdMap.get(item.turnId) ?? item.turnId,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.database.copySessionItems(source.id, thread.id);
    this.clearThreadSessionApprovals(thread.id);

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
    const workspace = this.resolveThreadWorkspace(project, thread);
    const selectedSkills = this.skillService.resolveSelectedSkills(params.input, params.selectedSkillIds, discoveredSkills);
    const mcpContext = await this.buildRelevantMcpContext(params.input);
    const finalTurn = await this.runner.runTurn({
      provider: config.provider,
      workspace,
      thread,
      turn,
      discoveredSkills,
      selectedSkills,
      userInput: params.input,
      userAttachments: params.attachments ?? [],
      globalInstructions: config.globalInstructions,
      runtimeRunMode: config.runtimeRunMode ?? config.providerCapabilities?.recommendedRunMode ?? "full-tools",
      mcpContext,
      ideContext: params.includeIdeContext
        ? {
            projectName: project.name,
            workspaceRoot: project.rootPath,
            threadTitle: thread.title,
            model: config.provider.model || "Not selected",
            reasoningEffort: config.provider.reasoningEffort ?? "high",
            enabledSkills: discoveredSkills
              .filter((skill) => skill.enabled)
              .map((skill) => skill.metadata.displayName ?? skill.name),
          }
        : undefined,
    });

    this.database.updateThread({
      ...thread,
      title: thread.title === "New Thread" ? inferThreadTitle(params.input) : thread.title,
      updatedAt: new Date().toISOString(),
    });

    return { turn: finalTurn };
  }

  private steerTurn(params: TurnSteerParams): TurnSteerResult {
    const turn = this.database.getTurn(params.turnId);

    if (!turn) {
      throw new Error(`Turn not found: ${params.turnId}`);
    }

    const steer: TurnSteerRecord = {
      id: createId("steer"),
      turnId: turn.id,
      threadId: turn.threadId,
      input: params.input.trim(),
      priority: params.priority ?? "normal",
      visibility: params.visibility ?? "user",
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    if (!steer.input) {
      throw new Error("Steer input cannot be empty.");
    }

    if (!this.runner.steerTurn(steer)) {
      throw new Error("Turn is no longer running, so steer could not be applied.");
    }

    this.emit({
      type: "turn/steered",
      payload: { steer },
    });

    return { steer };
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
      this.clearThreadSessionApprovals(turn.threadId);
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
      this.clearThreadSessionApprovals(turn.threadId);
      return { turn: updated };
    }

    const updated = this.database.updateTurn({
      ...turn,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    });
    this.clearThreadSessionApprovals(turn.threadId);
    return { turn: updated };
  }

  private startReview(params: ReviewStartParams): ReviewStartResult {
    const thread = params.threadId ? this.database.getThread(params.threadId) : null;
    const project = this.requireProject(params.projectId ?? thread?.projectId);
    const review = this.reviewManager.start({
      project,
      provider: this.database.getConfig().provider,
      threadId: thread?.id,
      source: params.source,
      instructions: params.instructions,
    });
    return { review };
  }

  private listReviews(params?: { projectId?: string; threadId?: string }): ReviewListResult {
    return {
      reviews: this.reviewManager.list(params?.projectId, params?.threadId),
    };
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
    const delegatedTask = this.database.getAgentTaskByChildThreadId(thread.id);
    const workspace = this.resolveThreadWorkspace(project, thread);
    const updated = delegatedTask
      ? await this.agentTaskManager.resumeAfterApproval(
          {
            approval: pending.approval,
            turn,
            thread,
            workspace,
            provider: config.provider,
          },
          params,
        ).then((task) => {
          const latestTurn = task?.lastTurnId ? this.database.getTurn(task.lastTurnId) : null;
          return latestTurn ?? turn;
        })
      : await this.runner.resumeAfterApproval(
          {
            approval: pending.approval,
            turn,
            thread,
            workspace,
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

  private async applyPatch(params: ApplyPatchParams) {
    const workspace = this.resolveWorkspace(params.threadId);
    const toolService = new ToolService(workspace, {
      database: this.database,
      threadId: params.threadId,
    });
    const raw = await toolService.executeTool(
      "apply_patch",
      { patch: params.patch },
      {
        workspace,
        emitCommandDelta: () => undefined,
      },
    );
    return JSON.parse(raw);
  }

  private createTerminal(params: TerminalCreateParams) {
    const workspace = this.resolveWorkspace(params.threadId);
    const session = this.terminalManager.createSession(workspace, params);
    return { session };
  }

  private writeTerminal(params: TerminalWriteParams) {
    const session = this.database.getTerminalSession(params.sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${params.sessionId}`);
    }

    const workspace = this.resolveWorkspace(session.threadId);
    const toolService = new ToolService(workspace, {
      database: this.database,
      threadId: session.threadId,
    });

    const command = params.input.trim() || "echo";
    const plan = toolService.planExecution("run_shell", {
      command,
      cwd: session.cwd,
    });
    const backendCapability = this.terminalManager.getCapability(session.backend);

    if (plan.descriptor.interactive && backendCapability && !backendCapability.supportsInteractiveCommands) {
      this.terminalManager.recordCommandAssessment(params.sessionId, {
        command,
        risk: "interactive",
        approvalState: "blocked",
        requiresApproval: false,
        reason: `${session.backend.toUpperCase()} backend does not support interactive commands. Use a PTY-backed terminal session.`,
      });
      throw new Error(`${session.backend.toUpperCase()} backend does not support interactive commands. Use a PTY-backed terminal session.`);
    }

    const sessionApproved = plan.permission.approvalKey
      ? this.database.hasTerminalApprovalRule(params.sessionId, plan.permission.approvalKey)
      : false;
    const effectivePermission = sessionApproved
      ? {
          ...plan.permission,
          requiresApproval: false,
          approvalMode: "none" as const,
          sessionApproved: true,
        }
      : plan.permission;

    this.terminalManager.recordCommandAssessment(params.sessionId, {
      command,
      risk: plan.descriptor.riskLevel ?? "write",
      approvalState: !effectivePermission.allowed
        ? "blocked"
        : effectivePermission.approvalMode === "deferred"
          ? "deferred"
          : effectivePermission.requiresApproval
            ? "required"
            : "not_required",
      requiresApproval: effectivePermission.requiresApproval,
      reason: effectivePermission.denialReason ?? effectivePermission.approvalReason,
    });

    if (!effectivePermission.allowed) {
      throw new Error(effectivePermission.denialReason ?? "Terminal input is blocked by the current sandbox policy.");
    }

    if (effectivePermission.approvalMode !== "none") {
      const updated = this.terminalManager.setPendingApproval(params.sessionId, {
        mode: effectivePermission.approvalMode,
        command,
        reason: effectivePermission.approvalReason,
      });
      return { session: updated };
    }

    return {
      session: this.terminalManager.writeInput(this.terminalManager.clearPendingApproval(params.sessionId).id, params.input),
    };
  }

  private respondTerminalApproval(params: TerminalApprovalResponseParams) {
    const session = this.database.getTerminalSession(params.sessionId);

    if (!session) {
      throw new Error(`Terminal session not found: ${params.sessionId}`);
    }

    const command = session.pendingApprovalCommand?.trim();

    if (!command) {
      throw new Error("Terminal session has no pending approval command.");
    }

    if (params.decision === "reject") {
      this.terminalManager.recordCommandAssessment(params.sessionId, {
        command,
        risk: session.lastCommandRisk ?? "write",
        approvalState: "blocked",
        requiresApproval: false,
        reason: "User rejected the pending terminal command.",
      });
      return { session: this.terminalManager.clearPendingApproval(params.sessionId) };
    }

    const workspace = this.resolveWorkspace(session.threadId);
    const toolService = new ToolService(workspace, {
      database: this.database,
      threadId: session.threadId,
    });
    const plan = toolService.planExecution("run_shell", {
      command,
      cwd: session.cwd,
    });

    if (params.scope === "session" && plan.permission.approvalKey) {
      this.database.upsertTerminalApprovalRule({
        sessionId: params.sessionId,
        approvalKey: plan.permission.approvalKey,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    this.terminalManager.recordCommandAssessment(params.sessionId, {
      command,
      risk: plan.descriptor.riskLevel ?? "write",
      approvalState: "not_required",
      requiresApproval: false,
      reason: params.scope === "session" ? "Approved for the remainder of this terminal session." : "Approved once.",
    });
    const cleared = this.terminalManager.clearPendingApproval(params.sessionId);

    return {
      session: this.terminalManager.writeInput(cleared.id, `${command}${command.endsWith("\n") ? "" : "\n"}`),
    };
  }

  private readTerminal(params: TerminalReadParams) {
    return this.terminalManager.readOutput(params.sessionId);
  }

  private archiveTerminalOutput(params: TerminalArchiveParams) {
    return {
      session: this.terminalManager.archiveOutputBuffer(params.sessionId),
    };
  }

  private clearTerminalOutput(params: TerminalClearBufferParams) {
    return {
      session: this.terminalManager.clearOutputBuffer(params.sessionId),
    };
  }

  private resizeTerminal(params: TerminalResizeParams) {
    return {
      session: this.terminalManager.resizeSession(params.sessionId, params.cols, params.rows),
    };
  }

  private closeTerminal(params: TerminalCloseParams) {
    return {
      session: this.terminalManager.closeSession(params.sessionId),
    };
  }

  private async spawnAgent(params: AgentSpawnParams) {
    const thread = this.database.getThread(params.threadId);

    if (!thread) {
      throw new Error(`Thread not found: ${params.threadId}`);
    }

    const workspace = this.resolveThreadWorkspace(this.requireProject(thread.projectId), thread);
    const project = this.requireProject(thread.projectId);
    const config = this.database.getConfig();
    const discoveredSkills = this.refreshSkills(project.id);
    const selectedSkills = this.skillService.resolveSelectedSkills(params.input, params.selectedSkillIds, discoveredSkills);
    const mcpContext = await this.buildRelevantMcpContext(params.input);
    const task = this.agentTaskManager.spawn({
      provider: config.provider,
      workspace,
      project,
      parentThreadId: thread.id,
      parentTurnId: params.turnId,
      title: params.title?.trim() || "Delegated task",
      input: params.input,
      inheritHistory: params.inheritHistory,
      globalInstructions: config.globalInstructions,
      runtimeRunMode: config.runtimeRunMode ?? config.providerCapabilities?.recommendedRunMode ?? "full-tools",
      discoveredSkills,
      selectedSkills,
      mcpContext,
    });

    return { task };
  }

  private async sendAgentInput(params: AgentSendInputParams) {
    const task = this.database.getAgentTask(params.agentId);

    if (!task) {
      throw new Error(`Agent task not found: ${params.agentId}`);
    }

    if (!this.database.getThread(task.parentThreadId)) {
      throw new Error(`Thread not found: ${task.parentThreadId}`);
    }

    const parentThread = this.database.getThread(task.parentThreadId);

    if (!parentThread) {
      throw new Error(`Thread not found: ${task.parentThreadId}`);
    }

    const config = this.database.getConfig();
    const project = this.requireProject(parentThread.projectId);
    const discoveredSkills = this.refreshSkills(project.id);
    const selectedSkills = this.skillService.resolveSelectedSkills(params.input, undefined, discoveredSkills);
    const mcpContext = await this.buildRelevantMcpContext(params.input);
    const updated = await this.agentTaskManager.sendInput(params.agentId, params.input, {
      provider: config.provider,
      globalInstructions: config.globalInstructions,
      runtimeRunMode: config.runtimeRunMode ?? config.providerCapabilities?.recommendedRunMode ?? "full-tools",
      discoveredSkills,
      selectedSkills,
      mcpContext,
    });

    return { task: updated };
  }

  private async waitAgent(params: AgentWaitParams) {
    const task = await this.agentTaskManager.wait(params.agentId, params.timeoutMs);
    return { task };
  }

  private closeAgent(params: AgentCloseParams) {
    const task = this.agentTaskManager.close(params.agentId);
    return { task };
  }

  private listAgentTasks(projectId?: string) {
    return {
      tasks: this.database.listAgentTasks(projectId),
    };
  }

  private writeSkillConfig(params: { disabledSkillIds: string[] }): { skills: ReturnType<HarnessServer["refreshSkills"]> } {
    const config = this.database.getConfig();
    this.database.writeConfig({
      ...config,
      disabledSkillIds: params.disabledSkillIds,
    });
    return { skills: this.refreshSkills(config.selectedProjectId) };
  }

  private async providerTest(params?: ProviderActionParams): Promise<ProviderTestResult> {
    const provider = this.resolveProviderActionProfile(params);

    if (provider.apiFlavor !== "responses") {
      return {
        ok: false,
        status: 0,
        message: `Provider runtime "${provider.apiFlavor}" can list models but is not supported for agent execution. Use "responses".`,
      };
    }

    return this.providerService.test(provider);
  }

  private async providerModels(params?: ProviderActionParams): Promise<ProviderModelsResult> {
    return {
      models: await this.providerService.listModels(this.resolveProviderActionProfile(params)),
    };
  }

  private resolveProviderActionProfile(params?: ProviderActionParams): AppConfig["provider"] {
    return {
      ...this.database.getConfig().provider,
      ...(params?.provider ?? {}),
    };
  }

  private createWorktree(params: WorktreeCreateParams) {
    const project = this.requireProject(params.projectId);
    return {
      worktree: this.worktreeManager.create({
        project,
        threadId: params.threadId,
        agentId: params.agentId,
        branch: params.branch,
        baseRef: params.baseRef,
      }),
    };
  }

  private listWorktrees(params: WorktreeListParams | undefined) {
    return {
      worktrees: this.worktreeManager.list(params?.projectId),
    };
  }

  private removeWorktree(params: WorktreeRemoveParams) {
    return {
      worktree: this.worktreeManager.remove(params.worktreeId),
    };
  }

  private detectEnvironment(params: EnvironmentDetectParams) {
    const project = this.requireProject(params.projectId);
    return {
      environment: this.environmentManager.detect({
        project,
        threadId: params.threadId,
        worktreeId: params.worktreeId,
        cwd: params.cwd,
      }),
    };
  }

  private listWorkflows(projectId?: string) {
    const project = projectId ? this.requireProject(projectId) : this.requireProject(this.database.getConfig().selectedProjectId);
    return this.workflowManager.list(project);
  }

  private async runWorkflow(params: WorkflowRunParams): Promise<WorkflowRunResult> {
    const project = this.requireProject(params.projectId);
    return this.workflowManager.run({
      workflowId: params.workflowId,
      project,
      provider: this.database.getConfig().provider,
      workspace: project,
      threadId: params.threadId,
      nonInteractive: params.nonInteractive,
      runId: params.runId,
    });
  }

  private async resumeWorkflow(params: WorkflowResumeParams): Promise<WorkflowRunResult> {
    const run = this.database.getWorkflowRun(params.runId);

    if (!run) {
      throw new Error(`Workflow run not found: ${params.runId}`);
    }

    const project = this.requireProject(run.projectId);
    return this.workflowManager.resume({
      runId: params.runId,
      project,
      provider: this.database.getConfig().provider,
      workspace: project,
      approvePausedSteps: params.approvePausedSteps,
      retryFailedStepIds: params.retryFailedStepIds,
    });
  }

  private listWorkflowRuns(workflowId?: string): WorkflowRunsResult {
    return {
      runs: this.workflowManager.listRuns(workflowId),
    };
  }

  private listPlugins(): PluginListResult {
    const project = this.requireProject(this.database.getConfig().selectedProjectId);
    return {
      plugins: this.pluginManager.list(project),
    };
  }

  private listMcpMounts(): McpListResult {
    void this.mcpManager.refreshAll();
    return {
      mounts: this.mcpManager.list(),
    };
  }

  private listMcpSessions(): McpSessionsResult {
    return {
      sessions: this.mcpManager.listSessions(),
    };
  }

  private async refreshMcpMount(params: McpRefreshParams): Promise<McpToolsResult> {
    const refreshed = await this.mcpManager.refreshMount(params.mountId);
    return {
      tools: refreshed.tools,
      prompts: refreshed.prompts,
      resources: refreshed.resources,
    };
  }

  private async buildRelevantMcpContext(userInput: string) {
    const normalizedInput = userInput.toLowerCase();
    const mounts = this.mcpManager.list();
    const context = [];

    for (const mount of mounts) {
      const cached = this.mcpManager.getCachedMountData(mount.id);
      const matchingPrompts = cached.prompts.filter((prompt) => scoreMcpEntry(`${prompt.name} ${prompt.description ?? ""}`, normalizedInput) > 0).slice(0, 2);
      const matchingResources = cached.resources.filter((resource) => scoreMcpEntry(`${resource.uri} ${resource.name ?? ""} ${resource.description ?? ""}`, normalizedInput) > 0).slice(0, 2);

      const resolvedPrompts = await Promise.all(
        matchingPrompts.map(async (prompt) => ({
          name: prompt.name,
          content: await this.mcpManager.getPrompt(mount.id, prompt.name).catch(() => "Unavailable."),
        })),
      );
      const resolvedResources = await Promise.all(
        matchingResources.map(async (resource) => ({
          uri: resource.uri,
          content: await this.mcpManager.readResource(mount.id, resource.uri).catch(() => "Unavailable."),
        })),
      );

      if (cached.prompts.length === 0 && cached.resources.length === 0 && resolvedPrompts.length === 0 && resolvedResources.length === 0) {
        continue;
      }

      context.push({
        mount,
        prompts: cached.prompts,
        resources: cached.resources,
        resolvedPrompts,
        resolvedResources,
      });
    }

    return context;
  }

  private clearThreadSessionApprovals(threadId: string): void {
    this.database.clearApprovalRules(threadId);
  }

  private upsertAgentTaskResultItem(task: {
    parentThreadId: string;
    parentTurnId?: string;
    title: string;
    status: string;
    finalOutput?: string;
    id: string;
    summary?: import("@my-agent/protocol").AgentTaskSummary;
  }) {
    if (!task.parentTurnId || task.status === "running") {
      return;
    }

    const turn = this.database.getTurn(task.parentTurnId);

    if (!turn) {
      return;
    }

    const existing = this.database
      .listItems(task.parentThreadId)
      .find((item) => item.kind === "agentTask" && item.turnId === task.parentTurnId && item.metadata?.agentId === task.id);
    const now = new Date().toISOString();
    const body = task.finalOutput ?? `Agent task ${task.id} ended with status ${task.status}.`;
    const metadata = {
      agentId: task.id,
      status: task.status,
      summary: task.summary,
    };

    if (existing) {
      const updated = this.database.updateItem({
        ...existing,
        status: task.status === "completed" ? "completed" : task.status === "awaiting_approval" ? "in_progress" : "failed",
        title: `Delegated task: ${task.title}`,
        body,
        metadata,
        updatedAt: now,
      });
      this.emit({
        type: "item/completed",
        payload: { item: updated },
      });
      return;
    }

    const created = this.database.createItem({
      id: createId("item"),
      threadId: task.parentThreadId,
      turnId: task.parentTurnId,
      kind: "agentTask",
      status: task.status === "completed" ? "completed" : task.status === "awaiting_approval" ? "in_progress" : "failed",
      title: `Delegated task: ${task.title}`,
      body,
      metadata,
      createdAt: now,
      updatedAt: now,
    });
    this.emit({
      type: created.status === "in_progress" ? "item/started" : "item/completed",
      payload: { item: created },
    });
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
      runtimeRunMode: params.config.runtimeRunMode ?? current.runtimeRunMode,
    };
    next.providerCapabilities = detectProviderCapabilities(next.provider);
    next.runtimeRunMode = next.runtimeRunMode ?? next.providerCapabilities.recommendedRunMode;

    const stored = this.database.writeConfig(next);

    if (params.config.provider) {
      syncStoredProviderConfig(stored.provider);
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
        return this.resolveThreadWorkspace(this.requireProject(thread.projectId), thread);
      }
    }

    return this.requireProject(this.database.getConfig().selectedProjectId);
  }

  private resolveThreadWorkspace(project: ProjectRecord, thread: ThreadRecord): ProjectRecord {
    return {
      ...project,
      sandboxMode: thread.sandboxMode,
    };
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

function scoreMcpEntry(haystack: string, normalizedInput: string): number {
  const tokens = haystack
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  return tokens.reduce((score, token) => score + (normalizedInput.includes(token) ? 1 : 0), 0);
}
