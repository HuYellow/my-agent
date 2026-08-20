import { existsSync, readFileSync } from "node:fs";
import { type WorkspaceProfile } from "@yellow-flow/protocol";
import { z } from "zod";
import {
  type RuntimeToolCapability,
  type RuntimeToolSourceMetadata,
  type RuntimeToolDefinition,
  type ToolActionDescriptor,
  type ToolProvider,
} from "./types.js";
import { buildShellAnalysis, executeShellCommand, quoteShellArg } from "./local-shell-utils.js";
import {
  applyPatchOperations,
  collectPathCandidates,
  deleteWorkspacePath,
  findFiles,
  listRepoTree,
  moveWorkspacePath,
  planPatchOperations,
  readFileRange,
  resolveWorkspacePath,
  searchWorkspace,
  statPath,
  writeWholeFile,
} from "./local-tool-utils.js";

const READ_FILE_SCHEMA = z.object({
  path: z.string(),
});

const READ_FILE_RANGE_SCHEMA = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
});

const EXISTS_PATH_SCHEMA = z.object({
  path: z.string(),
});

const STAT_PATH_SCHEMA = z.object({
  path: z.string(),
});

const SEARCH_CODE_SCHEMA = z.object({
  query: z.string().min(1),
  path: z.string().optional(),
  regex: z.boolean().optional(),
  filePattern: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const FIND_FILES_SCHEMA = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const LIST_REPO_TREE_SCHEMA = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
  maxDepth: z.number().int().nonnegative().max(20).optional(),
  includeHidden: z.boolean().optional(),
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

const APPLY_PATCH_SCHEMA = z.object({
  patch: z.string().min(1),
});

const MOVE_PATH_SCHEMA = z.object({
  from: z.string(),
  to: z.string(),
});

const DELETE_PATH_SCHEMA = z.object({
  path: z.string(),
  recursive: z.boolean().optional(),
});

const GIT_ADD_SCHEMA = z.object({
  paths: z.array(z.string()).min(1),
});

const GIT_COMMIT_SCHEMA = z.object({
  message: z.string().min(1),
});

const LOCAL_TOOL_SOURCE: RuntimeToolSourceMetadata = {
  type: "local",
  label: "Local workspace",
};

export class LocalToolProvider implements ToolProvider {
  listTools(workspace: WorkspaceProfile): RuntimeToolDefinition[] {
    return [
      {
        name: "read_file",
        description: "Read a text file from the current workspace.",
        parameters: READ_FILE_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => READ_FILE_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolveWorkspacePath(workspace.rootPath, String(args.path));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Read ${absolute}`,
            scopeKey: absolute,
            paths: collectPathCandidates(absolute),
          };
        },
        execute: async (args) => readFileSync(resolveWorkspacePath(workspace.rootPath, String(args.path)), "utf8"),
      },
      {
        name: "read_file_range",
        description: "Read a line range from a text file in the current workspace.",
        parameters: READ_FILE_RANGE_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => READ_FILE_RANGE_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolveWorkspacePath(workspace.rootPath, String(args.path));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Read ${absolute}:${args.startLine}-${args.endLine ?? args.startLine}`,
            scopeKey: `${absolute}:${args.startLine}:${args.endLine ?? args.startLine}`,
            paths: collectPathCandidates(absolute),
          };
        },
        execute: async (args) =>
          JSON.stringify(
            readFileRange(workspace.rootPath, String(args.path), Number(args.startLine), typeof args.endLine === "number" ? args.endLine : undefined),
            null,
            2,
          ),
      },
      {
        name: "exists_path",
        description: "Check whether a file or directory exists in the current workspace.",
        parameters: EXISTS_PATH_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => EXISTS_PATH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolveWorkspacePath(workspace.rootPath, String(args.path));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Exists ${absolute}`,
            scopeKey: absolute,
            paths: collectPathCandidates(absolute),
          };
        },
        execute: async (args) =>
          JSON.stringify(
            {
              path: resolveWorkspacePath(workspace.rootPath, String(args.path)),
              exists: readFileExists(workspace.rootPath, String(args.path)),
            },
            null,
            2,
          ),
      },
      {
        name: "stat_path",
        description: "Read file or directory metadata for a workspace path.",
        parameters: STAT_PATH_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => STAT_PATH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolveWorkspacePath(workspace.rootPath, String(args.path));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Stat ${absolute}`,
            scopeKey: absolute,
            paths: collectPathCandidates(absolute),
          };
        },
        execute: async (args) => JSON.stringify(statPath(workspace.rootPath, String(args.path)), null, 2),
      },
      {
        name: "find_files",
        description: "Find files by glob-style pattern in the current workspace.",
        parameters: FIND_FILES_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => FIND_FILES_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const target = args.path ? resolveWorkspacePath(workspace.rootPath, String(args.path)) : workspace.rootPath;
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Find files in ${target} matching ${args.pattern}`,
            scopeKey: `${target}:${args.pattern}:${args.limit ?? 200}`,
            paths: collectPathCandidates(target),
          };
        },
        execute: async (args) =>
          JSON.stringify(
            findFiles(
              workspace.rootPath,
              String(args.pattern),
              typeof args.path === "string" ? args.path : undefined,
              typeof args.limit === "number" ? args.limit : 200,
            ),
            null,
            2,
          ),
      },
      {
        name: "search_code",
        description: "Search code and filenames in the current workspace for a query string.",
        parameters: SEARCH_CODE_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => SEARCH_CODE_SCHEMA.parse(input),
        buildDescriptor: (args) => buildSearchDescriptor(workspace, args),
        execute: async (args) => JSON.stringify(searchWorkspace(workspace.rootPath, normalizeSearchArgs(args)), null, 2),
      },
      {
        name: "grep_code",
        description: "Search code with optional regex support and file filters.",
        parameters: SEARCH_CODE_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => SEARCH_CODE_SCHEMA.parse(input),
        buildDescriptor: (args) => buildSearchDescriptor(workspace, args),
        execute: async (args) => JSON.stringify(searchWorkspace(workspace.rootPath, normalizeSearchArgs(args)), null, 2),
      },
      {
        name: "list_repo_tree",
        description: "List files and directories in the workspace or a subdirectory.",
        parameters: LIST_REPO_TREE_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability(),
        parseArgs: (input) => LIST_REPO_TREE_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const target = args.path ? resolveWorkspacePath(workspace.rootPath, String(args.path)) : workspace.rootPath;
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `List ${target}`,
            scopeKey: `${target}:${args.recursive ?? true}:${args.maxDepth ?? 3}:${args.includeHidden ?? false}`,
            paths: collectPathCandidates(target),
          };
        },
        execute: async (args) =>
          JSON.stringify(
            listRepoTree(
              workspace.rootPath,
              typeof args.path === "string" ? args.path : undefined,
              typeof args.recursive === "boolean" ? args.recursive : true,
              typeof args.maxDepth === "number" ? args.maxDepth : 3,
              typeof args.includeHidden === "boolean" ? args.includeHidden : false,
            ),
            null,
            2,
          ),
      },
      {
        name: "git_status",
        description: "Get git status for the workspace.",
        parameters: EMPTY_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ streamedOutput: true }),
        parseArgs: (input) => EMPTY_SCHEMA.parse(input),
        buildDescriptor: () => ({
          source: LOCAL_TOOL_SOURCE,
          preview: "git status --short --branch",
          scopeKey: "git:status",
          paths: [workspace.rootPath],
        }),
        execute: async (_args, context) => executeShellCommand("git status --short --branch", context, workspace.rootPath),
      },
      {
        name: "git_diff",
        description: "Get git diff for the workspace.",
        parameters: EMPTY_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ streamedOutput: true }),
        parseArgs: (input) => EMPTY_SCHEMA.parse(input),
        buildDescriptor: () => ({
          source: LOCAL_TOOL_SOURCE,
          preview: "git diff",
          scopeKey: "git:diff",
          paths: [workspace.rootPath],
        }),
        execute: async (_args, context) => executeShellCommand("git diff", context, workspace.rootPath),
      },
      {
        name: "git_diff_staged",
        description: "Get git diff for staged changes.",
        parameters: EMPTY_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ streamedOutput: true }),
        parseArgs: (input) => EMPTY_SCHEMA.parse(input),
        buildDescriptor: () => ({
          source: LOCAL_TOOL_SOURCE,
          preview: "git diff --staged",
          scopeKey: "git:diff:staged",
          paths: [workspace.rootPath],
        }),
        execute: async (_args, context) => executeShellCommand("git diff --staged", context, workspace.rootPath),
      },
      {
        name: "git_add",
        description: "Stage files for commit.",
        parameters: GIT_ADD_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ writes: true, streamedOutput: true, approvalModes: ["preflight", "deferred"], riskLevel: "write" }),
        parseArgs: (input) => GIT_ADD_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const paths = normalizeStringArray(args.paths);
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `git add ${paths.join(" ")}`,
            scopeKey: `git:add:${paths.join("|")}`,
            paths: [workspace.rootPath, ...paths.flatMap((entry) => collectPathCandidates(resolveWorkspacePath(workspace.rootPath, entry)))],
            risky: true,
            writes: true,
            approvalReason: "Staging files requires approval.",
          };
        },
        execute: async (args, context) =>
          executeShellCommand(`git add -- ${normalizeStringArray(args.paths).map((entry) => quoteShellArg(entry)).join(" ")}`, context, workspace.rootPath),
      },
      {
        name: "git_commit",
        description: "Create a non-interactive git commit.",
        parameters: GIT_COMMIT_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ writes: true, streamedOutput: true, approvalModes: ["preflight", "deferred"], riskLevel: "write" }),
        parseArgs: (input) => GIT_COMMIT_SCHEMA.parse(input),
        buildDescriptor: (args) => ({
          source: LOCAL_TOOL_SOURCE,
          preview: `git commit -m ${args.message}`,
          scopeKey: `git:commit:${args.message}`,
          paths: [workspace.rootPath],
          risky: true,
          writes: true,
          approvalReason: "Creating a git commit requires approval.",
        }),
        execute: async (args, context) => executeShellCommand(`git commit -m ${quoteShellArg(String(args.message))}`, context, workspace.rootPath),
      },
      {
        name: "run_shell",
        description: "Run a shell command inside the workspace.",
        parameters: RUN_SHELL_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({
          writes: true,
          network: true,
          interactive: true,
          streamedOutput: true,
          approvalModes: ["preflight", "deferred"],
          riskLevel: "privileged",
        }),
        parseArgs: (input) => RUN_SHELL_SCHEMA.parse(input),
        buildDescriptor: (args) => buildShellDescriptor(workspace, args),
        execute: async (args, context) => {
          const cwd = args.cwd ? resolveWorkspacePath(workspace.rootPath, String(args.cwd)) : workspace.rootPath;
          return executeShellCommand(String(args.command), context, cwd);
        },
      },
      {
        name: "write_patch",
        description: "Write a full file content to a path, creating parent directories when needed.",
        parameters: WRITE_PATCH_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ writes: true, approvalModes: ["preflight", "deferred"], riskLevel: "write" }),
        parseArgs: (input) => WRITE_PATCH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolveWorkspacePath(workspace.rootPath, String(args.path));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Write ${absolute}`,
            scopeKey: absolute,
            paths: collectPathCandidates(absolute),
            risky: true,
            writes: true,
            approvalReason: `Writing ${absolute} requires approval.`,
          };
        },
        execute: async (args) => JSON.stringify(writeWholeFile(workspace.rootPath, String(args.path), String(args.content)), null, 2),
      },
      {
        name: "apply_patch",
        description: "Apply a structured patch document to the workspace.",
        parameters: APPLY_PATCH_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ writes: true, approvalModes: ["preflight", "deferred"], riskLevel: "write" }),
        parseArgs: (input) => APPLY_PATCH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const operations = planPatchOperations(workspace.rootPath, String(args.patch));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: "apply_patch",
            scopeKey: operations.map((entry) => `${entry.action}:${entry.path}${entry.moveTo ? `->${entry.moveTo}` : ""}`).join("|"),
            paths: operations.flatMap((entry) => {
              const current = resolveWorkspacePath(workspace.rootPath, entry.path);
              const target = entry.moveTo ? resolveWorkspacePath(workspace.rootPath, entry.moveTo) : undefined;
              return [current, target]
                .filter((value): value is string => Boolean(value))
                .flatMap((value) => collectPathCandidates(value));
            }),
            risky: true,
            writes: true,
            approvalReason: "Applying a patch requires approval.",
          };
        },
        execute: async (args) => JSON.stringify(applyPatchOperations(workspace.rootPath, String(args.patch)), null, 2),
      },
      {
        name: "move_path",
        description: "Move or rename a file or directory in the workspace.",
        parameters: MOVE_PATH_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ writes: true, approvalModes: ["preflight", "deferred"], riskLevel: "write" }),
        parseArgs: (input) => MOVE_PATH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const from = resolveWorkspacePath(workspace.rootPath, String(args.from));
          const to = resolveWorkspacePath(workspace.rootPath, String(args.to));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Move ${from} -> ${to}`,
            scopeKey: `${from}->${to}`,
            paths: [...collectPathCandidates(from), ...collectPathCandidates(to)],
            risky: true,
            writes: true,
            approvalReason: `Moving ${from} to ${to} requires approval.`,
          };
        },
        execute: async (args) => JSON.stringify(moveWorkspacePath(workspace.rootPath, String(args.from), String(args.to)), null, 2),
      },
      {
        name: "delete_path",
        description: "Delete a file or directory in the workspace.",
        parameters: DELETE_PATH_SCHEMA,
        strict: true,
        source: LOCAL_TOOL_SOURCE,
        capability: buildCapability({ writes: true, approvalModes: ["preflight", "deferred"], riskLevel: "write" }),
        parseArgs: (input) => DELETE_PATH_SCHEMA.parse(input),
        buildDescriptor: (args) => {
          const absolute = resolveWorkspacePath(workspace.rootPath, String(args.path));
          return {
            source: LOCAL_TOOL_SOURCE,
            preview: `Delete ${absolute}`,
            scopeKey: `${absolute}:${args.recursive ?? true}`,
            paths: collectPathCandidates(absolute),
            risky: true,
            writes: true,
            approvalReason: `Deleting ${absolute} requires approval.`,
          };
        },
        execute: async (args) =>
          JSON.stringify(deleteWorkspacePath(workspace.rootPath, String(args.path), typeof args.recursive === "boolean" ? args.recursive : true), null, 2),
      },
    ];
  }
}

function buildShellDescriptor(workspace: WorkspaceProfile, args: Record<string, unknown>): ToolActionDescriptor {
  const command = String(args.command);
  const cwd = args.cwd ? resolveWorkspacePath(workspace.rootPath, String(args.cwd)) : workspace.rootPath;
  const analysis = buildShellAnalysis(command, cwd, workspace.rootPath);

  return {
    source: LOCAL_TOOL_SOURCE,
    preview: command,
    scopeKey: `${cwd}::${analysis.scopeKey}`,
    paths: [cwd, ...analysis.paths],
    risky: true,
    interactive: analysis.interactive,
    riskLevel: analysis.riskLevel,
    writes: analysis.writes,
    network: analysis.network,
    approvalReason: analysis.privileged
      ? `Privileged command execution requires explicit approval: ${command}`
      : `Command execution requires approval: ${command}`,
  };
}

function buildSearchDescriptor(workspace: WorkspaceProfile, args: Record<string, unknown>): ToolActionDescriptor {
  const target = args.path ? resolveWorkspacePath(workspace.rootPath, String(args.path)) : workspace.rootPath;

  return {
    source: LOCAL_TOOL_SOURCE,
    preview: `Search ${target} for "${String(args.query)}"`,
    scopeKey: `${target}:${String(args.query).trim().toLowerCase()}:${String(args.regex ?? false)}:${String(args.filePattern ?? "")}:${String(args.limit ?? 100)}`,
    paths: collectPathCandidates(target),
  };
}

function readFileExists(rootPath: string, path: string): boolean {
  return existsSync(resolveWorkspacePath(rootPath, path));
}

function normalizeSearchArgs(args: Record<string, unknown>) {
  return {
    query: String(args.query),
    path: typeof args.path === "string" ? args.path : undefined,
    regex: typeof args.regex === "boolean" ? args.regex : false,
    filePattern: typeof args.filePattern === "string" ? args.filePattern : undefined,
    limit: typeof args.limit === "number" ? args.limit : 100,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry));
}

function buildCapability(overrides: Partial<RuntimeToolCapability> = {}): RuntimeToolCapability {
  return {
    writes: false,
    network: false,
    interactive: false,
    approvalModes: ["none"],
    riskLevel: "safe_read",
    streamedOutput: false,
    resumable: false,
    ...overrides,
  };
}
