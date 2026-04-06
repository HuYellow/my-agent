import { type WorkspaceProfile } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { InternalToolProvider } from "./internal-tool-provider.js";
import { LocalToolProvider } from "./local-tool-provider.js";
import { McpToolProvider } from "./mcp-tool-provider.js";
import { PluginToolProvider } from "./plugin-tool-provider.js";
import { SandboxPolicy } from "./sandbox-policy.js";
import { McpManager } from "../services/mcp-manager.js";
import {
  ApprovalRequiredError,
  DeferredApprovalRequiredError,
  type PlannedToolExecution,
  type RuntimeToolDefinition,
  type ToolExecutionContext,
  type ToolProvider,
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
      new InternalToolProvider(options.homeDir),
      new PluginToolProvider(),
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

  planExecution(name: string, input: unknown): PlannedToolExecution {
    const definition = this.getDefinition(name);

    if (!definition) {
      throw new Error(`Unknown tool definition: ${name}`);
    }

    const args = definition.parseArgs(input);
    const descriptor = definition.buildDescriptor(args, { workspace: this.workspace });
    const approvalKey = `${definition.name}:${descriptor.scopeKey}`;
    const sessionApproved =
      this.options.threadId && this.options.database
        ? this.options.database.hasApprovalRule(this.options.threadId, definition.name, approvalKey)
        : false;
    let permission = this.sandboxPolicy.evaluate(descriptor, this.workspace, {
      sessionApproved,
    });

    if (permission.approvalMode === "deferred" && definition.capabilities?.deferApproval === false) {
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
    if (!plan.permission.allowed) {
      throw new Error(plan.permission.denialReason ?? `Tool ${plan.definition.name} is blocked by the current sandbox policy.`);
    }

    if (plan.permission.requiresApproval) {
      throw new ApprovalRequiredError(
        plan.permission.approvalReason ?? `Tool ${plan.definition.name} requires approval before it can run.`,
        plan.permission,
      );
    }

    if (plan.permission.approvalMode === "deferred") {
      throw new DeferredApprovalRequiredError(
        plan.permission.approvalReason ?? `Tool ${plan.definition.name} requires approval before it can be retried.`,
        plan.permission,
      );
    }

    return plan.definition.execute(plan.args, context);
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
}
