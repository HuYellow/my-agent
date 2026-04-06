import { type HarnessDatabase } from "../store/database.js";
import { type WorkspaceProfile } from "@my-agent/protocol";
import { type JsonSchemaObject, type RuntimeToolDefinition, type ToolProvider } from "./types.js";
import { McpManager } from "../services/mcp-manager.js";

export class McpToolProvider implements ToolProvider {
  constructor(
    private readonly database?: HarnessDatabase,
    private readonly mcpManager?: McpManager,
  ) {}

  listTools(_workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    const manager = this.resolveManager();

    if (!this.database || !manager) {
      return [];
    }

    const mounts = manager.list().filter((mount) => mount.enabled);

    return mounts.flatMap((mount) => {
      const cached = manager.getCachedMountData(mount.id);
      return cached.tools.map((tool) => ({
        name: `mcp_${sanitizeToolName(mount.name)}_${sanitizeToolName(tool.name)}`,
        description: `${tool.description} (via MCP mount ${mount.name})`,
        parameters: tool.inputSchema as JsonSchemaObject,
        strict: true,
        source: "internal",
        capabilities: {
          deferApproval: false,
        },
        parseArgs: (input) => (typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {}),
        buildDescriptor: (args) => ({
          source: "internal",
          preview: `${mount.name}:${tool.name}`,
          scopeKey: `${mount.id}:${tool.name}:${JSON.stringify(args)}`,
          risky: true,
          network: true,
          approvalReason: `MCP tool ${tool.name} from ${mount.name} requires approval.`,
        }),
        execute: async (args) => manager.callTool(mount.id, tool.name, args),
      }));
    });
  }

  private resolveManager(): McpManager | null {
    if (this.mcpManager) {
      return this.mcpManager;
    }

    if (!this.database) {
      return null;
    }

    return new McpManager(this.database, () => undefined);
  }
}

function sanitizeToolName(value: string): string {
  return value.replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
}
