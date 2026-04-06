import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { type WorkspaceProfile } from "@my-agent/protocol";
import { z } from "zod";
import { findGitRoot } from "../utils/path-utils.js";
import { type RuntimeToolDefinition, type ToolProvider } from "./types.js";

const PLUGIN_MANIFEST_SCHEMA = z.object({
  name: z.string().min(1),
  version: z.string().default("0.0.0"),
  enabled: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
  sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  tool: z
    .object({
      name: z.string().min(1),
      description: z.string().min(1),
      parameters: z
        .object({
          type: z.literal("object"),
          properties: z.record(z.string(), z.unknown()).default({}),
          required: z.array(z.string()).optional(),
          additionalProperties: z.boolean().optional(),
        })
        .default({ type: "object", properties: {}, additionalProperties: true }),
    })
    .optional(),
});

type PluginManifest = z.infer<typeof PLUGIN_MANIFEST_SCHEMA>;

export class PluginToolProvider implements ToolProvider {
  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    return loadPluginManifests(workspace).flatMap((plugin) => {
      if (plugin.enabled === false || !plugin.command || !plugin.tool) {
        return [];
      }

      return [
        {
          name: plugin.tool.name,
          description: plugin.tool.description,
          parameters: plugin.tool.parameters,
          strict: true,
          source: "internal",
          capabilities: {
            streamedOutput: true,
            deferApproval: true,
          },
          parseArgs: (input) => (typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {}),
          buildDescriptor: (args) => ({
            source: "internal",
            preview: `${plugin.name}:${plugin.tool?.name}`,
            scopeKey: `${plugin.name}:${plugin.tool?.name}:${JSON.stringify(args)}`,
            paths: [workspace.rootPath],
            risky: true,
            writes: plugin.sandboxMode !== "read-only",
            network: false,
            approvalReason: `Plugin tool ${plugin.tool?.name} from ${plugin.name} requires approval.`,
          }),
          execute: async (args) =>
            executePluginCommand(plugin.command!, plugin.args ?? [], {
              ...args,
              cwd: workspace.rootPath,
            }),
        },
      ];
    });
  }
}

function loadPluginManifests(workspace: WorkspaceProfile): PluginManifest[] {
  const roots = [join(homedir(), ".my-agent", "plugins")];
  const repoRoot = findGitRoot(workspace.rootPath);
  if (repoRoot) {
    roots.push(join(repoRoot, ".agents", "plugins"));
    roots.push(join(repoRoot, ".codex", "plugins"));
  }

  const manifests: PluginManifest[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPathCandidates = [join(root, entry.name, ".codex-plugin", "plugin.json"), join(root, entry.name, "plugin.json")];
      const manifestPath = manifestPathCandidates.find((candidate) => existsSync(candidate));
      if (!manifestPath) {
        continue;
      }
      manifests.push(PLUGIN_MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(manifestPath, "utf8"))));
    }
  }

  return manifests;
}

function executePluginCommand(command: string, args: string[], payload: Record<string, unknown>): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: typeof payload.cwd === "string" ? payload.cwd : process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        rejectPromise(new Error(stderr.trim() || stdout.trim() || `Plugin command failed with exit code ${code}`));
        return;
      }
      resolvePromise(stdout.trim() || JSON.stringify(payload));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
