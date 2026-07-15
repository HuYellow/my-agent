import {
  type ApprovalResponseParams,
  type AgentTaskRecord,
  type AppConfig,
  type AutomationRecord,
  type AutomationRunLogRecord,
  type AutomationRunRecord,
  type AutomationRunLogsParams,
  type ConfigWriteParams,
  type CreateAutomationParams,
  type CreateProjectParams,
  type CreateRequirementParams,
  type DistributionTemplateRecord,
  type ExecutionContextRecord,
  type HarnessEvent,
  type InitializeResult,
  type InternalToolRecord,
  type InterruptTurnParams,
  type ItemRecord,
  type McpMountRecord,
  type McpSessionRecord,
  type ProviderModelRecord,
  type PendingApproval,
  type PluginInstallParams,
  type PluginRecord,
  type PluginListParams,
  type ProviderActionParams,
  type ProjectRecord,
  type RequirementMemoryRecord,
  type RequirementRecord,
  type ReviewRecord,
  type ReviewStartParams,
  type SkillDescriptor,
  type StartThreadParams,
  type StartTurnParams,
  type TerminalArchiveParams,
  type TerminalApprovalResponseParams,
  type TerminalClearBufferParams,
  type TerminalCloseParams,
  type TerminalCreateParams,
  type TerminalReadParams,
  type TerminalResizeParams,
  type TerminalSessionRecord,
  type TerminalWriteParams,
  type ToolCatalogRecord,
  type ToolListParams,
  type WorktreeRecord,
  type EnvironmentRecord,
  type EventListSinceParams,
  type RuntimeEventRecord,
  type RuntimeRunRecord,
  type RuntimeSnapshotResult,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type TurnContextSnapshotRecord,
  type TurnDiffRecord,
  type TurnInputAttachment,
  type TurnPlanRecord,
  type ThreadRecord,
  type TurnSteerParams,
  type TurnSteerRecord,
  type UpdateAutomationParams,
  type UpdateInternalToolParams,
  type UpdatePluginParams,
  type TurnRecord,
  type UpdateRequirementParams,
  type UpdateThreadParams,
  type UpdateProjectParams,
  type TemplateScaffoldParams,
} from "@my-agent/protocol";

declare global {
  interface Window {
    myAgent: {
      initialize: () => Promise<InitializeResult>;
      createProject: (params: CreateProjectParams) => Promise<{ project: ProjectRecord }>;
      updateProject: (params: UpdateProjectParams) => Promise<{ project: ProjectRecord }>;
      listAutomations: (params?: { projectId?: string }) => Promise<{ automations: AutomationRecord[] }>;
      createAutomation: (params: CreateAutomationParams) => Promise<{ automation: AutomationRecord }>;
      updateAutomation: (params: UpdateAutomationParams) => Promise<{ automation: AutomationRecord }>;
      runAutomation: (params: { automationId: string }) => Promise<{ automation: AutomationRecord; run: AutomationRunRecord }>;
      listAutomationRuns: (params?: { automationId?: string; projectId?: string }) => Promise<{ runs: AutomationRunRecord[] }>;
      listAutomationRunLogs: (params?: AutomationRunLogsParams) => Promise<{ logs: AutomationRunLogRecord[] }>;
      listRequirements: (params?: { projectId?: string }) => Promise<{ requirements: RequirementRecord[]; memories: RequirementMemoryRecord[] }>;
      getRequirement: (requirementId: string) => Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord }>;
      createRequirement: (params: CreateRequirementParams) => Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord }>;
      updateRequirement: (params: UpdateRequirementParams) => Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord }>;
      assignThreadToRequirement: (params: { requirementId: string; threadId: string }) => Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord; thread: ThreadRecord }>;
      unassignThreadFromRequirement: (params: { threadId: string }) => Promise<{
        thread: ThreadRecord;
        requirementId?: string;
        memory?: RequirementMemoryRecord;
      }>;
      updateThread: (params: UpdateThreadParams) => Promise<{ thread: ThreadRecord }>;
      startThread: (params: StartThreadParams) => Promise<{ thread: ThreadRecord }>;
      resumeThread: (threadId: string) => Promise<{
        thread: ThreadRecord;
        turns: TurnRecord[];
        items: ItemRecord[];
        turnContexts?: TurnContextSnapshotRecord[];
        turnPlans?: TurnPlanRecord[];
        turnDiffs?: TurnDiffRecord[];
        pendingApproval?: PendingApproval | null;
      }>;
      startTurn: (params: StartTurnParams) => Promise<{ turn: TurnRecord }>;
      steerTurn: (params: TurnSteerParams) => Promise<{ steer: TurnSteerRecord }>;
      interruptTurn: (params: InterruptTurnParams) => Promise<{ turn: TurnRecord }>;
      runtimeSnapshot: () => Promise<RuntimeSnapshotResult>;
      listEventsSince: (params?: EventListSinceParams) => Promise<{
        events: RuntimeEventRecord[];
        cursor: { sequence: number };
        hasMore: boolean;
      }>;
      listRuns: (params?: { projectId?: string; threadId?: string; status?: RuntimeRunRecord["status"][] }) => Promise<{ runs: RuntimeRunRecord[] }>;
      getRun: (runId: string) => Promise<{ run: RuntimeRunRecord }>;
      retryRun: (runId: string) => Promise<{ run: RuntimeRunRecord }>;
      startReview: (params: ReviewStartParams) => Promise<{ review: ReviewRecord }>;
      listReviews: (params?: { projectId?: string; threadId?: string }) => Promise<{ reviews: ReviewRecord[] }>;
      createTerminal: (params: TerminalCreateParams) => Promise<{ session: TerminalSessionRecord }>;
      writeTerminal: (params: TerminalWriteParams) => Promise<{ session: TerminalSessionRecord }>;
      readTerminal: (params: TerminalReadParams) => Promise<{ session: TerminalSessionRecord; output: string }>;
      archiveTerminal: (params: TerminalArchiveParams) => Promise<{ session: TerminalSessionRecord }>;
      clearTerminal: (params: TerminalClearBufferParams) => Promise<{ session: TerminalSessionRecord }>;
      resizeTerminal: (params: TerminalResizeParams) => Promise<{ session: TerminalSessionRecord }>;
      closeTerminal: (params: TerminalCloseParams) => Promise<{ session: TerminalSessionRecord }>;
      respondTerminalApproval: (params: TerminalApprovalResponseParams) => Promise<{ session: TerminalSessionRecord }>;
      respondApproval: (params: ApprovalResponseParams) => Promise<{ turn: TurnRecord }>;
      listSkills: () => Promise<{ skills: SkillDescriptor[] }>;
      writeSkillConfig: (disabledSkillIds: string[]) => Promise<{ skills: SkillDescriptor[] }>;
      readSkillDocument: (skillPath: string) => Promise<{ content: string }>;
      readConfig: () => Promise<{ config: AppConfig }>;
      writeConfig: (params: ConfigWriteParams) => Promise<{ config: AppConfig }>;
      testProvider: (params?: ProviderActionParams) => Promise<{ ok: boolean; status: number; message: string }>;
      listProviderModels: (params?: ProviderActionParams) => Promise<{ models: ProviderModelRecord[] }>;
      listWorktrees: (projectId?: string) => Promise<{ worktrees: WorktreeRecord[] }>;
      createWorktree: (params: { projectId: string; threadId?: string; branch?: string; baseRef?: string }) => Promise<{ worktree: WorktreeRecord }>;
      removeWorktree: (worktreeId: string) => Promise<{ worktree: WorktreeRecord }>;
      listEnvironments: (projectId?: string) => Promise<{ environments: EnvironmentRecord[] }>;
      detectEnvironment: (params: { projectId: string; threadId?: string; worktreeId?: string; cwd?: string }) => Promise<{ environment: EnvironmentRecord }>;
      listExecutionContexts: (projectId?: string) => Promise<{ executionContexts: ExecutionContextRecord[] }>;
      listWorkflows: (projectId?: string) => Promise<{ workflows: WorkflowRecord[] }>;
      runWorkflow: (params: {
        workflowId: string;
        projectId: string;
        requirementId?: string;
        threadId?: string;
        nonInteractive?: boolean;
      }) => Promise<unknown>;
      listWorkflowRuns: (workflowId?: string) => Promise<{ runs: WorkflowRunRecord[] }>;
      resumeWorkflow: (params: { runId: string; approvePausedSteps?: boolean; retryFailedStepIds?: string[] }) => Promise<unknown>;
      listAgentTasks: (projectId?: string) => Promise<{ tasks: AgentTaskRecord[] }>;
      listTools: (params?: ToolListParams) => Promise<{ tools: ToolCatalogRecord[] }>;
      listTemplates: () => Promise<{ templates: DistributionTemplateRecord[] }>;
      scaffoldTemplate: (params: TemplateScaffoldParams) => Promise<{
        template: DistributionTemplateRecord;
        rootPath: string;
        createdPaths: string[];
      }>;
      listPlugins: (params?: PluginListParams) => Promise<{ plugins: PluginRecord[] }>;
      installPlugin: (params: PluginInstallParams) => Promise<{ plugins: PluginRecord[] }>;
      updatePlugin: (params: UpdatePluginParams) => Promise<{ plugin: PluginRecord }>;
      listInternalTools: (params?: { projectId?: string }) => Promise<{ internalTools: InternalToolRecord[] }>;
      updateInternalTool: (params: UpdateInternalToolParams) => Promise<{ internalTool: InternalToolRecord }>;
      listMcpMounts: () => Promise<{ mounts: McpMountRecord[] }>;
      listMcpSessions: () => Promise<{ sessions: McpSessionRecord[] }>;
      refreshMcpMount: (mountId: string) => Promise<unknown>;
      setTitleBarTheme: (theme: "light" | "dark") => Promise<void>;
      showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) => Promise<void>;
      pickWorkspace: () => Promise<string | null>;
      pickFiles: () => Promise<TurnInputAttachment[]>;
      execCommand: (params: { command: string; cwd?: string; threadId?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
      getGitSummary: (params: { projectId?: string; threadId?: string }) => Promise<{
        isGitRepo: boolean;
        currentBranch: string | null;
        branches: string[];
      }>;
      revealSkillPath: (skillPath: string) => Promise<{ ok: boolean; error?: string }>;
      revealProjectPath: (projectPath: string) => Promise<{ ok: boolean; error?: string }>;
      windowMinimize: () => Promise<void>;
      windowToggleFullscreen: () => Promise<void>;
      windowClose: () => Promise<void>;
      onEvent: (listener: (event: HarnessEvent) => void) => () => void;
    };
  }
}

export {};
