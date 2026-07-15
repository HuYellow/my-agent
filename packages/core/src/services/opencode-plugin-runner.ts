import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type JsonSchemaObject } from "../tools/types.js";

export interface OpenCodeToolInfo {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

export interface OpenCodeInspection {
  tools: OpenCodeToolInfo[];
  hookNames: string[];
}

export interface OpenCodeBeforeHookResult {
  args?: Record<string, unknown>;
  block?: string;
}

export function inspectOpenCodePlugin(pluginPath: string): OpenCodeInspection {
  const result = runOpenCodePluginSync<OpenCodeInspection>("inspect", pluginPath, {});
  return {
    tools: result.tools ?? [],
    hookNames: result.hookNames ?? [],
  };
}

export async function executeOpenCodePluginTool(pluginPath: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const result = await runOpenCodePlugin("executeTool", pluginPath, { toolName, args });
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

export async function runOpenCodeBeforeHooks(pluginPaths: string[], toolName: string, args: Record<string, unknown>): Promise<OpenCodeBeforeHookResult> {
  let currentArgs = args;

  for (const pluginPath of pluginPaths) {
    const result = await runOpenCodePlugin("beforeTool", pluginPath, { toolName, args: currentArgs });
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const record = result as Record<string, unknown>;
      if (typeof record.block === "string" && record.block.trim()) {
        return { block: record.block };
      }

      if (record.args && typeof record.args === "object" && !Array.isArray(record.args)) {
        currentArgs = record.args as Record<string, unknown>;
      }
    }
  }

  return currentArgs === args ? {} : { args: currentArgs };
}

export async function runOpenCodeAfterHooks(
  pluginPaths: string[],
  toolName: string,
  args: Record<string, unknown>,
  result: { output?: string; error?: string },
): Promise<void> {
  for (const pluginPath of pluginPaths) {
    await runOpenCodePlugin("afterTool", pluginPath, { toolName, args, ...result });
  }
}

export async function collectOpenCodeShellEnv(pluginPaths: string[]): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  for (const pluginPath of pluginPaths) {
    const result = await runOpenCodePlugin("shellEnv", pluginPath, {});
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      continue;
    }

    for (const [key, value] of Object.entries(result)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
  }

  return env;
}

function runOpenCodePluginSync<T>(action: string, pluginPath: string, payload: Record<string, unknown>): T {
  const result = spawnSync(process.execPath, runtimeArgs(action, pluginPath), {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 20_000,
    env: process.env,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `OpenCode plugin runtime failed with exit code ${result.status}`);
  }

  return JSON.parse(result.stdout || "{}") as T;
}

function runOpenCodePlugin(action: string, pluginPath: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, runtimeArgs(action, pluginPath), {
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
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
        rejectPromise(new Error(stderr.trim() || stdout.trim() || `OpenCode plugin runtime failed with exit code ${code}`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout || "null"));
      } catch (error) {
        rejectPromise(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function runtimeArgs(action: string, pluginPath: string): string[] {
  return ["--experimental-strip-types", runtimePath(), action, pluginPath];
}

function runtimePath(): string {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith(".ts")) {
    return current.replace(/opencode-plugin-runner\.ts$/, "opencode-plugin-runtime.ts");
  }

  return current.replace(/opencode-plugin-runner\.js$/, "opencode-plugin-runtime.js");
}
