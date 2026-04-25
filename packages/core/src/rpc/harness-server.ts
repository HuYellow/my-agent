import {
  type AgentCloseParams,
  type AgentSendInputParams,
  type AgentSpawnParams,
  type AgentWaitParams,
  type AutomationListParams,
  type AutomationRunArtifactRecord,
  type AutomationRunLogRecord,
  type AutomationRunLogsParams,
  type CreateAutomationParams,
  type UpdateAutomationParams,
  type RunAutomationParams,
  type AutomationRunRecord,
  type ApplyPatchParams,
  type ApprovalResponseParams,
  type ArchiveThreadParams,
  type AppConfig,
  type CommandExecParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type DiffStatRecord,
  type ForkThreadParams,
  type HarnessEvent,
  type InitializeResult,
  type ItemRecord,
  type McpRefreshParams,
  type McpListResult,
  type McpSessionsResult,
  type McpToolsResult,
  type PluginListParams,
  type PluginListResult,
  type UpdatePluginParams,
  type ProtocolCompatibilityRecord,
  type RequirementAssignThreadParams,
  type RequirementGetParams,
  type RequirementListParams,
  type CreateRequirementParams,
  type UpdateRequirementParams,
  type RequirementUnassignThreadParams,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type ProjectRecord,
  type JsonRpcResponse,
  type ProviderActionParams,
  type ProviderTestResult,
  type ProviderModelsResult,
  type ReadFileParams,
  type ReviewArtifactRecord,
  type ReviewListResult,
  type ReviewStartParams,
  type ReviewStartResult,
  type ResumeThreadParams,
  type ResumeThreadResult,
  type TemplateListResult,
  type TemplateScaffoldParams,
  type TemplateScaffoldResult,
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
  type TurnDiffFileRecord,
  type TurnDiffRecord,
  type TurnInputAttachment,
  type TurnPlanRecord,
  type TurnPlanStepRecord,
  type TurnSteerParams,
  type TurnSteerRecord,
  type TurnSteerResult,
  type TurnRecord,
  type ToolListParams,
  type InternalToolListParams,
  type ToolListResult,
  type UpdateInternalToolParams,
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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { OpenAiCompatibleRunner } from "../agents/openai-compatible-runner.js";
import { AgentTaskManager } from "../services/agent-task-manager.js";
import { detectProviderCapabilities } from "../services/provider-capabilities.js";
import { EnvironmentManager } from "../services/environment-manager.js";
import { ExecutionContextManager } from "../services/execution-context-manager.js";
import { InternalToolManager } from "../services/internal-tool-manager.js";
import { McpManager } from "../services/mcp-manager.js";
import { ensureStoredProviderConfig, syncStoredProviderConfig, watchStoredConfig } from "../services/my-agent-config.js";
import { PluginManager } from "../services/plugin-manager.js";
import { PromptBuilder } from "../services/prompt-builder.js";
import { ProviderService } from "../services/provider-service.js";
import { RequirementMemoryManager } from "../services/requirement-memory-manager.js";
import { RequirementService } from "../services/requirement-service.js";
import { ReviewManager } from "../services/review-manager.js";
import { getDefaultHomeDir, SkillService } from "../services/skill-service.js";
import { TerminalManager } from "../services/terminal-manager.js";
import { TemplateService } from "../services/template-service.js";
import { WorkflowManager } from "../services/workflow-manager.js";
import { WorktreeManager } from "../services/worktree-manager.js";
import { HarnessDatabase } from "../store/database.js";
import { ToolService } from "../tools/tool-service.js";
import { ToolRuntimeError } from "../tools/types.js";
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
  private readonly internalToolManager: InternalToolManager;
  private readonly mcpManager: McpManager;
  private readonly requirementMemoryManager: RequirementMemoryManager;
  private readonly requirementService: RequirementService;
  private readonly reviewManager: ReviewManager;
  private readonly templateService: TemplateService;

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
    this.requirementMemoryManager = new RequirementMemoryManager(this.database, (memory) =>
      this.emit({
        type: "requirement/memoryUpdated",
        payload: { memory },
      }),
    );
    this.requirementService = new RequirementService(
      this.database,
      this.requirementMemoryManager,
      (requirement) =>
        this.emit({
          type: "requirement/updated",
          payload: { requirement },
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
      this.requirementMemoryManager,
      (event) => this.emit(event),
    );
    this.templateService = new TemplateService(process.env.MY_AGENT_HOME ?? getDefaultHomeDir());
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
    this.pluginManager = new PluginManager(this.database, (plugin) => {
      this.emit({
        type: "plugin/updated",
        payload: { plugin },
      });
      this.emitToolCatalogUpdated();
    });
    this.internalToolManager = new InternalToolManager(this.database, (internalTool) => {
      this.emit({
        type: "internalTool/updated",
        payload: { internalTool },
      });
      this.emitToolCatalogUpdated();
    });
    this.mcpManager = new McpManager(
      this.database,
      (mount) => {
        this.emit({
          type: "mcp/updated",
          payload: { mount },
        });
        this.emitToolCatalogUpdated();
      },
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
          data:
            error instanceof ToolRuntimeError
              ? {
                  kind: "tool_error",
                  toolError: error.toolError,
                }
              : undefined,
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
      case "requirement/list":
        return this.listRequirements((message.params ?? {}) as RequirementListParams);
      case "requirement/get":
        return this.getRequirement(message.params as RequirementGetParams);
      case "requirement/create":
        return this.createRequirement(message.params as CreateRequirementParams);
      case "requirement/update":
        return this.updateRequirement(message.params as UpdateRequirementParams);
      case "requirement/assignThread":
        return this.assignThreadToRequirement(message.params as RequirementAssignThreadParams);
      case "requirement/unassignThread":
        return this.unassignThreadFromRequirement(message.params as RequirementUnassignThreadParams);
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
      case "automation/list":
        return this.listAutomations((message.params ?? {}) as AutomationListParams);
      case "automation/create":
        return this.createAutomation(message.params as CreateAutomationParams);
      case "automation/update":
        return this.updateAutomation(message.params as UpdateAutomationParams);
      case "automation/run":
        return this.runAutomation(message.params as RunAutomationParams);
      case "automation/runs":
        return this.listAutomationRuns(message.params as { automationId?: string; projectId?: string } | undefined);
      case "automation/logs":
        return this.listAutomationRunLogs(message.params as AutomationRunLogsParams | undefined);
      case "plugin/list":
        return this.listPlugins((message.params ?? {}) as PluginListParams);
      case "plugin/update":
        return this.updatePlugin(message.params as UpdatePluginParams);
      case "internalTool/list":
        return this.listInternalTools((message.params ?? {}) as InternalToolListParams);
      case "internalTool/update":
        return this.updateInternalTool(message.params as UpdateInternalToolParams);
      case "tool/list":
        return this.listTools((message.params ?? {}) as ToolListParams);
      case "template/list":
        return this.listTemplates();
      case "template/scaffold":
        return this.scaffoldTemplate(message.params as TemplateScaffoldParams);
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
    const config = this.syncRequirementSelection(this.syncProjectSelection(this.database.getConfig()), true);
    const skills = this.refreshSkills(config.selectedProjectId);
    const activeProject = this.resolveWorkspaceByProjectId(config.selectedProjectId);
    return {
      protocolVersion: "0.1.0",
      server: {
        name: "my-agent-core",
        version: "0.1.0",
      },
      compatibility: buildProtocolCompatibility(),
      config,
      projects: this.database.listProjects(),
      requirements: this.requirementService.list(),
      requirementMemories: this.requirementService.listMemories(),
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
      automations: this.database.listAutomations(config.selectedProjectId),
      automationRuns: this.database.listAutomationRuns({ projectId: config.selectedProjectId }),
      automationRunLogs: this.database.listAutomationRunLogs({ projectId: config.selectedProjectId }),
      agentTasks: this.database.listAgentTasks(config.selectedProjectId),
      plugins: this.pluginManager.list(activeProject),
      internalTools: this.internalToolManager.list(activeProject),
      templates: this.templateService.listTemplates(),
      tools: this.buildToolCatalog(activeProject),
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

  private listRequirements(params?: RequirementListParams) {
    return {
      requirements: this.requirementService.list(params?.projectId),
      memories: this.requirementService.listMemories(),
    };
  }

  private getRequirement(params: RequirementGetParams) {
    return this.requirementService.getWithMemory(params.requirementId);
  }

  private createRequirement(params: CreateRequirementParams) {
    const result = this.requirementService.create({
      title: params.title,
      primaryProjectId: params.primaryProjectId,
      relatedProjectIds: params.relatedProjectIds,
      status: params.status,
      memory: params.memory,
    });
    const config = this.syncProjectSelection(
      this.database.writeConfig({
        ...this.database.getConfig(),
        selectedRequirementId: result.requirement.id,
        selectedProjectId: result.requirement.primaryProjectId,
      }),
    );
    this.emit({
      type: "config/changed",
      payload: { config },
    });
    this.refreshSkills(result.requirement.primaryProjectId);
    return result;
  }

  private updateRequirement(params: UpdateRequirementParams) {
    const result = this.requirementService.update({
      requirementId: params.requirementId,
      patch: params.patch,
    });
    const current = this.database.getConfig();
    const config = this.syncRequirementSelection(
      this.syncProjectSelection({
        ...current,
        selectedRequirementId:
          current.selectedRequirementId === result.requirement.id
            ? result.requirement.id
            : current.selectedRequirementId,
        selectedProjectId:
          current.selectedRequirementId === result.requirement.id
            ? result.requirement.primaryProjectId
            : current.selectedProjectId,
      }),
    );
    this.database.writeConfig(config);
    this.emit({
      type: "config/changed",
      payload: { config },
    });
    return result;
  }

  private assignThreadToRequirement(params: RequirementAssignThreadParams) {
    const result = this.requirementService.assignThread(params.requirementId, params.threadId);
    const config = this.syncProjectSelection(
      this.database.writeConfig({
        ...this.database.getConfig(),
        selectedRequirementId: result.requirement.id,
        selectedProjectId: result.requirement.primaryProjectId,
      }),
    );
    this.emit({
      type: "config/changed",
      payload: { config },
    });
    this.refreshSkills(result.thread.projectId);
    return result;
  }

  private unassignThreadFromRequirement(params: RequirementUnassignThreadParams) {
    const previous = this.database.getThread(params.threadId);
    const result = this.requirementService.unassignThread(params.threadId);
    const current = this.database.getConfig();
    const config = this.database.writeConfig({
      ...current,
      selectedRequirementId: current.selectedRequirementId === previous?.requirementId ? undefined : current.selectedRequirementId,
      selectedProjectId: result.thread.projectId,
    });
    this.emit({
      type: "config/changed",
      payload: { config },
    });
    return result;
  }

  private startThread(params: StartThreadParams): StartThreadResult {
    const config = this.database.getConfig();
    const requirement = params.requirementId
      ? this.requireRequirement(params.requirementId)
      : config.selectedRequirementId
        ? this.requireRequirement(config.selectedRequirementId)
        : undefined;
    const project = this.requireProject(params.projectId ?? requirement?.primaryProjectId ?? config.selectedProjectId);
    const now = new Date().toISOString();
    const thread: ThreadRecord = {
      id: createId("thread"),
      title: params.title?.trim() || "New Thread",
      projectId: project.id,
      requirementId: requirement?.id,
      sandboxMode: params.sandboxMode ?? project.sandboxMode,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.database.writeConfig({
      ...config,
      selectedProjectId: project.id,
      selectedRequirementId: requirement?.id,
    });
    this.database.createThread(thread);
    if (thread.requirementId) {
      this.requirementService.rebuildMemory(thread.requirementId);
    }
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
        selectedRequirementId: thread.requirementId,
      }),
    );
    this.clearThreadSessionApprovals(thread.id);
    this.refreshSkills(thread.projectId);
    const turns = this.database.listTurns(thread.id);
    const items = this.database.listItems(thread.id);
    const pendingApproval =
      turns
        .map((turn) => this.database.getPendingApprovalForTurn(turn.id))
        .find(Boolean) ?? null;

    return {
      thread,
      turns,
      items,
      turnContexts: this.database.listTurnContextSnapshots(thread.id),
      turnPlans: buildTurnPlans(turns, items),
      turnDiffs: buildTurnDiffs(this.resolveWorkspace(thread.id), turns, items),
      pendingApproval: pendingApproval ? this.enrichPendingApproval(this.resolveWorkspace(thread.id), thread.id, pendingApproval) : null,
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
      requirementId: source.requirementId,
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
    if (thread.requirementId) {
      this.requirementService.rebuildMemory(thread.requirementId);
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
    const workspace = this.resolveThreadWorkspace(project, thread);
    const selectedSkills = this.skillService.resolveSelectedSkills(params.input, params.selectedSkillIds, discoveredSkills);
    const mcpContext = await this.buildRelevantMcpContext(params.input);
    const requirementContext = this.requirementService.buildPromptContextSection(thread.requirementId);
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
      requirementContext,
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
    const selectedRequirementId = this.database.getConfig().selectedRequirementId;
    const requirement = params.requirementId
      ? this.requireRequirement(params.requirementId)
      : thread?.requirementId
        ? this.requireRequirement(thread.requirementId)
        : selectedRequirementId
          ? this.requireRequirement(selectedRequirementId)
          : undefined;
    const projectId = params.projectId ?? thread?.projectId ?? requirement?.primaryProjectId;
    if (!projectId) {
      throw new Error("Review projectId is required when no thread or selected requirement is available.");
    }
    const project = this.requireProject(projectId);
    const review = this.reviewManager.start({
      project,
      provider: this.database.getConfig().provider,
      requirementId: requirement?.id,
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
    const requirementContext = this.requirementService.buildPromptContextSection(thread.requirementId);
    const task = this.agentTaskManager.spawn({
      provider: config.provider,
      workspace,
      project,
      requirementId: thread.requirementId,
      parentThreadId: thread.id,
      parentTurnId: params.turnId,
      title: params.title?.trim() || "Delegated task",
      input: params.input,
      inheritHistory: params.inheritHistory,
      globalInstructions: config.globalInstructions,
      runtimeRunMode: config.runtimeRunMode ?? config.providerCapabilities?.recommendedRunMode ?? "full-tools",
      requirementContext,
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
    const requirementContext = this.requirementService.buildPromptContextSection(parentThread.requirementId);
    const updated = await this.agentTaskManager.sendInput(params.agentId, params.input, {
      provider: config.provider,
      globalInstructions: config.globalInstructions,
      runtimeRunMode: config.runtimeRunMode ?? config.providerCapabilities?.recommendedRunMode ?? "full-tools",
      requirementContext,
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
    const thread = params.threadId ? this.database.getThread(params.threadId) : null;
    return {
      worktree: this.worktreeManager.create({
        project,
        requirementId: thread?.requirementId,
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
    const thread = params.threadId ? this.database.getThread(params.threadId) : null;
    return {
      environment: this.environmentManager.detect({
        project,
        requirementId: thread?.requirementId,
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
    const thread = params.threadId ? this.database.getThread(params.threadId) : null;
    const selectedRequirementId = this.database.getConfig().selectedRequirementId;
    const requirement = params.requirementId
      ? this.requireRequirement(params.requirementId)
      : thread?.requirementId
        ? this.requireRequirement(thread.requirementId)
        : selectedRequirementId
          ? this.requireRequirement(selectedRequirementId)
          : undefined;
    const projectId = params.projectId ?? thread?.projectId ?? requirement?.primaryProjectId;
    if (!projectId) {
      throw new Error("Workflow projectId is required when no thread or selected requirement is available.");
    }
    const project = this.requireProject(projectId);
    return this.workflowManager.run({
      workflowId: params.workflowId,
      project,
      provider: this.database.getConfig().provider,
      workspace: project,
      requirementId: requirement?.id,
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
      requirementId: run.requirementId,
      approvePausedSteps: params.approvePausedSteps,
      retryFailedStepIds: params.retryFailedStepIds,
    });
  }

  private listWorkflowRuns(workflowId?: string): WorkflowRunsResult {
    return {
      runs: this.workflowManager.listRuns(workflowId),
    };
  }

  private listAutomations(params?: AutomationListParams) {
    return {
      automations: this.database.listAutomations(params?.projectId),
    };
  }

  private createAutomation(params: CreateAutomationParams) {
    const project = this.requireProject(params.projectId);
    const selectedRequirementId = this.database.getConfig().selectedRequirementId;
    const requirementId = params.requirementId
      ? this.requireRequirement(params.requirementId).id
      : selectedRequirementId
        ? this.requireRequirement(selectedRequirementId).id
        : undefined;
    const now = new Date().toISOString();
    const automation = this.database.createAutomation({
      id: createId("automation"),
      name: params.name.trim() || "New automation",
      kind: params.kind,
      projectId: project.id,
      requirementId,
      workflowId: params.workflowId,
      prompt: params.prompt?.trim() || undefined,
      threadTitle: params.threadTitle?.trim() || undefined,
      scheduleType: params.scheduleType ?? "manual",
      intervalMinutes: params.scheduleType === "interval" ? params.intervalMinutes ?? 60 : undefined,
      status: params.status ?? "active",
      lastRunStatus: "idle",
      nextRunAt: computeNextAutomationRunAt(params.scheduleType ?? "manual", params.intervalMinutes),
      createdAt: now,
      updatedAt: now,
    });
    this.emit({ type: "automation/updated", payload: { automation } });
    return { automation };
  }

  private updateAutomation(params: UpdateAutomationParams) {
    const current = this.database.getAutomation(params.automationId);

    if (!current) {
      throw new Error(`Automation not found: ${params.automationId}`);
    }

    const projectId = params.patch.projectId ?? current.projectId;
    this.requireProject(projectId);
    const requirementId = params.patch.requirementId
      ? this.requireRequirement(params.patch.requirementId).id
      : params.patch.requirementId === undefined
        ? current.requirementId
        : undefined;
    const scheduleType = params.patch.scheduleType ?? current.scheduleType;
    const intervalMinutes = scheduleType === "interval" ? params.patch.intervalMinutes ?? current.intervalMinutes ?? 60 : undefined;
    const automation = this.database.updateAutomation({
      ...current,
      ...params.patch,
      projectId,
      requirementId,
      scheduleType,
      intervalMinutes,
      nextRunAt: computeNextAutomationRunAt(scheduleType, intervalMinutes, current.lastRunAt),
      updatedAt: new Date().toISOString(),
    });
    this.emit({ type: "automation/updated", payload: { automation } });
    return { automation };
  }

  private listAutomationRuns(params?: { automationId?: string; projectId?: string }) {
    return {
      runs: this.database.listAutomationRuns(params),
    };
  }

  private listAutomationRunLogs(params?: AutomationRunLogsParams) {
    return {
      logs: this.database.listAutomationRunLogs(params),
    };
  }

  private async runAutomation(params: RunAutomationParams) {
    const automation = this.database.getAutomation(params.automationId);

    if (!automation) {
      throw new Error(`Automation not found: ${params.automationId}`);
    }

    const startedAt = new Date().toISOString();
    const trigger = params.trigger ?? "manual";
    const runner = params.runner ?? "core";
    const initiatedBy = params.initiatedBy;
    const runningAutomation = this.database.updateAutomation({
      ...automation,
      lastRunStatus: "running",
      updatedAt: startedAt,
    });
    this.emit({ type: "automation/updated", payload: { automation: runningAutomation } });

    const run = this.database.createAutomationRun({
      id: createId("automation_run"),
      automationId: automation.id,
      kind: automation.kind,
      projectId: automation.projectId,
      requirementId: automation.requirementId,
      status: "running",
      trigger,
      runner,
      initiatedBy,
      artifacts: [],
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    this.emit({ type: "automation/run", payload: { run } });
    this.writeAutomationLog(run, "info", `Automation started via ${trigger}.`, initiatedBy ? `Initiated by ${initiatedBy}.` : undefined);

    try {
      const project = this.requireProject(automation.projectId);
      this.writeAutomationLog(run, "info", `Resolved project ${project.name}.`, project.rootPath);

      if (automation.kind === "workflow") {
        if (!automation.workflowId) {
          throw new Error("Workflow automation is missing workflowId.");
        }

        this.writeAutomationLog(run, "info", `Starting workflow automation.`, `workflowId=${automation.workflowId}`);

        const result = await this.workflowManager.run({
          workflowId: automation.workflowId,
          project,
          provider: this.database.getConfig().provider,
          workspace: project,
          requirementId: automation.requirementId,
          nonInteractive: true,
        });
        const completedAt = new Date().toISOString();
        const artifacts: AutomationRunArtifactRecord[] = [
          {
            kind: "workflow_run",
            id: result.run.id,
            label: `Workflow run ${result.run.id}`,
            summary: `Workflow finished with ${result.run.status}.`,
            metadata: {
              workflowId: result.workflow.id,
              workflowName: result.workflow.name,
            },
          },
          ...result.stepsRun
            .filter((step) => step.artifactSummary)
            .slice(0, 6)
            .map((step) => ({
              kind: "report" as const,
              label: step.stepId,
              summary: step.artifactSummary,
            })),
        ];
        const output = buildWorkflowAutomationOutput(automation.name, result.run.id, result.stepsRun);

        const completedRun = this.database.updateAutomationRun({
          ...run,
          status: "completed",
          workflowRunId: result.run.id,
          summary: result.stepsRun.map((step) => step.artifactSummary).filter(Boolean).join(" | ") || `${result.run.status}`,
          output,
          artifacts,
          updatedAt: completedAt,
          completedAt,
        });
        const completedAutomation = this.database.updateAutomation({
          ...runningAutomation,
          lastRunAt: completedRun.completedAt,
          lastRunStatus: "completed",
          nextRunAt: computeNextAutomationRunAt(runningAutomation.scheduleType, runningAutomation.intervalMinutes, completedRun.completedAt),
          updatedAt: completedAt,
        });
        this.writeAutomationLog(completedRun, "info", `Workflow automation completed.`, output);
        this.emit({ type: "automation/run", payload: { run: completedRun } });
        this.emit({ type: "automation/updated", payload: { automation: completedAutomation } });
        return {
          automation: completedAutomation,
          run: completedRun,
        };
      }

      if (!automation.prompt?.trim()) {
        throw new Error("Prompt automation is missing prompt text.");
      }

      this.writeAutomationLog(run, "info", "Starting prompt automation thread.", automation.threadTitle?.trim() || automation.name);

      const threadResult = this.startThread({
        projectId: automation.projectId,
        requirementId: automation.requirementId,
        title: automation.threadTitle?.trim() || `Automation: ${automation.name}`,
      });
      const turnResult = await this.startTurn({
        threadId: threadResult.thread.id,
        input: automation.prompt,
        includeIdeContext: false,
      });
      const finalTurn = this.database.getTurn(turnResult.turn.id) ?? turnResult.turn;
      const threadItems = this.database
        .listItems(threadResult.thread.id)
        .filter((item) => item.turnId === finalTurn.id && item.kind === "agentMessage" && item.status === "completed");
      const finalMessage = threadItems.at(-1)?.body?.trim();
      const completedAt = new Date().toISOString();
      const output = buildPromptAutomationOutput({
        automationName: automation.name,
        threadId: threadResult.thread.id,
        turnId: finalTurn.id,
        turnStatus: finalTurn.status,
        finalMessage,
      });
      const artifacts: AutomationRunArtifactRecord[] = [
        {
          kind: "thread",
          id: threadResult.thread.id,
          label: `Thread ${threadResult.thread.id}`,
          summary: automation.threadTitle?.trim() || `Automation: ${automation.name}`,
        },
        {
          kind: "turn",
          id: finalTurn.id,
          label: `Turn ${finalTurn.id}`,
          summary: `Turn finished with ${finalTurn.status}.`,
        },
        {
          kind: "report",
          label: "Final response",
          summary: finalMessage ? truncateForSummary(finalMessage, 220) : `Prompt run finished with ${finalTurn.status}.`,
        },
      ];
      const completedRun = this.database.updateAutomationRun({
        ...run,
        status: finalTurn.status === "completed" ? "completed" : "failed",
        threadId: threadResult.thread.id,
        turnId: finalTurn.id,
        summary: finalMessage ? truncateForSummary(finalMessage, 140) : `Prompt run finished with ${finalTurn.status}.`,
        output,
        artifacts,
        error: finalTurn.status === "failed" ? "Prompt automation turn failed." : undefined,
        updatedAt: completedAt,
        completedAt,
      });
      const completedAutomation = this.database.updateAutomation({
        ...runningAutomation,
        lastRunAt: completedRun.completedAt,
        lastRunStatus: completedRun.status,
        nextRunAt: computeNextAutomationRunAt(runningAutomation.scheduleType, runningAutomation.intervalMinutes, completedRun.completedAt),
        updatedAt: completedAt,
      });
      this.writeAutomationLog(completedRun, completedRun.status === "completed" ? "info" : "warning", "Prompt automation finished.", output);
      this.emit({ type: "automation/run", payload: { run: completedRun } });
      this.emit({ type: "automation/updated", payload: { automation: completedAutomation } });
      return {
        automation: completedAutomation,
        run: completedRun,
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failedRun: AutomationRunRecord = this.database.updateAutomationRun({
        ...run,
        status: "failed",
        artifacts: run.artifacts,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: failedAt,
        completedAt: failedAt,
      });
      const failedAutomation = this.database.updateAutomation({
        ...runningAutomation,
        lastRunAt: failedAt,
        lastRunStatus: "failed",
        nextRunAt: computeNextAutomationRunAt(runningAutomation.scheduleType, runningAutomation.intervalMinutes, failedAt),
        updatedAt: failedAt,
      });
      this.writeAutomationLog(failedRun, "error", "Automation failed.", error instanceof Error ? error.stack ?? error.message : String(error));
      this.emit({ type: "automation/run", payload: { run: failedRun } });
      this.emit({ type: "automation/updated", payload: { automation: failedAutomation } });
      throw error;
    }
  }

  private listPlugins(params?: PluginListParams): PluginListResult {
    const project = this.requireProject(params?.projectId ?? this.database.getConfig().selectedProjectId);
    return {
      plugins: this.pluginManager.list(project),
    };
  }

  private updatePlugin(params: UpdatePluginParams) {
    const plugin = this.pluginManager.update(params.pluginId, params.patch);
    return { plugin };
  }

  private listInternalTools(params?: InternalToolListParams) {
    const project = this.requireProject(params?.projectId ?? this.database.getConfig().selectedProjectId);
    return {
      internalTools: this.internalToolManager.list(project),
    };
  }

  private updateInternalTool(params: UpdateInternalToolParams) {
    const internalTool = this.internalToolManager.update(params.internalToolId, params.patch);
    return { internalTool };
  }

  private listTools(params?: ToolListParams): ToolListResult {
    const workspace = params?.threadId ? this.resolveWorkspace(params.threadId) : this.requireProject(params?.projectId ?? this.database.getConfig().selectedProjectId);
    return {
      tools: this.buildToolCatalog(workspace),
    };
  }

  private listTemplates(): TemplateListResult {
    return {
      templates: this.templateService.listTemplates(),
    };
  }

  private scaffoldTemplate(params: TemplateScaffoldParams): TemplateScaffoldResult {
    const project = params.projectId ? this.requireProject(params.projectId) : undefined;

    return this.templateService.scaffold({
      templateId: params.templateId,
      target: params.target,
      projectRoot: project?.rootPath,
      name: params.name,
      directoryName: params.directoryName,
    });
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

    if (Object.prototype.hasOwnProperty.call(params.config, "selectedRequirementId")) {
      next.selectedRequirementId = params.config.selectedRequirementId;

      if (next.selectedRequirementId) {
        const requirement = this.database.getRequirement(next.selectedRequirementId);
        if (!requirement) {
          throw new Error(`Requirement not found: ${next.selectedRequirementId}`);
        }
        next.selectedProjectId = requirement.primaryProjectId;
      }
    }

    const stored = this.database.writeConfig(next);

    if (params.config.provider) {
      syncStoredProviderConfig(stored.provider);
    }

    const synced = this.syncProjectSelection(stored);
    const syncedRequirement = this.syncRequirementSelection(synced);
    this.emit({
      type: "config/changed",
      payload: {
        config: syncedRequirement,
      },
    });
    this.emitToolCatalogUpdated(syncedRequirement.selectedProjectId);
    this.refreshSkills(syncedRequirement.selectedProjectId);
    return { config: syncedRequirement };
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

  private requireRequirement(requirementId: string) {
    const requirement = this.database.getRequirement(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    return requirement;
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

  private syncRequirementSelection(config: AppConfig, preferFirstRequirement = false): AppConfig {
    if (config.selectedRequirementId) {
      const requirement = this.database.getRequirement(config.selectedRequirementId);

      if (requirement) {
        if (config.selectedProjectId === requirement.primaryProjectId) {
          return config;
        }

        return this.database.writeConfig({
          ...config,
          selectedProjectId: requirement.primaryProjectId,
        });
      }
    }

    if (!preferFirstRequirement) {
      return config;
    }

    const firstRequirement = this.database.listRequirements()[0];

    if (!firstRequirement) {
      if (!config.selectedRequirementId) {
        return config;
      }

      return this.database.writeConfig({
        ...config,
        selectedRequirementId: undefined,
      });
    }

    return this.database.writeConfig({
      ...config,
      selectedRequirementId: firstRequirement.id,
      selectedProjectId: firstRequirement.primaryProjectId,
    });
  }

  private emit(event: HarnessEvent): void {
    this.refreshRequirementMemoryFromEvent(event);
    this.emitRaw({
      jsonrpc: "2.0",
      method: event.type,
      params: event.payload,
    });
    this.emitStructuredThreadArtifacts(event);
  }

  private refreshRequirementMemoryFromEvent(event: HarnessEvent): void {
    try {
      if (event.type === "turn/completed" || event.type === "turn/cancelled" || event.type === "turn/failed") {
        const thread = this.database.getThread(event.payload.turn.threadId);
        if (thread?.requirementId) {
          this.requirementService.rebuildMemory(thread.requirementId);
        }
        return;
      }

      if (event.type === "review/result" && event.payload.review.requirementId) {
        this.requirementService.rebuildMemory(event.payload.review.requirementId);
        return;
      }

      if (event.type === "workflow/run" && event.payload.run.requirementId && event.payload.run.status !== "running") {
        this.requirementService.rebuildMemory(event.payload.run.requirementId);
      }
    } catch {
      // best effort refresh; failing to rebuild memory should not block the primary event
    }
  }

  private emitStructuredThreadArtifacts(event: HarnessEvent): void {
    if (event.type === "item/completed") {
      const item = event.payload.item;

      if (item.kind === "agentMessage") {
        const turns = this.database.listTurns(item.threadId);
        const plans = buildTurnPlans(turns, this.database.listItems(item.threadId));
        const latest = plans.find((plan) => plan.turnId === item.turnId);

        if (latest) {
          this.emit({
            type: "turn/planUpdated",
            payload: { plan: latest },
          });
        }
      }

      if (item.kind === "fileChange") {
        const turns = this.database.listTurns(item.threadId);
        const diffs = buildTurnDiffs(this.resolveWorkspace(item.threadId), turns, this.database.listItems(item.threadId));
        const latest = diffs.find((diff) => diff.turnId === item.turnId);

        if (latest) {
          this.emit({
            type: "turn/diffUpdated",
            payload: { diff: latest },
          });
        }
      }
    }
  }

  private enrichPendingApproval(workspace: ProjectRecord, threadId: string, approval: import("@my-agent/protocol").PendingApproval) {
    if (approval.tool) {
      return approval;
    }

    try {
      const toolService = new ToolService(workspace, {
        database: this.database,
        threadId,
        mcpManager: this.mcpManager,
      });
      const plan = toolService.planExecution(approval.toolName, approval.args);
      return {
        ...approval,
        tool: plan.tool,
      };
    } catch {
      return approval;
    }
  }

  private buildToolCatalog(workspace: ProjectRecord) {
    const toolService = new ToolService(workspace, {
      database: this.database,
      mcpManager: this.mcpManager,
    });
    return toolService.getCatalog();
  }

  private emitToolCatalogUpdated(projectId?: string): void {
    const workspace = this.resolveWorkspaceByProjectId(projectId ?? this.database.getConfig().selectedProjectId);
    this.emit({
      type: "tools/catalogUpdated",
      payload: {
        tools: this.buildToolCatalog(workspace),
      },
    });
  }

  private writeAutomationLog(
    run: Pick<AutomationRunRecord, "id" | "automationId" | "projectId">,
    level: AutomationRunLogRecord["level"],
    message: string,
    detail?: string,
  ): AutomationRunLogRecord {
    const log = this.database.createAutomationRunLog({
      id: createId("automation_log"),
      runId: run.id,
      automationId: run.automationId,
      projectId: run.projectId,
      level,
      message,
      detail,
      createdAt: new Date().toISOString(),
    });
    this.emit({
      type: "automation/log",
      payload: { log },
    });
    return log;
  }
}

function buildTurnPlans(turns: TurnRecord[], items: ItemRecord[]): TurnPlanRecord[] {
  const planTurns = turns.filter((turn) => turn.input.includes("[Plan mode]"));
  const itemsByTurn = new Map<string, ItemRecord[]>();

  for (const item of items) {
    const current = itemsByTurn.get(item.turnId) ?? [];
    current.push(item);
    itemsByTurn.set(item.turnId, current);
  }

  const plans: TurnPlanRecord[] = [];

  for (const turn of planTurns) {
      const messageItem = (itemsByTurn.get(turn.id) ?? []).find((item) => item.kind === "agentMessage" && item.status === "completed");

      if (!messageItem) {
        continue;
      }

      const parsed = parsePlanText(messageItem.body);

      if (!parsed) {
        continue;
      }

      plans.push({
        turnId: turn.id,
        threadId: turn.threadId,
        sourceItemId: messageItem.id,
        title: parsed.title,
        summary: parsed.summary,
        steps: parsed.steps,
        createdAt: messageItem.createdAt,
        updatedAt: messageItem.updatedAt,
      });
  }

  return plans.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function parsePlanText(body: string): { title: string; summary?: string; steps: TurnPlanStepRecord[] } | null {
  const lines = body.split(/\r?\n/);
  const stepRegex = /^\s*(?:[-*+]\s+|\d+[.)]\s+|\[( |x)\]\s+)(.+?)\s*$/i;
  const steps: TurnPlanStepRecord[] = [];
  let firstStepLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(stepRegex);

    if (!match) {
      continue;
    }

    if (firstStepLine === -1) {
      firstStepLine = index;
    }

    const status =
      /^\s*\[(x|X)\]/.test(line) ? "completed" : /\bin progress\b/i.test(match[2] ?? "") ? "in_progress" : "pending";
    steps.push({
      id: `step_${steps.length + 1}`,
      title: match[2]!.trim(),
      status,
    });
  }

  if (steps.length < 2) {
    return null;
  }

  const summary = lines
    .slice(0, firstStepLine === -1 ? 0 : firstStepLine)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    title: summary || "Execution plan",
    summary: summary || undefined,
    steps: steps.slice(0, 12),
  };
}

function buildTurnDiffs(workspace: ProjectRecord, turns: TurnRecord[], items: ItemRecord[]): TurnDiffRecord[] {
  const fileChangeItems = items.filter((item) => item.kind === "fileChange");

  if (fileChangeItems.length === 0) {
    return [];
  }

  const turnIndex = new Map(turns.map((turn, index) => [turn.id, { turn, index }]));
  const uniquePaths = [...new Set(fileChangeItems.map(getChangedFilePath).filter((value): value is string => Boolean(value)))];
  const gitSnapshot = collectGitDiffSnapshot(workspace.rootPath, uniquePaths);
  const grouped = new Map<string, TurnDiffRecord>();

  for (const item of fileChangeItems) {
    const path = getChangedFilePath(item);

    if (!path) {
      continue;
    }

    const turnEntry = turnIndex.get(item.turnId);
    const key = item.turnId || item.id;
    const current = grouped.get(key) ?? {
      id: key,
      turnId: item.turnId,
      threadId: item.threadId,
      label: formatTurnDiffLabel(turnEntry?.turn, turnEntry ? turnEntry.index + 1 : grouped.size + 1),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      stats: {
        fileCount: 0,
        additions: 0,
        deletions: 0,
      },
      files: [],
    };
    const snapshot = gitSnapshot.get(path);
    const nextFile: TurnDiffFileRecord = {
      itemId: item.id,
      turnId: item.turnId,
      path,
      title: item.title,
      status: snapshot?.status ?? "unknown",
      additions: snapshot?.additions,
      deletions: snapshot?.deletions,
      patch: snapshot?.patch,
      updatedAt: item.updatedAt,
    };
    const existingIndex = current.files.findIndex((file) => file.path === path);

    if (existingIndex >= 0) {
      current.files[existingIndex] = nextFile;
    } else {
      current.files.push(nextFile);
    }

    current.createdAt = current.createdAt < item.createdAt ? current.createdAt : item.createdAt;
    current.updatedAt = current.updatedAt > item.updatedAt ? current.updatedAt : item.updatedAt;
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((record) => {
      const stats = record.files.reduce<DiffStatRecord>(
        (current, file) => ({
          fileCount: record.files.length,
          additions: current.additions + (file.additions ?? 0),
          deletions: current.deletions + (file.deletions ?? 0),
        }),
        {
          fileCount: record.files.length,
          additions: 0,
          deletions: 0,
        },
      );

      return {
        ...record,
        stats,
        files: [...record.files].sort((left, right) => left.path.localeCompare(right.path)),
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function collectGitDiffSnapshot(rootPath: string, paths: string[]): Map<string, { additions?: number; deletions?: number; patch?: string; status: TurnDiffFileRecord["status"] }> {
  const snapshots = new Map<string, { additions?: number; deletions?: number; patch?: string; status: TurnDiffFileRecord["status"] }>();

  if (paths.length === 0 || !isGitWorkspace(rootPath)) {
    return snapshots;
  }

  const numstat = runGitMaybe(rootPath, ["diff", "--numstat", "--no-ext-diff", "--", ...paths]);
  const stats = parseNumstatOutput(numstat ?? "");

  for (const path of paths) {
    const patch = stripUnifiedDiffPreamble(runGitMaybe(rootPath, ["diff", "--no-ext-diff", "--unified=3", "--", path]) ?? "");
    snapshots.set(path, {
      additions: stats[path]?.additions,
      deletions: stats[path]?.deletions,
      patch: patch || undefined,
      status: inferDiffFileStatus(patch),
    });
  }

  return snapshots;
}

function isGitWorkspace(rootPath: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: rootPath,
    encoding: "utf8",
    windowsHide: true,
  });

  return result.status === 0 && String(result.stdout ?? "").trim() === "true";
}

function runGitMaybe(rootPath: string, args: string[]): string | null {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: rootPath,
    encoding: "utf8",
    windowsHide: true,
  });

  return result.status === 0 ? String(result.stdout ?? "") : null;
}

function parseNumstatOutput(output: string): Record<string, { additions?: number; deletions?: number }> {
  const summary: Record<string, { additions?: number; deletions?: number }> = {};

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const [additions, deletions, ...rest] = rawLine.split("\t");
    const path = rest.join("\t").trim();

    if (!path) {
      continue;
    }

    summary[path] = {
      additions: parseNumstatValue(additions),
      deletions: parseNumstatValue(deletions),
    };
  }

  return summary;
}

function parseNumstatValue(value: string | undefined): number | undefined {
  if (!value || value === "-") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferDiffFileStatus(patch: string | undefined): TurnDiffFileRecord["status"] {
  if (!patch?.trim()) {
    return "unknown";
  }

  if (patch.includes("new file mode")) {
    return "added";
  }

  if (patch.includes("deleted file mode")) {
    return "deleted";
  }

  if (patch.includes("rename from ") || patch.includes("rename to ")) {
    return "renamed";
  }

  return "modified";
}

function stripUnifiedDiffPreamble(diff: string): string {
  return diff
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("diff --git ") && !line.startsWith("index "))
    .join("\n")
    .trim();
}

function getChangedFilePath(item: ItemRecord): string | null {
  const metadataPath = typeof item.metadata?.path === "string" ? item.metadata.path : null;

  if (metadataPath) {
    return metadataPath;
  }

  const match = item.title.match(/^File change:\s+(.+)$/);
  return match?.[1] ?? null;
}

function formatTurnDiffLabel(turn?: TurnRecord, ordinal?: number) {
  const input = turn?.input?.trim() ?? "";
  const firstLine = input.split(/\r?\n/)[0]?.trim() ?? "";
  const snippet = firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;

  if (snippet) {
    return snippet;
  }

  return `Turn ${ordinal ?? 1}`;
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

function computeNextAutomationRunAt(
  scheduleType: "manual" | "interval",
  intervalMinutes?: number,
  baseTime?: string,
): string | undefined {
  if (scheduleType !== "interval") {
    return undefined;
  }

  const minutes = Math.max(1, intervalMinutes ?? 60);
  const base = baseTime ? new Date(baseTime).getTime() : Date.now();
  return new Date(base + minutes * 60_000).toISOString();
}

function buildWorkflowAutomationOutput(
  automationName: string,
  workflowRunId: string,
  steps: Array<{ stepId: string; status: string; artifactSummary?: string; output?: string }>,
): string {
  const lines = [
    `Automation: ${automationName}`,
    `Workflow run: ${workflowRunId}`,
    "",
    "Steps:",
    ...steps.map((step) => `- ${step.stepId}: ${step.status}${step.artifactSummary ? ` | ${step.artifactSummary}` : ""}`),
  ];

  const noteworthyOutputs = steps
    .map((step) => step.output?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);

  if (noteworthyOutputs.length > 0) {
    lines.push("", "Output excerpts:", ...noteworthyOutputs.map((value) => truncateForSummary(value, 320)));
  }

  return lines.join("\n");
}

function buildPromptAutomationOutput(params: {
  automationName: string;
  threadId: string;
  turnId: string;
  turnStatus: string;
  finalMessage?: string;
}): string {
  const lines = [
    `Automation: ${params.automationName}`,
    `Thread: ${params.threadId}`,
    `Turn: ${params.turnId}`,
    `Status: ${params.turnStatus}`,
  ];

  if (params.finalMessage) {
    lines.push("", "Final message:", params.finalMessage.trim());
  }

  return lines.join("\n");
}

function truncateForSummary(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function buildProtocolCompatibility(): ProtocolCompatibilityRecord {
  return {
    protocolVersion: "0.1.0",
    additiveChangesOnly: true,
    requiredToolSources: ["local", "plugin", "mcp", "internal"],
    structuredEventTypes: ["turn/planUpdated", "turn/diffUpdated", "review/started", "review/status", "review/result", "tools/catalogUpdated"],
    guarantees: [
      "New protocol fields and event payload fields are additive within the same protocolVersion.",
      "Tool source kinds are stable across local, plugin, mcp, and internal tools.",
      "Structured tool errors use ToolErrorRecord and are attached through RPC error.data when available.",
      "Structured plan, diff, and review events are first-class and should not require parsing item bodies.",
      "Template descriptors and catalog-scoped extension roots are additive distribution metadata.",
    ],
    documentationPath: "docs/protocol-compatibility.md",
  };
}
