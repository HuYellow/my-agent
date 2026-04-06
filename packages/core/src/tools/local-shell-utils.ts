import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { type ToolExecutionContext, ToolExecutionAbortedError } from "./types.js";

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
  "tee",
]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "invoke-webrequest", "iwr", "irm", "scp", "ssh", "ftp"]);
const PRIVILEGED_COMMANDS = new Set(["sudo", "doas", "runas"]);

export function buildShellAnalysis(command: string, cwd: string, workspaceRoot: string): {
  scopeKey: string;
  paths: string[];
  network: boolean;
  writes: boolean;
  privileged: boolean;
  safeReadOnly: boolean;
} {
  const tokens = tokenizeCommand(command);
  const lowered = tokens.map((token) => token.toLowerCase());
  const first = lowered[0] ?? "";
  const second = lowered[1] ?? "";
  const hasRedirection = /(^|[^\w])(>>?|[12]?>|out-file|tee-object)([^\w]|$)/i.test(command);
  const hasGitWrite = first === "git" && ["apply", "checkout", "restore", "clean", "merge", "rebase", "commit", "add", "stash"].includes(second);
  const hasPackageWrite =
    ["npm", "pnpm", "yarn", "bun"].includes(first) && ["install", "add", "update", "upgrade", "publish", "remove"].includes(second);
  const hasPythonWrite = ["pip", "pip3", "python", "python3"].includes(first) && second === "-m" && lowered[2] === "pip" && ["install", "uninstall"].includes(lowered[3] ?? "");
  const hasCargoWrite = ["cargo", "go"].includes(first) && ["install", "add", "get"].includes(second);
  const privileged =
    PRIVILEGED_COMMANDS.has(first) ||
    (/start-process/i.test(command) && /-verb\s+runas/i.test(command)) ||
    lowered.includes("set-executionpolicy");
  const writes =
    privileged ||
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
    !privileged &&
    ((first === "git" && READ_ONLY_GIT_SUBCOMMANDS.has(second)) || READ_ONLY_COMMANDS.has(first));
  const paths = lowered
    .map((_token, index) => tokens[index] ?? "")
    .filter((token) => isLikelyPathToken(token))
    .map((token) => resolve(cwd, stripWrappingQuotes(token)))
    .filter((path, index, values) => values.indexOf(path) === index)
    .filter((path) => path === workspaceRoot || path.startsWith(workspaceRoot));

  return {
    scopeKey: normalizeCommandScope(command),
    paths,
    network,
    writes,
    privileged,
    safeReadOnly,
  };
}

export function executeShellCommand(command: string, context: ToolExecutionContext, cwd: string): Promise<string> {
  if (context.workspace.sandboxMode === "read-only") {
    const analysis = buildShellAnalysis(command, cwd, context.workspace.rootPath);

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

export function quoteShellArg(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g);
  return matches ?? [];
}

function isLikelyPathToken(token: string): boolean {
  const normalized = stripWrappingQuotes(token);
  return (
    /^[a-z]:[\\/]/i.test(normalized) ||
    normalized.startsWith("\\\\") ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  );
}

function stripWrappingQuotes(token: string): string {
  return token.replace(/^['"`]|['"`]$/g, "");
}

function normalizeCommandScope(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}
