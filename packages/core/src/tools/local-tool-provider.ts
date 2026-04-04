import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { type WorkspaceProfile, type WritePatchResult } from "@my-agent/protocol";
import { z } from "zod";
import { isPathInside } from "../utils/path-utils.js";
import {
  ToolExecutionAbortedError,
  type RuntimeToolDefinition,
  type ToolActionDescriptor,
  type ToolExecutionContext,
  type ToolProvider,
} from "./types.js";

const READ_FILE_SCHEMA = z.object({
  path: z.string(),
});

const SEARCH_CODE_SCHEMA = z.object({
  query: z.string().min(1),
});

const LIST_REPO_TREE_SCHEMA = z.object({
  path: z.string().optional(),
});

const EMPTY_SCHEMA = z.object({});

const RUN_SHELL_SCHEMA = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
});

const WRITE_PATCH_SCHEMA = z.object({
  path: z.string(),
  content: z.string(),
});

const READ_ONLY_GIT_SUBCOMMANDS = new Set(["status", "diff", "show", "log", "branch", "rev-parse", "ls-files"]);
const READ_ONLY_COMMANDS = new Set([
  "dir",
  "ls",
  "pwd",
  "cd",
  "cat",
  "type",
  "echo",
  "rg",
  "findstr",
  "where",
  "which",
  "get-childitem",
  "get-content",
]);
const WRITE_COMMANDS = new Set([
  "rm",
  "del",
  "erase",
  "remove-item",
  "move-item",
  "copy-item",
  "set-content",
  "add-content",
  "out-file",
  "new-item",
  "mkdir",
  "md",
  "touch",
  "mv",
  "cp",
]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "invoke-webrequest", "iwr", "irm", "scp", "ssh", "ftp"]);

export class LocalToolProvider implements ToolProvider {
  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "Read a text file from the current workspace.",
        parameters: READ_FILE_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => READ_FILE_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolve(workspace.rootPath, String(args.path));
          return {
            source: "local",
            preview: `Read ${absolute}`,
            scopeKey: absolute,
            paths: [absolute],
          };
        },
        execute: async (args) => {
          const absolute = resolve(workspace.rootPath, String(args.path));
          return readFileSync(absolute, "utf8");
        },
      },
      {
        name: "search_code",
        description: "Search code and filenames in the current workspace for a query string.",
        parameters: SEARCH_CODE_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => SEARCH_CODE_SCHEMA.parse(input),
        buildDescriptor: (args) => ({
          source: "local",
          preview: `Search code for "${String(args.query)}"`,
          scopeKey: String(args.query).trim().toLowerCase(),
          paths: [workspace.rootPath],
        }),
        execute: async (args) => {
          const query = String(args.query).trim();
          return JSON.stringify(searchWorkspace(workspace.rootPath, query), null, 2);
        },
      },
      {
        name: "list_repo_tree",
        description: "List top-level files and directories in the workspace or a subdirectory.",
        parameters: LIST_REPO_TREE_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => LIST_REPO_TREE_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const target = args.path ? resolve(workspace.rootPath, String(args.path)) : workspace.rootPath;
          return {
            source: "local",
            preview: `List ${target}`,
            scopeKey: target,
            paths: [target],
          };
        },
        execute: async (args) => {
          const target = args.path ? resolve(workspace.rootPath, String(args.path)) : workspace.rootPath;
          return JSON.stringify(
            readdirSync(target, { withFileTypes: true }).map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? "dir" : "file",
            })),
            null,
            2,
          );
        },
      },
      {
        name: "git_status",
        description: "Get git status for the workspace.",
        parameters: EMPTY_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => EMPTY_SCHEMA.parse(input),
        buildDescriptor: () => ({
          source: "local",
          preview: "git status --short --branch",
          scopeKey: "git:status",
          paths: [workspace.rootPath],
        }),
        execute: async (_args, context) => executeCommand("git status --short --branch", context, workspace.rootPath),
      },
      {
        name: "git_diff",
        description: "Get git diff for the workspace.",
        parameters: EMPTY_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => EMPTY_SCHEMA.parse(input),
        buildDescriptor: () => ({
          source: "local",
          preview: "git diff",
          scopeKey: "git:diff",
          paths: [workspace.rootPath],
        }),
        execute: async (_args, context) => executeCommand("git diff", context, workspace.rootPath),
      },
      {
        name: "run_shell",
        description: "Run a shell command inside the workspace.",
        parameters: RUN_SHELL_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => RUN_SHELL_SCHEMA.parse(input),
        buildDescriptor: (args) => buildShellDescriptor(workspace, args),
        execute: async (args, context) => {
          const cwd = args.cwd ? resolve(workspace.rootPath, String(args.cwd)) : workspace.rootPath;
          return executeCommand(String(args.command), context, cwd);
        },
      },
      {
        name: "write_patch",
        description: "Write a full file content to a path, creating parent directories when needed.",
        parameters: WRITE_PATCH_SCHEMA,
        strict: true,
        source: "local",
        parseArgs: (input) => WRITE_PATCH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolve(workspace.rootPath, String(args.path));
          return {
            source: "local",
            preview: `Write ${absolute}`,
            scopeKey: absolute,
            paths: [absolute],
            risky: true,
            writes: true,
            approvalReason: `Writing ${absolute} requires approval.`,
          };
        },
        execute: async (args) => {
          const absolute = resolve(workspace.rootPath, String(args.path));
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, String(args.content), "utf8");
          const result: WritePatchResult = {
            path: absolute,
            bytesWritten: Buffer.byteLength(String(args.content), "utf8"),
          };
          return JSON.stringify(result, null, 2);
        },
      },
    ];
  }
}

function buildShellDescriptor(workspace: WorkspaceProfile, args: Record<string, unknown>): ToolActionDescriptor {
  const command = String(args.command);
  const cwd = args.cwd ? resolve(workspace.rootPath, String(args.cwd)) : workspace.rootPath;
  const analysis = analyzeShellCommand(command, cwd, workspace.rootPath);

  return {
    source: "local",
    preview: command,
    scopeKey: `${cwd}::${analysis.scopeKey}`,
    paths: [cwd, ...analysis.paths],
    risky: true,
    writes: analysis.writes,
    network: analysis.network,
    approvalReason: `Command execution requires approval: ${command}`,
  };
}

function analyzeShellCommand(command: string, cwd: string, workspaceRoot: string): {
  scopeKey: string;
  paths: string[];
  network: boolean;
  writes: boolean;
  safeReadOnly: boolean;
} {
  const tokens = tokenizeCommand(command);
  const lowered = tokens.map((token) => token.toLowerCase());
  const first = lowered[0] ?? "";
  const second = lowered[1] ?? "";
  const hasRedirection = /(^|[^\w])(>>?|2>|out-file)([^\w]|$)/i.test(command);
  const hasGitWrite = first === "git" && ["apply", "checkout", "restore", "clean", "merge", "rebase", "commit", "add"].includes(second);
  const hasPackageWrite =
    ["npm", "pnpm", "yarn", "bun"].includes(first) && ["install", "add", "update", "upgrade", "publish"].includes(second);
  const hasPythonWrite = ["pip", "pip3", "python", "python3"].includes(first) && second === "-m" && lowered[2] === "pip" && lowered[3] === "install";
  const hasCargoWrite = ["cargo", "go"].includes(first) && ["install", "add", "get"].includes(second);
  const writes =
    hasRedirection ||
    hasGitWrite ||
    hasPackageWrite ||
    hasPythonWrite ||
    hasCargoWrite ||
    lowered.some((token) => WRITE_COMMANDS.has(token));
  const network =
    NETWORK_COMMANDS.has(first) ||
    (first === "git" && ["clone", "fetch", "pull", "push"].includes(second)) ||
    hasPackageWrite ||
    hasPythonWrite ||
    hasCargoWrite;
  const safeReadOnly =
    !writes &&
    !network &&
    ((first === "git" && READ_ONLY_GIT_SUBCOMMANDS.has(second)) || READ_ONLY_COMMANDS.has(first));
  const paths = lowered
    .map((_token, index) => tokens[index]!)
    .filter((token) => isAbsolutePathToken(token))
    .map((token) => resolve(cwd, stripWrappingQuotes(token)))
    .filter((path) => path !== workspaceRoot || isPathInside(workspaceRoot, path));

  return {
    scopeKey: normalizeCommandScope(command),
    paths,
    network,
    writes,
    safeReadOnly,
  };
}

function executeCommand(command: string, context: ToolExecutionContext, cwd: string): Promise<string> {
  if (context.workspace.sandboxMode === "read-only") {
    const analysis = analyzeShellCommand(command, cwd, context.workspace.rootPath);

    if (!analysis.safeReadOnly) {
      throw new Error(`Read-only sandbox rejected command: ${command}`);
    }
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnCommand(command, cwd, context.workspace.shell);
    let finished = false;
    let stdout = "";
    let stderr = "";
    const cleanupAbort = attachAbortListener(context.signal, child, () => {
      if (finished) {
        return;
      }

      finished = true;
      rejectPromise(new ToolExecutionAbortedError(`Command interrupted: ${command}`));
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      context.emitCommandDelta(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      context.emitCommandDelta(text);
    });

    child.on("error", (error) => {
      cleanupAbort();

      if (finished) {
        return;
      }

      finished = true;
      rejectPromise(error);
    });

    child.on("close", (code) => {
      cleanupAbort();

      if (finished) {
        return;
      }

      finished = true;
      resolvePromise(
        JSON.stringify(
          {
            code: code ?? -1,
            stdout,
            stderr,
            interrupted: false,
          },
          null,
          2,
        ),
      );
    });
  });
}

function spawnCommand(command: string, cwd: string, shell: string): ChildProcessWithoutNullStreams {
  const normalized = shell.toLowerCase();

  if (normalized.includes("powershell")) {
    return spawn(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  }

  if (normalized.includes("bash")) {
    return spawn(shell, ["-lc", command], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  }

  return spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    windowsHide: true,
  });
}

function attachAbortListener(
  signal: AbortSignal | undefined,
  child: ChildProcessWithoutNullStreams,
  onAbort: () => void,
): () => void {
  if (!signal) {
    return () => undefined;
  }

  if (signal.aborted) {
    void killProcessTree(child);
    onAbort();
    return () => undefined;
  }

  const handler = () => {
    void killProcessTree(child);
    onAbort();
  };

  signal.addEventListener("abort", handler, { once: true });
  return () => signal.removeEventListener("abort", handler);
}

async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed || child.pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      killer.on("close", () => resolvePromise());
      killer.on("error", () => resolvePromise());
    });
    return;
  }

  child.kill("SIGTERM");
}

function searchWorkspace(root: string, query: string): Array<Record<string, unknown>> {
  const loweredQuery = query.toLowerCase();
  const matches: Array<Record<string, unknown>> = [];

  for (const file of walk(root)) {
    const relativePath = file.slice(root.length + 1);

    if (relativePath.toLowerCase().includes(loweredQuery)) {
      matches.push({
        type: "file",
        path: relativePath,
      });
    }

    if (matches.length >= 50) {
      break;
    }

    let content: string;

    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const column = line.toLowerCase().indexOf(loweredQuery);

      if (column === -1) {
        continue;
      }

      matches.push({
        type: "match",
        path: relativePath,
        line: index + 1,
        column: column + 1,
        preview: line.trim().slice(0, 240),
      });

      if (matches.length >= 50) {
        return matches;
      }
    }
  }

  return matches;
}

function walk(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "dist-electron", ".next"].includes(entry.name)) {
      continue;
    }

    const absolute = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walk(absolute));
      continue;
    }

    files.push(absolute);
  }

  return files;
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g);
  return matches ?? [];
}

function isAbsolutePathToken(token: string): boolean {
  const normalized = stripWrappingQuotes(token);
  return /^[a-z]:[\\/]/i.test(normalized) || normalized.startsWith("\\\\") || normalized.startsWith("/");
}

function stripWrappingQuotes(token: string): string {
  return token.replace(/^['"`]|['"`]$/g, "");
}

function normalizeCommandScope(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}
