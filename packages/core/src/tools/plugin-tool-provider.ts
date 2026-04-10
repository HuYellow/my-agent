import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { type WorkspaceProfile } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { discoverPluginEntries, type PluginManifest } from "../services/plugin-registry.js";
import { ToolExecutionAbortedError, type RuntimeToolCapability, type RuntimeToolDefinition, type RuntimeToolSourceMetadata, type ToolProvider } from "./types.js";

export class PluginToolProvider implements ToolProvider {
  constructor(
    private readonly database?: HarnessDatabase,
    private readonly homeDir = process.env.MY_AGENT_HOME ?? join(homedir(), ".my-agent"),
  ) {}

  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    return discoverPluginEntries({
      workspaceRoot: workspace.rootPath,
      persisted: this.database?.listPlugins(),
      homeDir: this.homeDir,
    }).flatMap(({ manifest: plugin, record }) => {
      if (!plugin || !record.enabled || !record.trusted || record.validationErrors.length > 0 || !plugin.command || !plugin.tool) {
        return [];
      }

      const source = buildPluginSource(plugin, record.path, record.manifestPath);

      return [
        {
          name: plugin.tool.name,
          description: plugin.tool.description,
          parameters: plugin.tool.parameters,
          strict: true,
          source,
          capability: buildPluginCapability(plugin),
          parseArgs: (input) => (typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {}),
          buildDescriptor: (args) => ({
            source,
            preview: `${plugin.name}:${plugin.tool?.name}`,
            scopeKey: `${plugin.name}:${plugin.tool?.name}:${JSON.stringify(args)}`,
            paths: [workspace.rootPath],
            risky: true,
            writes: plugin.sandboxMode !== "read-only",
            network: plugin.capabilities?.some((entry) => /network/i.test(entry)) ?? false,
            timeoutMs: 30_000,
            approvalReason: `Plugin tool ${plugin.tool?.name} from ${plugin.name} requires approval.`,
          }),
          execute: async (args, context) =>
            executePluginCommand(plugin.command!, plugin.args ?? [], {
              ...args,
              cwd: workspace.rootPath,
            }, { signal: context.signal, timeoutMs: 30_000 }),
        },
      ];
    });
  }
}

function executePluginCommand(
  command: string,
  args: string[],
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: typeof payload.cwd === "string" ? payload.cwd : process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    let finished = false;
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill();
      const error = new Error(`Plugin command timed out after ${options.timeoutMs ?? 30_000}ms.`);
      error.name = "TimeoutError";
      rejectPromise(error);
    }, options.timeoutMs ?? 30_000);
    const cleanup = attachAbortListener(options.signal, child, () => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      rejectPromise(new ToolExecutionAbortedError(`Plugin command interrupted: ${command}`));
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      cleanup();
      clearTimeout(timeout);
      if (finished) {
        return;
      }
      finished = true;
      rejectPromise(error);
    });
    child.on("close", (code) => {
      cleanup();
      clearTimeout(timeout);
      if (finished) {
        return;
      }
      finished = true;
      if ((code ?? 1) !== 0) {
        rejectPromise(new Error(stderr.trim() || stdout.trim() || `Plugin command failed with exit code ${code}`));
        return;
      }
      resolvePromise(stdout.trim() || JSON.stringify(payload));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function buildPluginSource(plugin: PluginManifest, pluginPath: string, manifestPath: string): RuntimeToolSourceMetadata {
  return {
    type: "plugin",
    id: plugin.name,
    label: plugin.name,
    path: manifestPath,
    details: {
      version: plugin.version,
      command: pluginPath,
    },
  };
}

function buildPluginCapability(plugin: PluginManifest): RuntimeToolCapability {
  const network = plugin.capabilities?.some((entry) => /network/i.test(entry)) ?? false;
  const writes = plugin.sandboxMode !== "read-only";
  return {
    writes,
    network,
    interactive: false,
    approvalModes: ["preflight", "deferred"],
    riskLevel: network ? "network" : writes ? "write" : "safe_read",
    timeoutMs: 30_000,
    streamedOutput: true,
    resumable: false,
  };
}

function attachAbortListener(
  signal: AbortSignal | undefined,
  child: ReturnType<typeof spawn>,
  onAbort: () => void,
): () => void {
  if (!signal) {
    return () => undefined;
  }

  if (signal.aborted) {
    child.kill();
    onAbort();
    return () => undefined;
  }

  const handler = () => {
    child.kill();
    onAbort();
  };

  signal.addEventListener("abort", handler, { once: true });
  return () => signal.removeEventListener("abort", handler);
}
