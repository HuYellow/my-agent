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
export type ApiFlavor = "chat_completions" | "responses" | "ai_sdk";
export type SkillScope = "SYSTEM" | "USER" | "REPO" | "ADMIN";
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
  | "error";

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFlavor: ApiFlavor;
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

export interface ThreadRecord {
  id: string;
  title: string;
  projectId: string;
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
}

export interface AppConfig {
  globalInstructions: string;
  selectedProjectId?: string;
  selectedWorkspaceId?: string;
  provider: ProviderProfile;
  workspace: WorkspaceProfile;
  disabledSkillIds: string[];
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
}

export interface StartThreadParams {
  title?: string;
  workspace?: Partial<WorkspaceProfile>;
  projectId?: string;
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
  selectedSkillIds?: string[];
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
  | EventEnvelope<"skills/changed", { skills: SkillDescriptor[] }>;

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
