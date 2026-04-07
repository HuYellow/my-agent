export type JsonRpcId = string;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse<TResult = unknown> = JsonRpcSuccess<TResult> | JsonRpcFailure;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "on-request" | "on-failure" | "never";
export type ApiFlavor = "chat_completions" | "responses";
export type ModelReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SkillScope = "SYSTEM" | "USER" | "REPO" | "ADMIN";
export type RuntimeRunMode = "no-tools" | "limited-tools" | "full-tools";
export type ItemKind =
  | "userMessage"
  | "agentMessage"
  | "reasoning"
  | "toolCall"
  | "toolResult"
  | "commandExecution"
  | "fileChange"
  | "approvalRequest"
  | "approvalResult"
  | "terminalSession"
  | "agentTask"
  | "error";

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFlavor: ApiFlavor;
  reasoningEffort?: ModelReasoningEffort;
}

export interface ProviderCapabilities {
  apiFlavor: ApiFlavor;
  supportsResponses: boolean;
  supportsChatCompletions: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsResumableApprovals: boolean;
  recommendedRunMode: RuntimeRunMode;
  notes?: string[];
}

export interface ProviderModelRecord {
  id: string;
  created?: number;
  ownedBy?: string;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  rootPath: string;
  shell: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
}

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  shell: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeRecord {
  id: string;
  projectId: string;
  threadId?: string;
  agentId?: string;
  branch: string;
  path: string;
  status: "ready" | "creating" | "removed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentRecord {
  id: string;
  projectId: string;
  threadId?: string;
  worktreeId?: string;
  cwd: string;
  shell: string;
  envJson: Record<string, string>;
  detectedTools: string[];
  pythonVenvPath?: string;
  nodeVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadRecord {
  id: string;
  title: string;
  projectId: string;
  sandboxMode: SandboxMode;
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface TurnRecord {
  id: string;
  threadId: string;
  status: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  input: string;
  createdAt: string;
  updatedAt: string;
}

export interface ItemRecord {
  id: string;
  turnId: string;
  threadId: string;
  kind: ItemKind;
  status: "in_progress" | "completed" | "failed";
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  path: string;
  enabled: boolean;
  metadata: {
    displayName?: string;
    shortDescription?: string;
    brandColor?: string;
    allowImplicitInvocation: boolean;
  };
}

export interface PendingApproval {
  id: string;
  turnId: string;
  threadId: string;
  toolName: string;
  reason: string;
  args: Record<string, unknown>;
  createdAt: string;
  scope: "once" | "session";
  mode?: "preflight" | "deferred";
}

export interface AppConfig {
  globalInstructions: string;
  selectedProjectId?: string;
  selectedWorkspaceId?: string;
  provider: ProviderProfile;
  providerCapabilities?: ProviderCapabilities;
  workspace: WorkspaceProfile;
  disabledSkillIds: string[];
  runtimeRunMode?: RuntimeRunMode;
}

export interface InitializeResult {
  protocolVersion: string;
  server: {
    name: string;
    version: string;
  };
  config: AppConfig;
  projects: ProjectRecord[];
  threads: ThreadRecord[];
  skills: SkillDescriptor[];
  worktrees?: WorktreeRecord[];
  environments?: EnvironmentRecord[];
  executionContexts?: ExecutionContextRecord[];
}

export interface StartThreadParams {
  title?: string;
  workspace?: Partial<WorkspaceProfile>;
  projectId?: string;
  sandboxMode?: SandboxMode;
}

export interface StartThreadResult {
  thread: ThreadRecord;
}

export interface ResumeThreadParams {
  threadId: string;
}

export interface ResumeThreadResult {
  thread: ThreadRecord;
  turns: TurnRecord[];
  items: ItemRecord[];
  pendingApproval?: PendingApproval | null;
}

export interface ArchiveThreadParams {
  threadId: string;
}

export interface ForkThreadParams {
  threadId: string;
  title?: string;
}

export interface ForkThreadResult {
  thread: ThreadRecord;
}

export interface StartTurnParams {
  threadId: string;
  input: string;
  attachments?: TurnInputAttachment[];
  selectedSkillIds?: string[];
  includeIdeContext?: boolean;
}

export interface StartTurnResult {
  turn: TurnRecord;
}

export interface InterruptTurnParams {
  turnId: string;
}

export interface ApprovalResponseParams {
  approvalId: string;
  decision: "approve" | "reject";
  scope?: "once" | "session";
}

export interface ApprovalResponseResult {
  turn: TurnRecord;
}

export interface ListSkillsResult {
  skills: SkillDescriptor[];
}

export interface WriteSkillConfigParams {
  disabledSkillIds: string[];
}

export interface ProviderTestResult {
  ok: boolean;
  status: number;
  message: string;
}

export interface ProviderModelsResult {
  models: ProviderModelRecord[];
}

export interface TurnInputAttachment {
  path: string;
  name: string;
  kind: "image" | "text" | "binary";
  mediaType?: string;
  sizeBytes?: number;
  imageDataUrl?: string;
  textContent?: string;
  truncated?: boolean;
}

export interface CreateProjectParams {
  name?: string;
  rootPath: string;
  shell?: string;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
}

export interface CreateProjectResult {
  project: ProjectRecord;
}

export interface UpdateProjectParams {
  projectId: string;
  patch: Partial<Pick<ProjectRecord, "name" | "rootPath" | "shell" | "sandboxMode" | "approvalPolicy">>;
}

export interface UpdateProjectResult {
  project: ProjectRecord;
}

export interface UpdateThreadParams {
  threadId: string;
  patch: Partial<Pick<ThreadRecord, "title" | "sandboxMode" | "archivedAt">>;
}

export interface UpdateThreadResult {
  thread: ThreadRecord;
}

export interface ConfigReadResult {
  config: AppConfig;
}

export interface ConfigWriteParams {
  config: Partial<AppConfig>;
}

export interface EventEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

export interface TerminalSessionRecord {
  id: string;
  threadId?: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
}

export interface TerminalReadResult {
  session: TerminalSessionRecord;
  output: string;
}

export interface ExecutionContextRecord {
  id: string;
  projectId: string;
  kind: "thread" | "agent" | "workflow" | "review";
  threadId?: string;
  agentId?: string;
  worktreeId?: string;
  environmentId?: string;
  cwd: string;
  shell: string;
  envJson: Record<string, string>;
  detectedTools: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskSummary {
  finalMessage?: string;
  toolCallCount: number;
  fileChangeCount: number;
  commandCount: number;
  approvalRequestCount: number;
  changedPaths: string[];
}

export interface AgentTaskRecord {
  id: string;
  parentThreadId: string;
  parentTurnId?: string;
  title: string;
  status: "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  finalOutput?: string;
  childThreadId?: string;
  lastTurnId?: string;
  worktreeId?: string;
  environmentId?: string;
  executionContextId?: string;
  summary?: AgentTaskSummary;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  type: "command" | "agent" | "approval";
  title: string;
  command?: string;
  prompt?: string;
  approvalMessage?: string;
  worktreeStrategy?: "inherit" | "new";
  dependsOn?: string[];
  dependencyMode?: "all" | "any";
  nextStepIds?: string[];
  onFailureStepIds?: string[];
  onFailureAction?: "fail" | "continue" | "pause";
  runIf?: Array<{
    stepId: string;
    status: "completed" | "failed" | "skipped";
  }>;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "system" | "user" | "repo";
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStepRecord {
  stepId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "skipped";
  output?: string;
  worktreeId?: string;
  environmentId?: string;
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
  attempts: number;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  projectId: string;
  threadId?: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  pendingStepIds: string[];
  pausedStepIds: string[];
  completedStepIds: string[];
  failedStepIds: string[];
  steps: WorkflowRunStepRecord[];
  pauseReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  path: string;
  source: "system" | "user" | "repo";
  enabled: boolean;
  capabilities: string[];
  sandboxMode?: SandboxMode;
  command?: string;
  args?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface McpMountRecord {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpSessionRecord {
  id: string;
  mountId: string;
  status: "connecting" | "ready" | "failed" | "closed";
  transport: "stdio" | "http";
  lastConnectedAt?: string;
  updatedAt: string;
}

export interface McpPromptRecord {
  name: string;
  description?: string;
}

export interface McpResourceRecord {
  uri: string;
  name?: string;
  description?: string;
}

export interface McpToolRecord {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export type HarnessEvent =
  | EventEnvelope<"thread/started", { thread: ThreadRecord }>
  | EventEnvelope<"turn/started", { turn: TurnRecord }>
  | EventEnvelope<"item/started", { item: ItemRecord }>
  | EventEnvelope<"item/delta", { itemId: string; delta: string }>
  | EventEnvelope<"item/completed", { item: ItemRecord }>
  | EventEnvelope<"approval/requested", { approval: PendingApproval; item: ItemRecord }>
  | EventEnvelope<"serverRequest/resolved", { approvalId: string; decision: "approve" | "reject" }>
  | EventEnvelope<"turn/completed", { turn: TurnRecord }>
  | EventEnvelope<"turn/cancelled", { turn: TurnRecord; message: string }>
  | EventEnvelope<"turn/failed", { turn: TurnRecord; message: string }>
  | EventEnvelope<"config/changed", { config: AppConfig }>
  | EventEnvelope<"skills/changed", { skills: SkillDescriptor[] }>
  | EventEnvelope<"terminal/updated", { session: TerminalSessionRecord }>
  | EventEnvelope<"agent/updated", { task: AgentTaskRecord }>
  | EventEnvelope<"worktree/updated", { worktree: WorktreeRecord }>
  | EventEnvelope<"environment/updated", { environment: EnvironmentRecord }>
  | EventEnvelope<"executionContext/updated", { executionContext: ExecutionContextRecord }>
  | EventEnvelope<"workflow/updated", { workflow: WorkflowRecord }>
  | EventEnvelope<"plugin/updated", { plugin: PluginRecord }>
  | EventEnvelope<"mcp/updated", { mount: McpMountRecord }>
  | EventEnvelope<"mcp/session", { session: McpSessionRecord }>
  | EventEnvelope<"workflow/run", { run: WorkflowRunRecord }>;

export interface CommandExecParams {
  command: string;
  cwd?: string;
  threadId?: string;
}

export interface CommandExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ReadFileParams {
  path: string;
}

export interface ReadFileResult {
  path: string;
  content: string;
}

export interface WritePatchParams {
  path: string;
  content: string;
  threadId?: string;
}

export interface WritePatchResult {
  path: string;
  bytesWritten: number;
}

export interface ApplyPatchParams {
  patch: string;
  threadId?: string;
}

export interface ApplyPatchResult {
  files: Array<{
    path: string;
    action: "add" | "update" | "delete" | "move";
    bytesWritten?: number;
  }>;
}

export interface TerminalCreateParams {
  threadId?: string;
  cwd?: string;
  shell?: string;
}

export interface TerminalCreateResult {
  session: TerminalSessionRecord;
}

export interface TerminalWriteParams {
  sessionId: string;
  input: string;
}

export interface TerminalResizeParams {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalCloseParams {
  sessionId: string;
}

export interface TerminalReadParams {
  sessionId: string;
}

export interface AgentSpawnParams {
  threadId: string;
  turnId?: string;
  title?: string;
  input: string;
  selectedSkillIds?: string[];
  inheritHistory?: boolean;
}

export interface AgentSpawnResult {
  task: AgentTaskRecord;
}

export interface AgentSendInputParams {
  agentId: string;
  input: string;
}

export interface AgentWaitParams {
  agentId: string;
  timeoutMs?: number;
}

export interface AgentWaitResult {
  task: AgentTaskRecord;
}

export interface AgentCloseParams {
  agentId: string;
}

export interface AgentCloseResult {
  task: AgentTaskRecord;
}

export interface WorktreeCreateParams {
  projectId: string;
  threadId?: string;
  agentId?: string;
  branch?: string;
  baseRef?: string;
}

export interface WorktreeListParams {
  projectId?: string;
}

export interface WorktreeRemoveParams {
  worktreeId: string;
}

export interface EnvironmentDetectParams {
  projectId: string;
  threadId?: string;
  worktreeId?: string;
  cwd?: string;
}

export interface WorkflowRunParams {
  workflowId: string;
  projectId: string;
  threadId?: string;
  nonInteractive?: boolean;
  runId?: string;
}

export interface WorkflowRunResult {
  workflow: WorkflowRecord;
  run: WorkflowRunRecord;
  stepsRun: Array<{
    stepId: string;
    status: "completed" | "failed" | "skipped";
    output?: string;
    worktreeId?: string;
    environmentId?: string;
    agentId?: string;
  }>;
}

export interface PluginListResult {
  plugins: PluginRecord[];
}

export interface McpListResult {
  mounts: McpMountRecord[];
}

export interface WorkflowResumeParams {
  runId: string;
  approvePausedSteps?: boolean;
}

export interface WorkflowRunsResult {
  runs: WorkflowRunRecord[];
}

export interface McpSessionsResult {
  sessions: McpSessionRecord[];
}

export interface McpRefreshParams {
  mountId: string;
}

export interface McpToolsResult {
  tools: McpToolRecord[];
  prompts: McpPromptRecord[];
  resources: McpResourceRecord[];
}
