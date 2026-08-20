import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { type ApplyPatchResult, type WorkspaceProfile, type WritePatchResult } from "@yellow-flow/protocol";
import { executePatchDocument } from "./patch-apply.js";

const IGNORED_DIR_NAMES = new Set([".git", "node_modules", "dist", "dist-electron", ".next", ".turbo", ".cache"]);

export function resolveWorkspacePath(rootPath: string, targetPath: string): string {
  const absolute = resolve(rootPath, targetPath);

  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

export function collectPathCandidates(absolutePath: string): string[] {
  try {
    const real = realpathSync.native(absolutePath);
    return real === absolutePath ? [absolutePath] : [absolutePath, real];
  } catch {
    return [absolutePath];
  }
}

export function readFileRange(rootPath: string, path: string, startLine: number, endLine?: number) {
  const absolute = resolveWorkspacePath(rootPath, path);
  const lines = readFileSync(absolute, "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = Math.max(1, startLine);
  const end = Math.max(start, endLine ?? startLine);

  return {
    path: absolute,
    startLine: start,
    endLine: end,
    content: lines.slice(start - 1, end).join("\n"),
  };
}

export function statPath(rootPath: string, path: string) {
  const absolute = resolveWorkspacePath(rootPath, path);
  const stats = statSync(absolute);

  return {
    path: absolute,
    type: stats.isDirectory() ? "dir" : stats.isFile() ? "file" : "other",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

export function listRepoTree(rootPath: string, relativeTarget: string | undefined, recursive: boolean, maxDepth: number, includeHidden: boolean) {
  const basePath = relativeTarget ? resolve(rootPath, relativeTarget) : rootPath;
  const target = relativeTarget ? resolveWorkspacePath(rootPath, relativeTarget) : rootPath;
  return walkTree(basePath, target, recursive, maxDepth, includeHidden, 0).map((entry) => ({
    ...entry,
    path: String(entry.path).replace(/\\/g, "/"),
  }));
}

function walkTree(rootPath: string, currentPath: string, recursive: boolean, maxDepth: number, includeHidden: boolean, depth: number): Array<Record<string, unknown>> {
  if (depth > maxDepth) {
    return [];
  }

  const entries = readdirSync(currentPath, { withFileTypes: true });
  const results: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    if (!includeHidden && entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory() && IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }

    const absolute = join(currentPath, entry.name);
    const relative = absolute.slice(rootPath.length + (rootPath.endsWith("\\") || rootPath.endsWith("/") ? 0 : 1));

    results.push({
      name: entry.name,
      path: relative || entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      depth,
    });

    if (recursive && entry.isDirectory()) {
      results.push(...walkTree(rootPath, absolute, recursive, maxDepth, includeHidden, depth + 1));
    }
  }

  return results;
}

export function findFiles(rootPath: string, pattern: string, relativeTarget?: string, limit = 200): string[] {
  const matcher = createGlobMatcher(pattern);
  const startPath = relativeTarget ? resolveWorkspacePath(rootPath, relativeTarget) : rootPath;
  const files: string[] = [];

  for (const file of walkFiles(startPath)) {
    const relative = file.slice(rootPath.length + 1).replace(/\\/g, "/");

    if (matcher(relative)) {
      files.push(relative);
    }

    if (files.length >= limit) {
      break;
    }
  }

  return files;
}

export function searchWorkspace(
  rootPath: string,
  options: {
    query: string;
    path?: string;
    regex: boolean;
    filePattern?: string;
    limit: number;
  },
): Array<Record<string, unknown>> {
  const rgResult = searchWithRipgrep(rootPath, options);

  if (rgResult) {
    return rgResult;
  }

  const startPath = options.path ? resolveWorkspacePath(rootPath, options.path) : rootPath;
  const matcher = options.filePattern ? createGlobMatcher(options.filePattern) : undefined;
  const results: Array<Record<string, unknown>> = [];
  const regex = options.regex ? new RegExp(options.query, "i") : undefined;
  const loweredQuery = options.query.toLowerCase();

  for (const file of walkFiles(startPath)) {
    const relative = file.slice(rootPath.length + 1).replace(/\\/g, "/");

    if (matcher && !matcher(relative)) {
      continue;
    }

    if (relative.toLowerCase().includes(loweredQuery)) {
      results.push({ type: "file", path: relative });
    }

    if (results.length >= options.limit) {
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
      const line = lines[index] ?? "";
      const matched = regex ? regex.exec(line) : line.toLowerCase().indexOf(loweredQuery);

      if ((typeof matched === "number" && matched === -1) || matched === null) {
        continue;
      }

      results.push({
        type: "match",
        path: relative,
        line: index + 1,
        column: typeof matched === "number" ? matched + 1 : (matched.index ?? 0) + 1,
        preview: line.trim().slice(0, 240),
      });

      if (results.length >= options.limit) {
        return results;
      }
    }
  }

  return results;
}

function searchWithRipgrep(
  rootPath: string,
  options: {
    query: string;
    path?: string;
    regex: boolean;
    filePattern?: string;
    limit: number;
  },
): Array<Record<string, unknown>> | null {
  const cwd = options.path ? resolveWorkspacePath(rootPath, options.path) : rootPath;
  const args = ["--json", "--line-number", "--column", "--max-count", String(options.limit)];

  if (!options.regex) {
    args.push("--fixed-strings");
  }

  if (options.filePattern) {
    args.push("--glob", options.filePattern);
  }

  args.push(options.query, ".");

  try {
    const result = BunLikeSpawnSync("rg", args, cwd);

    if (!result) {
      return null;
    }

    const matches: Array<Record<string, unknown>> = [];

    for (const line of result.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      if (parsed.type !== "match") {
        continue;
      }

      const data = parsed.data as {
        path?: { text?: string };
        line_number?: number;
        submatches?: Array<{ start?: number }>;
        lines?: { text?: string };
      };

      matches.push({
        type: "match",
        path: data.path?.text?.replace(/\\/g, "/") ?? "",
        line: data.line_number ?? 0,
        column: (data.submatches?.[0]?.start ?? 0) + 1,
        preview: (data.lines?.text ?? "").trim().slice(0, 240),
      });
    }

    return matches;
  } catch {
    return null;
  }
}

export function applyPatchOperations(rootPath: string, patch: string): ApplyPatchResult {
  const operations = planPatchOperations(rootPath, patch);
  const files: ApplyPatchResult["files"] = [];

  for (const operation of operations) {
    const currentPath = resolveWorkspacePath(rootPath, operation.path);

    if (operation.action === "delete") {
      rmSync(currentPath, { recursive: true, force: false });
      files.push({ path: currentPath, action: "delete" });
      continue;
    }

    if (operation.action === "move" && operation.moveTo) {
      const targetPath = resolveWorkspacePath(rootPath, operation.moveTo);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(currentPath, operation.content ?? "", "utf8");
      renameSync(currentPath, targetPath);
      files.push({
        path: targetPath,
        action: "move",
        bytesWritten: Buffer.byteLength(operation.content ?? "", "utf8"),
      });
      continue;
    }

    mkdirSync(dirname(currentPath), { recursive: true });
    writeFileSync(currentPath, operation.content ?? "", "utf8");
    files.push({
      path: currentPath,
      action: operation.action,
      bytesWritten: Buffer.byteLength(operation.content ?? "", "utf8"),
    });
  }

  return { files };
}

export function planPatchOperations(rootPath: string, patch: string) {
  return executePatchDocument(patch, {
    readFile: (path) => readFileSync(resolveWorkspacePath(rootPath, path), "utf8"),
    fileExists: (path) => existsSync(resolveWorkspacePath(rootPath, path)),
  });
}

export function writeWholeFile(rootPath: string, path: string, content: string): WritePatchResult {
  const absolute = resolveWorkspacePath(rootPath, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
  return {
    path: absolute,
    bytesWritten: Buffer.byteLength(content, "utf8"),
  };
}

export function moveWorkspacePath(rootPath: string, from: string, to: string): { from: string; to: string } {
  const source = resolveWorkspacePath(rootPath, from);
  const target = resolveWorkspacePath(rootPath, to);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  return { from: source, to: target };
}

export function deleteWorkspacePath(rootPath: string, path: string, recursive = true): { path: string; deleted: true } {
  const absolute = resolveWorkspacePath(rootPath, path);
  rmSync(absolute, { recursive, force: false });
  return { path: absolute, deleted: true as const };
}

function walkFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory() && IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }

    const absolute = join(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
      continue;
    }

    files.push(absolute);
  }

  return files;
}

function createGlobMatcher(pattern: string): (value: string) => boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${escaped}$`, "i");
  return (value) => regex.test(value.replace(/\\/g, "/"));
}

function BunLikeSpawnSync(command: string, args: string[], cwd: string): string | null {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.error || typeof result.stdout !== "string" ? null : result.stdout;
}
