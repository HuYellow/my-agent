import {
  type ToolApprovalMode,
  type ToolCapabilityRecord,
  type ToolErrorCode,
  type ToolErrorRecord,
  type ToolReferenceRecord,
  type ToolRiskLevel,
  type ToolSource,
  type ToolSourceRecord,
  type WorkspaceProfile,
} from "@yellow-flow/protocol";
import { z, type ZodTypeAny } from "zod";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export type RuntimeToolParameters = ZodTypeAny | JsonSchemaObject;
export type RuntimeToolSource = ToolSource;
export type RuntimeToolSourceMetadata = ToolSourceRecord;
export type RuntimeToolCapability = ToolCapabilityRecord;

export interface ToolExecutionContext {
  workspace: WorkspaceProfile;
  emitCommandDelta: (delta: string) => void;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

export interface ToolDescriptorContext {
  workspace: WorkspaceProfile;
}

export interface ToolActionDescriptor {
  preview: string;
  scopeKey: string;
  source: RuntimeToolSourceMetadata;
  risky?: boolean;
  interactive?: boolean;
  riskLevel?: ToolRiskLevel;
  writes?: boolean;
  network?: boolean;
  paths?: string[];
  approvalReason?: string;
  timeoutMs?: number;
}

export interface RuntimeToolDefinition {
  name: string;
  description: string;
  parameters: RuntimeToolParameters;
  strict: boolean;
  source: RuntimeToolSourceMetadata;
  capability: RuntimeToolCapability;
  parseArgs: (input: unknown) => Record<string, unknown>;
  buildDescriptor: (args: Record<string, unknown>, context: ToolDescriptorContext) => ToolActionDescriptor;
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>;
}

export interface ToolProvider {
  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[];
}

export interface ToolPermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  approvalMode: ToolApprovalMode;
  denialReason?: string;
  approvalKey?: string;
  approvalReason?: string;
  sessionApproved?: boolean;
}

export interface PlannedToolExecution {
  definition: RuntimeToolDefinition;
  args: Record<string, unknown>;
  descriptor: ToolActionDescriptor;
  permission: ToolPermissionDecision;
  tool: ToolReferenceRecord;
}

export class ToolRuntimeError extends Error {
  constructor(readonly toolError: ToolErrorRecord) {
    super(toolError.message);
    this.name = "ToolRuntimeError";
  }
}

export class ToolBlockedError extends ToolRuntimeError {
  constructor(message: string, tool?: ToolReferenceRecord) {
    super(createToolErrorRecord("blocked", message, tool, false));
    this.name = "ToolBlockedError";
  }
}

export class ToolValidationError extends ToolRuntimeError {
  constructor(message: string, tool?: ToolReferenceRecord, details?: Record<string, unknown>) {
    super(createToolErrorRecord("validation_error", message, tool, false, undefined, details));
    this.name = "ToolValidationError";
  }
}

export class ApprovalRequiredError extends ToolRuntimeError {
  constructor(
    message: string,
    readonly permission: ToolPermissionDecision,
    readonly tool?: ToolReferenceRecord,
  ) {
    super(
      createToolErrorRecord(
        "approval_required",
        message,
        tool,
        true,
        permission.approvalMode,
        permission.approvalReason ? { approvalReason: permission.approvalReason } : undefined,
      ),
    );
    this.name = "ApprovalRequiredError";
  }
}

export class DeferredApprovalRequiredError extends ApprovalRequiredError {
  constructor(message: string, permission: ToolPermissionDecision, tool?: ToolReferenceRecord) {
    super(message, permission, tool);
    this.name = "DeferredApprovalRequiredError";
  }
}

export class ToolExecutionFailedError extends ToolRuntimeError {
  constructor(message: string, tool?: ToolReferenceRecord, details?: Record<string, unknown>) {
    super(createToolErrorRecord("execution_failed", message, tool, true, undefined, details));
    this.name = "ToolExecutionFailedError";
  }
}

export class ToolExecutionTimeoutError extends ToolRuntimeError {
  constructor(message: string, tool?: ToolReferenceRecord, details?: Record<string, unknown>) {
    super(createToolErrorRecord("timeout", message, tool, true, undefined, details));
    this.name = "ToolExecutionTimeoutError";
  }
}

export class ToolExecutionAbortedError extends ToolRuntimeError {
  constructor(message = "Tool execution was interrupted.", tool?: ToolReferenceRecord) {
    super(createToolErrorRecord("aborted", message, tool, true));
    this.name = "ToolExecutionAbortedError";
  }
}

export function isZodSchema(value: RuntimeToolParameters): value is ZodTypeAny {
  return value instanceof z.ZodType;
}

export function buildToolReference(definition: RuntimeToolDefinition): ToolReferenceRecord {
  return {
    name: definition.name,
    source: definition.source,
    capability: definition.capability,
  };
}

function createToolErrorRecord(
  code: ToolErrorCode,
  message: string,
  tool?: ToolReferenceRecord,
  retryable = false,
  approvalMode?: ToolApprovalMode,
  details?: Record<string, unknown>,
): ToolErrorRecord {
  return {
    code,
    message,
    retryable,
    tool,
    approvalMode,
    details,
  };
}
