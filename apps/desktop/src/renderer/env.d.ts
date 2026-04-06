import {
  type ApprovalResponseParams,
  type AppConfig,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type InitializeResult,
  type InterruptTurnParams,
  type ItemRecord,
  type McpMountRecord,
  type McpSessionRecord,
  type ProviderModelRecord,
  type PendingApproval,
  type PluginRecord,
  type ProjectRecord,
  type SkillDescriptor,
  type StartThreadParams,
  type StartTurnParams,
  type WorktreeRecord,
  type EnvironmentRecord,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type TurnInputAttachment,
  type ThreadRecord,
  type TurnRecord,
  type UpdateThreadParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

declare global {
  interface Window {
    myAgent: {
      initialize: () => Promise<InitializeResult>;
      createProject: (params: CreateProjectParams) => Promise<{ project: ProjectRecord }>;
      updateProject: (params: UpdateProjectParams) => Promise<{ project: ProjectRecord }>;
      updateThread: (params: UpdateThreadParams) => Promise<{ thread: ThreadRecord }>;
      startThread: (params: StartThreadParams) => Promise<{ thread: ThreadRecord }>;
      resumeThread: (threadId: string) => Promise<{ thread: ThreadRecord; turns: TurnRecord[]; items: ItemRecord[]; pendingApproval?: PendingApproval | null }>;
      startTurn: (params: StartTurnParams) => Promise<{ turn: TurnRecord }>;
      interruptTurn: (params: InterruptTurnParams) => Promise<{ turn: TurnRecord }>;
      respondApproval: (params: ApprovalResponseParams) => Promise<{ turn: TurnRecord }>;
      listSkills: () => Promise<{ skills: SkillDescriptor[] }>;
      writeSkillConfig: (disabledSkillIds: string[]) => Promise<{ skills: SkillDescriptor[] }>;
      readSkillDocument: (skillPath: string) => Promise<{ content: string }>;
      readConfig: () => Promise<{ config: AppConfig }>;
      writeConfig: (params: ConfigWriteParams) => Promise<{ config: AppConfig }>;
      testProvider: () => Promise<{ ok: boolean; status: number; message: string }>;
      listProviderModels: () => Promise<{ models: ProviderModelRecord[] }>;
      listWorktrees: (projectId?: string) => Promise<{ worktrees: WorktreeRecord[] }>;
      createWorktree: (params: { projectId: string; threadId?: string; branch?: string; baseRef?: string }) => Promise<{ worktree: WorktreeRecord }>;
      removeWorktree: (worktreeId: string) => Promise<{ worktree: WorktreeRecord }>;
      listEnvironments: (projectId?: string) => Promise<{ environments: EnvironmentRecord[] }>;
      detectEnvironment: (params: { projectId: string; threadId?: string; worktreeId?: string; cwd?: string }) => Promise<{ environment: EnvironmentRecord }>;
      listWorkflows: (projectId?: string) => Promise<{ workflows: WorkflowRecord[] }>;
      runWorkflow: (params: { workflowId: string; projectId: string; threadId?: string; nonInteractive?: boolean }) => Promise<unknown>;
      listWorkflowRuns: (workflowId?: string) => Promise<{ runs: WorkflowRunRecord[] }>;
      resumeWorkflow: (runId: string) => Promise<unknown>;
      listPlugins: () => Promise<{ plugins: PluginRecord[] }>;
      listMcpMounts: () => Promise<{ mounts: McpMountRecord[] }>;
      listMcpSessions: () => Promise<{ sessions: McpSessionRecord[] }>;
      refreshMcpMount: (mountId: string) => Promise<unknown>;
      setTitleBarTheme: (theme: "light" | "dark") => Promise<void>;
      showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) => Promise<void>;
      pickWorkspace: () => Promise<string | null>;
      pickFiles: () => Promise<TurnInputAttachment[]>;
      execCommand: (params: { command: string; cwd?: string; threadId?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
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
