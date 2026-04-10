import { contextBridge, ipcRenderer } from "electron";
import {
  type ApprovalResponseParams,
  type AgentTaskRecord,
  type AutomationRecord,
  type AutomationRunRecord,
  type CommandExecParams,
  type ConfigWriteParams,
  type CreateAutomationParams,
  type CreateProjectParams,
  type CreateRequirementParams,
  type ExecutionContextRecord,
  type HarnessEvent,
  type InternalToolRecord,
  type InterruptTurnParams,
  type ProviderActionParams,
  type ReviewRecord,
  type ReviewStartParams,
  type ProviderModelRecord,
  type RequirementMemoryRecord,
  type RequirementRecord,
  type TerminalArchiveParams,
  type TerminalApprovalResponseParams,
  type TerminalClearBufferParams,
  type TerminalCloseParams,
  type TerminalCreateParams,
  type TerminalReadParams,
  type TerminalResizeParams,
  type TerminalSessionRecord,
  type TerminalWriteParams,
  type WorktreeRecord,
  type EnvironmentRecord,
  type WorkflowRecord,
  type PluginRecord,
  type McpMountRecord,
  type McpSessionRecord,
  type WorkflowRunRecord,
  type PluginListParams,
  type ToolCatalogRecord,
  type ToolListParams,
  type ProtocolCompatibilityRecord,
  type StartThreadParams,
  type StartTurnParams,
  type TurnInputAttachment,
  type TurnSteerParams,
  type TurnSteerRecord,
  type UpdateAutomationParams,
  type UpdateInternalToolParams,
  type UpdatePluginParams,
  type UpdateRequirementParams,
  type UpdateThreadParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

const api = {
  initialize: () => ipcRenderer.invoke("harness:initialize"),
  createProject: (params: CreateProjectParams) => ipcRenderer.invoke("project:create", params),
  updateProject: (params: UpdateProjectParams) => ipcRenderer.invoke("project:update", params),
  listAutomations: (params?: { projectId?: string }) =>
    ipcRenderer.invoke("automation:list", params ?? {}) as Promise<{ automations: AutomationRecord[] }>,
  createAutomation: (params: CreateAutomationParams) =>
    ipcRenderer.invoke("automation:create", params) as Promise<{ automation: AutomationRecord }>,
  updateAutomation: (params: UpdateAutomationParams) =>
    ipcRenderer.invoke("automation:update", params) as Promise<{ automation: AutomationRecord }>,
  runAutomation: (params: { automationId: string }) =>
    ipcRenderer.invoke("automation:run", params) as Promise<{ automation: AutomationRecord; run: AutomationRunRecord }>,
  listAutomationRuns: (params?: { automationId?: string; projectId?: string }) =>
    ipcRenderer.invoke("automation:runs", params ?? {}) as Promise<{ runs: AutomationRunRecord[] }>,
  listRequirements: (params?: { projectId?: string }) =>
    ipcRenderer.invoke("requirement:list", params ?? {}) as Promise<{ requirements: RequirementRecord[]; memories: RequirementMemoryRecord[] }>,
  getRequirement: (requirementId: string) =>
    ipcRenderer.invoke("requirement:get", { requirementId }) as Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord }>,
  createRequirement: (params: CreateRequirementParams) =>
    ipcRenderer.invoke("requirement:create", params) as Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord }>,
  updateRequirement: (params: UpdateRequirementParams) =>
    ipcRenderer.invoke("requirement:update", params) as Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord }>,
  assignThreadToRequirement: (params: { requirementId: string; threadId: string }) =>
    ipcRenderer.invoke("requirement:assign-thread", params) as Promise<{ requirement: RequirementRecord; memory: RequirementMemoryRecord; thread: import("@my-agent/protocol").ThreadRecord }>,
  unassignThreadFromRequirement: (params: { threadId: string }) =>
    ipcRenderer.invoke("requirement:unassign-thread", params) as Promise<{ thread: import("@my-agent/protocol").ThreadRecord }>,
  updateThread: (params: UpdateThreadParams) => ipcRenderer.invoke("thread:update", params),
  startThread: (params: StartThreadParams) => ipcRenderer.invoke("thread:start", params),
  resumeThread: (threadId: string) => ipcRenderer.invoke("thread:resume", { threadId }),
  startTurn: (params: StartTurnParams) => ipcRenderer.invoke("turn:start", params),
  steerTurn: (params: TurnSteerParams) => ipcRenderer.invoke("turn:steer", params) as Promise<{ steer: TurnSteerRecord }>,
  interruptTurn: (params: InterruptTurnParams) => ipcRenderer.invoke("turn:interrupt", params),
  startReview: (params: ReviewStartParams) => ipcRenderer.invoke("review:start", params) as Promise<{ review: ReviewRecord }>,
  listReviews: (params?: { projectId?: string; threadId?: string }) =>
    ipcRenderer.invoke("review:list", params ?? {}) as Promise<{ reviews: ReviewRecord[] }>,
  createTerminal: (params: TerminalCreateParams) => ipcRenderer.invoke("terminal:create", params) as Promise<{ session: TerminalSessionRecord }>,
  writeTerminal: (params: TerminalWriteParams) => ipcRenderer.invoke("terminal:write", params) as Promise<{ session: TerminalSessionRecord }>,
  readTerminal: (params: TerminalReadParams) =>
    ipcRenderer.invoke("terminal:read", params) as Promise<{ session: TerminalSessionRecord; output: string }>,
  archiveTerminal: (params: TerminalArchiveParams) => ipcRenderer.invoke("terminal:archive", params) as Promise<{ session: TerminalSessionRecord }>,
  clearTerminal: (params: TerminalClearBufferParams) => ipcRenderer.invoke("terminal:clear", params) as Promise<{ session: TerminalSessionRecord }>,
  resizeTerminal: (params: TerminalResizeParams) => ipcRenderer.invoke("terminal:resize", params) as Promise<{ session: TerminalSessionRecord }>,
  closeTerminal: (params: TerminalCloseParams) => ipcRenderer.invoke("terminal:close", params) as Promise<{ session: TerminalSessionRecord }>,
  respondTerminalApproval: (params: TerminalApprovalResponseParams) =>
    ipcRenderer.invoke("terminal:approval:respond", params) as Promise<{ session: import("@my-agent/protocol").TerminalSessionRecord }>,
  respondApproval: (params: ApprovalResponseParams) => ipcRenderer.invoke("approval:respond", params),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  writeSkillConfig: (disabledSkillIds: string[]) => ipcRenderer.invoke("skills:config:write", { disabledSkillIds }),
  readSkillDocument: (skillPath: string) => ipcRenderer.invoke("skills:document:read", { skillPath }) as Promise<{ content: string }>,
  revealSkillPath: (skillPath: string) => ipcRenderer.invoke("skills:path:reveal", { skillPath }) as Promise<{ ok: boolean; error?: string }>,
  readConfig: () => ipcRenderer.invoke("config:read"),
  writeConfig: (params: ConfigWriteParams) => ipcRenderer.invoke("config:write", params),
  testProvider: (params?: ProviderActionParams) => ipcRenderer.invoke("provider:test", params),
  listProviderModels: (params?: ProviderActionParams) =>
    ipcRenderer.invoke("provider:models", params) as Promise<{ models: ProviderModelRecord[] }>,
  listWorktrees: (projectId?: string) => ipcRenderer.invoke("worktree:list", { projectId }) as Promise<{ worktrees: WorktreeRecord[] }>,
  createWorktree: (params: { projectId: string; threadId?: string; branch?: string; baseRef?: string }) =>
    ipcRenderer.invoke("worktree:create", params) as Promise<{ worktree: WorktreeRecord }>,
  removeWorktree: (worktreeId: string) => ipcRenderer.invoke("worktree:remove", { worktreeId }) as Promise<{ worktree: WorktreeRecord }>,
  listEnvironments: (projectId?: string) => ipcRenderer.invoke("environment:list", { projectId }) as Promise<{ environments: EnvironmentRecord[] }>,
  detectEnvironment: (params: { projectId: string; threadId?: string; worktreeId?: string; cwd?: string }) =>
    ipcRenderer.invoke("environment:detect", params) as Promise<{ environment: EnvironmentRecord }>,
  listExecutionContexts: (projectId?: string) =>
    ipcRenderer.invoke("executionContext:list", { projectId }) as Promise<{ executionContexts: ExecutionContextRecord[] }>,
  listWorkflows: (projectId?: string) => ipcRenderer.invoke("workflow:list", { projectId }) as Promise<{ workflows: WorkflowRecord[] }>,
  runWorkflow: (params: { workflowId: string; projectId: string; threadId?: string; nonInteractive?: boolean }) =>
    ipcRenderer.invoke("workflow:run", params),
  listWorkflowRuns: (workflowId?: string) => ipcRenderer.invoke("workflow:runs", { workflowId }) as Promise<{ runs: WorkflowRunRecord[] }>,
  resumeWorkflow: (params: { runId: string; approvePausedSteps?: boolean; retryFailedStepIds?: string[] }) =>
    ipcRenderer.invoke("workflow:resume", params),
  listAgentTasks: (projectId?: string) => ipcRenderer.invoke("agent:list", { projectId }) as Promise<{ tasks: AgentTaskRecord[] }>,
  listTools: (params?: ToolListParams) => ipcRenderer.invoke("tool:list", params ?? {}) as Promise<{ tools: ToolCatalogRecord[] }>,
  listPlugins: (params?: PluginListParams) => ipcRenderer.invoke("plugin:list", params ?? {}) as Promise<{ plugins: PluginRecord[] }>,
  updatePlugin: (params: UpdatePluginParams) => ipcRenderer.invoke("plugin:update", params) as Promise<{ plugin: PluginRecord }>,
  listInternalTools: (params?: { projectId?: string }) =>
    ipcRenderer.invoke("internalTool:list", params ?? {}) as Promise<{ internalTools: InternalToolRecord[] }>,
  updateInternalTool: (params: UpdateInternalToolParams) =>
    ipcRenderer.invoke("internalTool:update", params) as Promise<{ internalTool: InternalToolRecord }>,
  listMcpMounts: () => ipcRenderer.invoke("mcp:list") as Promise<{ mounts: McpMountRecord[] }>,
  listMcpSessions: () => ipcRenderer.invoke("mcp:sessions") as Promise<{ sessions: McpSessionRecord[] }>,
  refreshMcpMount: (mountId: string) => ipcRenderer.invoke("mcp:refresh", { mountId }),
  setTitleBarTheme: (theme: "light" | "dark") => ipcRenderer.invoke("window:set-titlebar-theme", theme),
  showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) =>
    ipcRenderer.invoke("window:show-app-menu", params),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  pickFiles: () => ipcRenderer.invoke("files:pick") as Promise<TurnInputAttachment[]>,
  revealProjectPath: (projectPath: string) =>
    ipcRenderer.invoke("project:path:reveal", { projectPath }) as Promise<{ ok: boolean; error?: string }>,
  execCommand: (params: CommandExecParams) =>
    ipcRenderer.invoke("command:exec", params) as Promise<{ code: number; stdout: string; stderr: string }>,
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  onEvent: (listener: (event: HarnessEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: HarnessEvent) => listener(payload);
    ipcRenderer.on("harness:event", wrapped);
    return () => ipcRenderer.off("harness:event", wrapped);
  },
};

contextBridge.exposeInMainWorld("myAgent", api);

declare global {
  interface Window {
    myAgent: typeof api;
  }
}
