import { type InternalToolRecord, type ProjectRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { discoverInternalToolEntries } from "./internal-tool-registry.js";

export class InternalToolManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (internalTool: InternalToolRecord) => void,
    private readonly homeDir?: string,
  ) {}

  list(project?: ProjectRecord): InternalToolRecord[] {
    if (!project) {
      return [];
    }

    const discovered = discoverInternalToolEntries({
      workspaceRoot: project.rootPath,
      persisted: this.database.listInternalTools(),
      homeDir: this.homeDir,
    }).map((entry) => entry.record);

    for (const internalTool of discovered) {
      this.database.upsertInternalTool(internalTool);
      this.emit(internalTool);
    }

    return discovered;
  }

  update(internalToolId: string, patch: Partial<Pick<InternalToolRecord, "enabled">>): InternalToolRecord {
    const current = this.database.getInternalTool(internalToolId);

    if (!current) {
      throw new Error(`Internal tool not found: ${internalToolId}`);
    }

    const internalTool = this.database.upsertInternalTool({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.emit(internalTool);
    return internalTool;
  }
}
