import { spawnSync } from "node:child_process";
import { type EnvironmentRecord, type ProjectRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

export class EnvironmentManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (environment: EnvironmentRecord) => void,
  ) {}

  list(projectId?: string): EnvironmentRecord[] {
    return this.database.listEnvironments(projectId);
  }

  detect(params: {
    project: ProjectRecord;
    requirementId?: string;
    threadId?: string;
    worktreeId?: string;
    cwd?: string;
  }): EnvironmentRecord {
    const cwd = params.cwd ?? params.project.rootPath;
    const now = new Date().toISOString();
    const envJson = collectSelectedEnv();
    const detectedTools = ["git", "node", "npm", "python", "rg"].filter((tool) => commandExists(tool, cwd));
    const nodeVersion = readCommandVersion("node", ["--version"], cwd);
    const pythonVenvPath = envJson.VIRTUAL_ENV;

    const record = this.database.createEnvironment({
      id: createId("env"),
      projectId: params.project.id,
      requirementId: params.requirementId,
      threadId: params.threadId,
      worktreeId: params.worktreeId,
      cwd,
      shell: params.project.shell,
      envJson,
      detectedTools,
      pythonVenvPath: pythonVenvPath || undefined,
      nodeVersion: nodeVersion || undefined,
      createdAt: now,
      updatedAt: now,
    });
    this.emit(record);
    return record;
  }
}

function collectSelectedEnv(): Record<string, string> {
  const keys = ["PATH", "HOME", "USERPROFILE", "SHELL", "COMSPEC", "VIRTUAL_ENV", "NODE_ENV"];
  const values: Record<string, string> = {};

  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      values[key] = value;
    }
  }

  return values;
}

function commandExists(command: string, cwd: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], {
    cwd,
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

function readCommandVersion(command: string, args: string[], cwd: string): string | undefined {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    return undefined;
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output || undefined;
}
