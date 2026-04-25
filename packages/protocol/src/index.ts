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
export type SkillScope = "SYSTEM" | "USER" | "REPO" | "CATALOG" | "ADMIN";
export type RuntimeRunMode = "no-tools" | "limited-tools" | "full-tools";
export type RequirementStatus = "active" | "paused" | "completed" | "archived";
export type AutomationStatus = "active" | "paused";
export type AutomationKind = "workflow" | "prompt";
export type AutomationScheduleType = "manual" | "interval";
export type AutomationRunTrigger = "manual" | "scheduler" | "github_action" | "api";
export type AutomationRunner = "desktop" | "app-server" | "github-action" | "core";
export type ToolSource = "local" | "plugin" | "mcp" | "internal";
export type ToolApprovalMode = "none" | "preflight" | "deferred";
export type ToolRiskLevel = "safe_read" | "write" | "interactive" | "network" | "privileged";
export type ToolErrorCode =
  | "timeout"
  | "approval_required"
  | "blocked"
  | "validation_error"
  | "execution_failed"
  | "aborted";

export interface ToolSourceRecord {
  type: ToolSource;
  id?: string;
  label?: string;
  path?: string;
  details?: Record<string, string>;
}

export interface ToolCapabilityRecord {
  writes: boolean;
  network: boolean;
  interactive: boolean;
  approvalModes: ToolApprovalMode[];
  riskLevel: ToolRiskLevel;
  timeoutMs?: number;
  streamedOutput: boolean;
  resumable: boolean;
}

export interface ToolReferenceRecord {
  name: string;
  source: ToolSourceRecord;
  capability: ToolCapabilityRecord;
}

export interface ToolCatalogRecord extends ToolReferenceRecord {
  description: string;
  enabled: boolean;
  parametersSchema?: Record<string, unknown>;
}

export interface ProtocolCompatibilityRecord {
  protocolVersion: string;
  additiveChangesOnly: boolean;
  requiredToolSources: ToolSource[];
  structuredEventTypes: string[];
  guarantees: string[];
  documentationPath?: string;
}

export interface ToolErrorRecord {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  tool?: ToolReferenceRecord;
  approvalMode?: ToolApprovalMode;
  details?: Record<string, unknown>;
}

export type TemplateKind = "skill" | "workflow" | "plugin";
export type DistributionTarget = "user" | "repo" | "catalog";

export interface ArtifactCompatibilityRecord {
  protocolVersion?: string;
  serverVersion?: string;
  notes?: string[];
}

export interface DistributionTemplateRecord {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  version: string;
  recommendedTarget: DistributionTarget;
  supportedTargets: DistributionTarget[];
  destinationHint: string;
  files: string[];
  documentationPath?: string;
}

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

export interface RequirementRecord {
  id: string;
  title: string;
  status: RequirementStatus;
  primaryProjectId: string;
  relatedProjectIds: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface RequirementManualMemoryRecord {
  brief: string;
  goals: string[];
  constraints: string[];
  decisions: string[];
  openQuestions: string[];
  definitionOfDone: string[];
}

export interface RequirementDerivedProjectLink {
  projectId: string;
  name: string;
  role: "primary" | "related";
}

export interface RequirementDerivedThreadLink {
  threadId: string;
  title: string;
  projectId: string;
  updatedAt: string;
  hidden: boolean;
  latestTurnStatus?: TurnRecord["status"] | "idle";
}

export interface RequirementDerivedReviewLink {
  reviewId: string;
  status: ReviewRecord["status"];
  summary?: string;
  updatedAt: string;
  threadId?: string;
}

export interface RequirementDerivedArtifactLink {
  source: "review" | "workflow" | "agent";
  sourceId: string;
  summary: string;
  updatedAt: string;
}

export interface RequirementDerivedMemoryRecord {
  linkedProjects: RequirementDerivedProjectLink[];
  linkedThreads: RequirementDerivedThreadLink[];
  recentReviews: RequirementDerivedReviewLink[];
  recentArtifacts: RequirementDerivedArtifactLink[];
  recentChanges: string[];
  activitySummary: string;
}

export interface RequirementMemoryRecord {
  requirementId: string;
  manual: RequirementManualMemoryRecord;
  derived: RequirementDerivedMemoryRecord;
  updatedAt: string;
  lastRebuiltAt?: string;
}

export interface WorktreeRecord {
  id: string;
  projectId: string;
  requirementId?: string;
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
  requirementId?: string;
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
  requirementId?: string;
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
    templateVersion?: string;
  };
}

export interface PendingApproval {
  id: string;
  turnId: string;
  threadId: string;
  toolName: string;
  tool?: ToolReferenceRecord;
  reason: string;
  args: Record<string, unknown>;
  createdAt: string;
  scope: "once" | "session";
  mode?: "preflight" | "deferred";
}

export interface AppConfig {
  globalInstructions: string;
  selectedProjectId?: string;
  selectedRequirementId?: string;
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
  compatibility?: ProtocolCompatibilityRecord;
  config: AppConfig;
  projects: ProjectRecord[];
  requirements?: RequirementRecord[];
  requirementMemories?: RequirementMemoryRecord[];
  threads: ThreadRecord[];
  skills: SkillDescriptor[];
  worktrees?: WorktreeRecord[];
  environments?: EnvironmentRecord[];
  executionContexts?: ExecutionContextRecord[];
  terminals?: TerminalSessionRecord[];
  terminalCapabilities?: TerminalBackendCapability[];
  terminalOutputArchives?: TerminalOutputArchiveRecord[];
  reviews?: ReviewRecord[];
  workflows?: WorkflowRecord[];
  workflowRuns?: WorkflowRunRecord[];
  automations?: AutomationRecord[];
  automationRuns?: AutomationRunRecord[];
  automationRunLogs?: AutomationRunLogRecord[];
  agentTasks?: AgentTaskRecord[];
  tools?: ToolCatalogRecord[];
  plugins?: PluginRecord[];
  internalTools?: InternalToolRecord[];
  templates?: DistributionTemplateRecord[];
}

export interface StartThreadParams {
  title?: string;
  workspace?: Partial<WorkspaceProfile>;
  projectId?: string;
  requirementId?: string;
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
  turnContexts?: TurnContextSnapshotRecord[];
  turnPlans?: TurnPlanRecord[];
  turnDiffs?: TurnDiffRecord[];
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

export interface TurnSteerParams {
  turnId: string;
  input: string;
  priority?: "low" | "normal" | "high";
  visibility?: "user" | "system";
}

export interface TurnSteerRecord {
  id: string;
  turnId: string;
  threadId: string;
  input: string;
  priority: "low" | "normal" | "high";
  visibility: "user" | "system";
  status: "queued" | "applied" | "rejected";
  createdAt: string;
  appliedAt?: string;
  message?: string;
}

export interface TurnSteerResult {
  steer: TurnSteerRecord;
}

export interface ApprovalResponseParams {
  approvalId: string;
  decision: "approve" | "reject";
  scope?: "once" | "session";
}

export interface ApprovalResponseResult {
  turn: TurnRecord;
}

export interface ReviewSource {
  kind: "workspace" | "staged" | "base_branch" | "commit";
  baseBranch?: string;
  commit?: string;
}

export interface ReviewFinding {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  detail?: string;
  file?: string;
  line?: number;
}

export interface ReviewRecord {
  id: string;
  projectId: string;
  requirementId?: string;
  threadId?: string;
  executionContextId?: string;
  status: "queued" | "running" | "completed" | "failed";
  source: ReviewSource;
  instructions?: string;
  summary?: string;
  findings: ReviewFinding[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ReviewStartParams {
  projectId?: string;
  threadId?: string;
  source?: ReviewSource;
  instructions?: string;
}

export interface ReviewStartResult {
  review: ReviewRecord;
}

export interface ReviewListResult {
  reviews: ReviewRecord[];
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

export interface ProviderActionParams {
  provider?: Partial<ProviderProfile>;
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

export interface RequirementListParams {
  projectId?: string;
}

export interface RequirementListResult {
  requirements: RequirementRecord[];
  memories: RequirementMemoryRecord[];
}

export interface RequirementGetParams {
  requirementId: string;
}

export interface RequirementGetResult {
  requirement: RequirementRecord;
  memory: RequirementMemoryRecord;
}

export interface CreateRequirementParams {
  title: string;
  primaryProjectId: string;
  relatedProjectIds?: string[];
  status?: RequirementStatus;
  memory?: Partial<RequirementManualMemoryRecord>;
}

export interface CreateRequirementResult {
  requirement: RequirementRecord;
  memory: RequirementMemoryRecord;
}

export interface UpdateRequirementParams {
  requirementId: string;
  patch: Partial<Pick<RequirementRecord, "title" | "status" | "primaryProjectId" | "relatedProjectIds" | "archivedAt">> & {
    memory?: Partial<RequirementManualMemoryRecord>;
  };
}

export interface UpdateRequirementResult {
  requirement: RequirementRecord;
  memory: RequirementMemoryRecord;
}

export interface RequirementAssignThreadParams {
  requirementId: string;
  threadId: string;
}

export interface RequirementAssignThreadResult {
  requirement: RequirementRecord;
  memory: RequirementMemoryRecord;
  thread: ThreadRecord;
}

export interface RequirementUnassignThreadParams {
  threadId: string;
}

export interface RequirementUnassignThreadResult {
  thread: ThreadRecord;
}

export interface UpdateThreadResult {
  thread: ThreadRecord;
}

export interface ConfigReadResult {
  config: AppConfig;
}

export interface ToolListParams {
  projectId?: string;
  threadId?: string;
}

export interface ToolListResult {
  tools: ToolCatalogRecord[];
}

export interface ConfigWriteParams {
  config: Partial<AppConfig>;
}

export interface EventEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

export interface TurnContextSectionRecord {
  key: string;
  label: string;
  summary: string;
  detail?: string;
  count?: number;
  estimatedTokens?: number;
  included: boolean;
}

export interface TurnContextSnapshotRecord {
  turnId: string;
  threadId: string;
  summaryText: string;
  historyMode: "full" | "compressed";
  historyItemCount: number;
  archivedHistoryItemCount: number;
  sections: TurnContextSectionRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface TurnPlanStepRecord {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
}

export interface TurnPlanRecord {
  turnId: string;
  threadId: string;
  sourceItemId?: string;
  title: string;
  summary?: string;
  steps: TurnPlanStepRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface DiffStatRecord {
  fileCount: number;
  additions: number;
  deletions: number;
}

export interface TurnDiffFileRecord {
  itemId: string;
  turnId: string;
  path: string;
  title: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  additions?: number;
  deletions?: number;
  patch?: string;
  updatedAt: string;
}

export interface TurnDiffRecord {
  id: string;
  turnId: string;
  threadId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  stats: DiffStatRecord;
  files: TurnDiffFileRecord[];
}

export interface TerminalSessionRecord {
  id: string;
  threadId?: string;
  workspaceId: string;
  cwd: string;
  shell: string;
  backend: "pipe" | "pty";
  status: "starting" | "open" | "closing" | "closed" | "failed";
  cols?: number;
  rows?: number;
  pid?: number;
  exitCode?: number;
  failureReason?: string;
  lastCommand?: string;
  lastCommandRisk?: TerminalCommandRisk;
  lastCommandApprovalState?: TerminalCommandApprovalState;
  lastCommandRequiresApproval?: boolean;
  lastCommandReason?: string;
  lastCommandAt?: string;
  pendingApprovalMode?: "preflight" | "deferred";
  pendingApprovalCommand?: string;
  pendingApprovalReason?: string;
  startedAt: string;
  lastActiveAt: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type TerminalCommandRisk = "safe_read" | "write" | "interactive" | "network" | "privileged";
export type TerminalCommandApprovalState = "not_required" | "required" | "deferred" | "blocked";

export interface TerminalBackendCapability {
  kind: TerminalSessionRecord["backend"];
  available: boolean;
  interactive: boolean;
  supportsInteractiveCommands: boolean;
  supportsResize: boolean;
  approvalModes: Array<"preflight" | "deferred" | "session">;
  defaultApprovalMode: "preflight" | "deferred" | "session";
  reason?: string;
}

export interface TerminalReadResult {
  session: TerminalSessionRecord;
  output: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  threadId?: string;
  delta: string;
  timestamp: string;
}

export interface TerminalOutputArchiveRecord {
  id: string;
  sessionId: string;
  threadId?: string;
  reason: "auto_truncate" | "manual_archive" | "manual_clear";
  output: string;
  createdAt: string;
}

export interface TerminalApprovalResponseParams {
  sessionId: string;
  decision: "approve" | "reject";
  scope?: "once" | "session";
}

export interface TerminalArchiveParams {
  sessionId: string;
  reason?: "manual_archive" | "manual_clear";
}

export interface TerminalClearBufferParams {
  sessionId: string;
}

export interface ExecutionContextRecord {
  id: string;
  projectId: string;
  requirementId?: string;
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

export interface ExecutionUnitResult {
  status: "pending" | "running" | "paused" | "completed" | "failed" | "skipped";
  output?: string;
  artifactSummary?: string;
  worktreeId?: string;
  environmentId?: string;
  executionContextId?: string;
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowStep {
  id: string;
  type: "command" | "agent" | "approval" | "review";
  title: string;
  command?: string;
  prompt?: string;
  timeoutMs?: number;
  reviewSource?: ReviewSource;
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
  source: "system" | "user" | "repo" | "catalog";
  manifestVersion?: string;
  compatibility?: ArtifactCompatibilityRecord;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStepRecord extends ExecutionUnitResult {
  stepId: string;
  attempts: number;
  retainedFailures?: WorkflowStepFailureArtifact[];
}

export interface WorkflowFinishedStepResult extends ExecutionUnitResult {
  stepId: string;
  status: "completed" | "failed" | "skipped";
  retainedFailures?: WorkflowStepFailureArtifact[];
}

export interface WorkflowStepFailureArtifact {
  attempt: number;
  output?: string;
  artifactSummary?: string;
  worktreeId?: string;
  environmentId?: string;
  executionContextId?: string;
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
  retainedAt: string;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  projectId: string;
  requirementId?: string;
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

export interface AutomationRecord {
  id: string;
  name: string;
  kind: AutomationKind;
  projectId: string;
  requirementId?: string;
  workflowId?: string;
  prompt?: string;
  threadTitle?: string;
  scheduleType: AutomationScheduleType;
  intervalMinutes?: number;
  status: AutomationStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  lastRunStatus?: "idle" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  kind: AutomationKind;
  projectId: string;
  requirementId?: string;
  status: "running" | "completed" | "failed";
  trigger: AutomationRunTrigger;
  runner: AutomationRunner;
  initiatedBy?: string;
  threadId?: string;
  turnId?: string;
  workflowRunId?: string;
  summary?: string;
  output?: string;
  artifacts: AutomationRunArtifactRecord[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AutomationRunArtifactRecord {
  kind: "workflow_run" | "thread" | "turn" | "report";
  label: string;
  id?: string;
  summary?: string;
  metadata?: Record<string, string>;
}

export interface AutomationRunLogRecord {
  id: string;
  runId: string;
  automationId: string;
  projectId: string;
  level: "info" | "warning" | "error";
  message: string;
  detail?: string;
  createdAt: string;
}

export interface ReviewArtifactRecord {
  sourceLabel: string;
  diffStats?: DiffStatRecord;
  findingCounts: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  path: string;
  manifestPath: string;
  source: "system" | "user" | "repo" | "catalog";
  enabled: boolean;
  trusted: boolean;
  capabilities: string[];
  manifestVersion?: string;
  compatibility?: ArtifactCompatibilityRecord;
  toolName?: string;
  sandboxMode?: SandboxMode;
  command?: string;
  args?: string[];
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InternalToolRecord {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "user" | "repo";
  enabled: boolean;
  endpoint?: string;
  method?: "GET" | "POST";
  timeoutMs?: number;
  approvalRequired: boolean;
  approvalReason?: string;
  writes: boolean;
  network: boolean;
  parametersSchema?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    description?: string;
  };
  validationErrors: string[];
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
  | EventEnvelope<"requirement/updated", { requirement: RequirementRecord }>
  | EventEnvelope<"requirement/memoryUpdated", { memory: RequirementMemoryRecord }>
  | EventEnvelope<"turn/started", { turn: TurnRecord }>
  | EventEnvelope<"turn/contextUpdated", { snapshot: TurnContextSnapshotRecord }>
  | EventEnvelope<"turn/planUpdated", { plan: TurnPlanRecord }>
  | EventEnvelope<"turn/diffUpdated", { diff: TurnDiffRecord }>
  | EventEnvelope<"turn/steered", { steer: TurnSteerRecord }>
  | EventEnvelope<"item/started", { item: ItemRecord }>
  | EventEnvelope<"item/delta", { itemId: string; delta: string }>
  | EventEnvelope<"item/completed", { item: ItemRecord }>
  | EventEnvelope<"approval/requested", { approval: PendingApproval; item: ItemRecord }>
  | EventEnvelope<"serverRequest/resolved", { approvalId: string; decision: "approve" | "reject" }>
  | EventEnvelope<"turn/completed", { turn: TurnRecord }>
  | EventEnvelope<"turn/cancelled", { turn: TurnRecord; message: string }>
  | EventEnvelope<"turn/failed", { turn: TurnRecord; message: string }>
  | EventEnvelope<"review/started", { review: ReviewRecord; artifact: ReviewArtifactRecord }>
  | EventEnvelope<"review/status", { review: ReviewRecord; artifact: ReviewArtifactRecord }>
  | EventEnvelope<"review/result", { review: ReviewRecord; artifact: ReviewArtifactRecord }>
  | EventEnvelope<"config/changed", { config: AppConfig }>
  | EventEnvelope<"skills/changed", { skills: SkillDescriptor[] }>
  | EventEnvelope<"terminal/updated", { session: TerminalSessionRecord }>
  | EventEnvelope<"terminal/output", TerminalOutputEvent>
  | EventEnvelope<"terminal/outputArchived", { archive: TerminalOutputArchiveRecord }>
  | EventEnvelope<"terminal/outputCleared", { sessionId: string; threadId?: string; timestamp: string }>
  | EventEnvelope<"agent/updated", { task: AgentTaskRecord }>
  | EventEnvelope<"worktree/updated", { worktree: WorktreeRecord }>
  | EventEnvelope<"environment/updated", { environment: EnvironmentRecord }>
  | EventEnvelope<"executionContext/updated", { executionContext: ExecutionContextRecord }>
  | EventEnvelope<"workflow/updated", { workflow: WorkflowRecord }>
  | EventEnvelope<"automation/updated", { automation: AutomationRecord }>
  | EventEnvelope<"automation/run", { run: AutomationRunRecord }>
  | EventEnvelope<"automation/log", { log: AutomationRunLogRecord }>
  | EventEnvelope<"plugin/updated", { plugin: PluginRecord }>
  | EventEnvelope<"internalTool/updated", { internalTool: InternalToolRecord }>
  | EventEnvelope<"mcp/updated", { mount: McpMountRecord }>
  | EventEnvelope<"mcp/session", { session: McpSessionRecord }>
  | EventEnvelope<"tools/catalogUpdated", { tools: ToolCatalogRecord[] }>
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
  cols?: number;
  rows?: number;
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

export interface AgentListResult {
  tasks: AgentTaskRecord[];
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
  stepsRun: WorkflowFinishedStepResult[];
}

export interface PluginListParams {
  projectId?: string;
}

export interface PluginListResult {
  plugins: PluginRecord[];
}

export interface TemplateListResult {
  templates: DistributionTemplateRecord[];
}

export interface TemplateScaffoldParams {
  templateId: string;
  projectId?: string;
  target: DistributionTarget;
  name?: string;
  directoryName?: string;
}

export interface TemplateScaffoldResult {
  template: DistributionTemplateRecord;
  rootPath: string;
  createdPaths: string[];
}

export interface UpdatePluginParams {
  pluginId: string;
  patch: Partial<Pick<PluginRecord, "enabled" | "trusted">>;
}

export interface UpdatePluginResult {
  plugin: PluginRecord;
}

export interface InternalToolListParams {
  projectId?: string;
}

export interface InternalToolListResult {
  internalTools: InternalToolRecord[];
}

export interface UpdateInternalToolParams {
  internalToolId: string;
  patch: Partial<Pick<InternalToolRecord, "enabled">>;
}

export interface UpdateInternalToolResult {
  internalTool: InternalToolRecord;
}

export interface McpListResult {
  mounts: McpMountRecord[];
}

export interface WorkflowResumeParams {
  runId: string;
  approvePausedSteps?: boolean;
  retryFailedStepIds?: string[];
}

export interface WorkflowRunsResult {
  runs: WorkflowRunRecord[];
}

export interface AutomationListParams {
  projectId?: string;
}

export interface AutomationListResult {
  automations: AutomationRecord[];
}

export interface AutomationRunsParams {
  automationId?: string;
  projectId?: string;
}

export interface AutomationRunsResult {
  runs: AutomationRunRecord[];
}

export interface AutomationRunLogsParams {
  automationId?: string;
  projectId?: string;
  runId?: string;
}

export interface AutomationRunLogsResult {
  logs: AutomationRunLogRecord[];
}

export interface CreateAutomationParams {
  name: string;
  kind: AutomationKind;
  projectId: string;
  requirementId?: string;
  workflowId?: string;
  prompt?: string;
  threadTitle?: string;
  scheduleType?: AutomationScheduleType;
  intervalMinutes?: number;
  status?: AutomationStatus;
}

export interface CreateAutomationResult {
  automation: AutomationRecord;
}

export interface UpdateAutomationParams {
  automationId: string;
  patch: Partial<
    Pick<
      AutomationRecord,
      "name" | "projectId" | "requirementId" | "workflowId" | "prompt" | "threadTitle" | "scheduleType" | "intervalMinutes" | "status"
    >
  >;
}

export interface UpdateAutomationResult {
  automation: AutomationRecord;
}

export interface RunAutomationParams {
  automationId: string;
  trigger?: AutomationRunTrigger;
  runner?: AutomationRunner;
  initiatedBy?: string;
}

export interface RunAutomationResult {
  automation: AutomationRecord;
  run: AutomationRunRecord;
}

export interface ExecutionContextListResult {
  executionContexts: ExecutionContextRecord[];
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
