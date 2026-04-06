import { type WorkspaceProfile } from "@my-agent/protocol";
import { z, type ZodTypeAny } from "zod";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export type RuntimeToolParameters = ZodTypeAny | JsonSchemaObject;
export type RuntimeToolSource = "local" | "internal";
export type ToolApprovalMode = "none" | "preflight" | "deferred";

export interface ToolExecutionContext {
  workspace: WorkspaceProfile;
  emitCommandDelta: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ToolDescriptorContext {
  workspace: WorkspaceProfile;
}

export interface ToolActionDescriptor {
  preview: string;
  scopeKey: string;
  source: RuntimeToolSource;
  risky?: boolean;
  writes?: boolean;
  network?: boolean;
  paths?: string[];
  approvalReason?: string;
}

export interface RuntimeToolCapabilities {
  streamedOutput?: boolean;
  resumable?: boolean;
  deferApproval?: boolean;
}

export interface RuntimeToolDefinition {
  name: string;
  description: string;
  parameters: RuntimeToolParameters;
  strict: boolean;
  source: RuntimeToolSource;
  capabilities?: RuntimeToolCapabilities;
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
}

export class ApprovalRequiredError extends Error {
  constructor(
    message: string,
    readonly permission: ToolPermissionDecision,
  ) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

export class DeferredApprovalRequiredError extends ApprovalRequiredError {
  constructor(message: string, permission: ToolPermissionDecision) {
    super(message, permission);
    this.name = "DeferredApprovalRequiredError";
  }
}

export class ToolExecutionAbortedError extends Error {
  constructor(message = "Tool execution was interrupted.") {
    super(message);
    this.name = "ToolExecutionAbortedError";
  }
}

export function isZodSchema(value: RuntimeToolParameters): value is ZodTypeAny {
  return value instanceof z.ZodType;
}
