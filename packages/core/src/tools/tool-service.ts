import { type ToolCatalogRecord, type WorkspaceProfile } from "@yellow-flow/protocol";
import { ZodError } from "zod";
import { HarnessDatabase } from "../store/database.js";
import { InternalToolProvider } from "./internal-tool-provider.js";
import { LocalToolProvider } from "./local-tool-provider.js";
import { McpToolProvider } from "./mcp-tool-provider.js";
import { PluginToolProvider } from "./plugin-tool-provider.js";
import { SandboxPolicy } from "./sandbox-policy.js";
import { McpManager } from "../services/mcp-manager.js";
import { collectOpenCodeShellEnv, runOpenCodeAfterHooks, runOpenCodeBeforeHooks } from "../services/opencode-plugin-runner.js";
import { isPluginRunnable } from "../services/plugin-registry.js";
import {
  ApprovalRequiredError,
  buildToolReference,
  DeferredApprovalRequiredError,
  type PlannedToolExecution,
  type RuntimeToolDefinition,
  ToolBlockedError,
  type ToolExecutionContext,
  ToolExecutionAbortedError,
  ToolExecutionFailedError,
  ToolExecutionTimeoutError,
  type ToolProvider,
  ToolRuntimeError,
  ToolValidationError,
} from "./types.js";

interface ToolServiceOptions {
  database?: HarnessDatabase;
  threadId?: string;
  homeDir?: string;
  mcpManager?: McpManager;
}

export class ToolService {
  private readonly providers: ToolProvider[];
  private readonly sandboxPolicy = new SandboxPolicy();

  constructor(
    private readonly workspace: WorkspaceProfile,
    private readonly options: ToolServiceOptions = {},
  ) {
    this.providers = [
      new LocalToolProvider(),
      new InternalToolProvider(options.homeDir, options.database),
      new PluginToolProvider(options.database, options.homeDir),
      new McpToolProvider(options.database, options.mcpManager),
    ];
  }

  getDefinitions(): RuntimeToolDefinition[] {
    return this.providers
      .flatMap((provider) => provider.listTools(this.workspace))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getDefinition(name: string): RuntimeToolDefinition | undefined {
    return this.getDefinitions().find((definition) => definition.name === name);
  }

  getCatalog(): ToolCatalogRecord[] {
    return this.getDefinitions().map((definition) => ({
      ...buildToolReference(definition),
      description: definition.description,
      enabled: true,
      parametersSchema: isSchemaObject(definition.parameters) ? definition.parameters.properties : undefined,
    }));
  }

  planExecution(name: string, input: unknown): PlannedToolExecution {
    const definition = this.getDefinition(name);

    if (!definition) {
      throw new ToolValidationError(`Unknown tool definition: ${name}`);
    }

    let args: Record<string, unknown>;

    try {
      args = definition.parseArgs(input);
    } catch (error) {
      throw this.normalizeError(error, buildToolReference(definition));
    }

    const descriptor = definition.buildDescriptor(args, { workspace: this.workspace });
    const approvalKey = `${definition.name}:${descriptor.scopeKey}`;
    const sessionApproved =
      this.options.threadId && this.options.database
        ? this.options.database.hasApprovalRule(this.options.threadId, definition.name, approvalKey)
        : false;
    let permission = this.sandboxPolicy.evaluate(descriptor, this.workspace, {
      sessionApproved,
    });

    if (permission.approvalMode === "deferred" && !definition.capability.approvalModes.includes("deferred")) {
      permission = {
        ...permission,
        approvalMode: "preflight",
        requiresApproval: true,
      };
    }

    return {
      definition,
      args,
      descriptor,
      tool: buildToolReference(definition),
      permission: {
        ...permission,
        approvalKey,
      },
    };
  }

  async executeTool(name: string, input: unknown, context: ToolExecutionContext): Promise<string> {
    const plan = this.planExecution(name, input);
    return this.executePlanned(plan, context);
  }

  async executePlanned(plan: PlannedToolExecution, context: ToolExecutionContext): Promise<string> {
    const hookPluginPaths = this.getTrustedOpenCodePluginPaths();
    let effectivePlan = plan;

    if (hookPluginPaths.length > 0) {
      const before = await runOpenCodeBeforeHooks(hookPluginPaths, plan.definition.name, plan.args);

      if (before.block) {
        throw new ToolBlockedError(before.block, plan.tool);
      }

      if (before.args) {
        effectivePlan = this.planExecution(plan.definition.name, before.args);
      }
    }

    if (!effectivePlan.permission.allowed) {
      throw new ToolBlockedError(
        effectivePlan.permission.denialReason ?? `Tool ${effectivePlan.definition.name} is blocked by the current sandbox policy.`,
        effectivePlan.tool,
      );
    }

    if (effectivePlan.permission.requiresApproval) {
      throw new ApprovalRequiredError(
        effectivePlan.permission.approvalReason ?? `Tool ${effectivePlan.definition.name} requires approval before it can run.`,
        effectivePlan.permission,
        effectivePlan.tool,
      );
    }

    if (effectivePlan.permission.approvalMode === "deferred") {
      throw new DeferredApprovalRequiredError(
        effectivePlan.permission.approvalReason ?? `Tool ${effectivePlan.definition.name} requires approval before it can be retried.`,
        effectivePlan.permission,
        effectivePlan.tool,
      );
    }

    try {
      const env = effectivePlan.definition.name === "run_shell" && hookPluginPaths.length > 0 ? await collectOpenCodeShellEnv(hookPluginPaths) : undefined;
      const output = await effectivePlan.definition.execute(effectivePlan.args, { ...context, env: { ...context.env, ...env } });
      if (hookPluginPaths.length > 0) {
        await runOpenCodeAfterHooks(hookPluginPaths, effectivePlan.definition.name, effectivePlan.args, { output });
      }
      return output;
    } catch (error) {
      if (hookPluginPaths.length > 0) {
        await runOpenCodeAfterHooks(hookPluginPaths, effectivePlan.definition.name, effectivePlan.args, {
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
      throw this.normalizeError(error, effectivePlan.tool);
    }
  }

  rememberSessionApproval(threadId: string, toolName: string, approvalKey: string): void {
    if (!this.options.database) {
      return;
    }

    this.options.database.upsertApprovalRule({
      threadId,
      toolName,
      approvalKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  forgetSessionApprovals(threadId: string): void {
    this.options.database?.clearApprovalRules(threadId);
  }

  static approvalReason(toolName: string, approvalReason: string | undefined): string {
    return approvalReason ?? `Tool ${toolName} requires approval.`;
  }

  private normalizeError(error: unknown, tool?: PlannedToolExecution["tool"]): ToolRuntimeError {
    if (error instanceof ToolRuntimeError) {
      return error;
    }

    if (error instanceof ZodError) {
      return new ToolValidationError(error.message, tool, {
        issues: error.issues.map((issue) => ({
          path: issue.path.map((segment) => String(segment)),
          message: issue.message,
          code: issue.code,
        })),
      });
    }

    if (looksLikeAbortError(error)) {
      return new ToolExecutionAbortedError(error instanceof Error ? error.message : "Tool execution was interrupted.", tool);
    }

    if (looksLikeTimeoutError(error)) {
      return new ToolExecutionTimeoutError(error instanceof Error ? error.message : "Tool execution timed out.", tool);
    }

    if (error instanceof Error) {
      return new ToolExecutionFailedError(error.message, tool);
    }

    return new ToolExecutionFailedError(String(error), tool);
  }

  private getTrustedOpenCodePluginPaths(): string[] {
    return (this.options.database?.listPlugins() ?? [])
      .filter((plugin) => plugin.format === "opencode" && isPluginRunnable(plugin))
      .map((plugin) => plugin.path);
  }
}

function isSchemaObject(value: RuntimeToolDefinition["parameters"]): value is Extract<RuntimeToolDefinition["parameters"], { type: "object" }> {
  return typeof value === "object" && value !== null && "type" in value && value.type === "object";
}

function looksLikeTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return name.includes("timeout") || message.includes("timed out") || message.includes("timeout");
}

function looksLikeAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return name === "aborterror" || message.includes("interrupted") || message.includes("aborted");
}
