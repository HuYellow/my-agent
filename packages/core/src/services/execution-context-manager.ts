import { type EnvironmentRecord, type ExecutionContextRecord, type ProjectRecord, type WorktreeRecord } from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";

export class ExecutionContextManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (executionContext: ExecutionContextRecord) => void,
  ) {}

  create(params: {
    project: ProjectRecord;
    kind: ExecutionContextRecord["kind"];
    requirementId?: string;
    threadId?: string;
    agentId?: string;
    worktree?: WorktreeRecord;
    environment: EnvironmentRecord;
  }): ExecutionContextRecord {
    const now = new Date().toISOString();
    const executionContext: ExecutionContextRecord = {
      id: createId("exec"),
      projectId: params.project.id,
      requirementId: params.requirementId,
      kind: params.kind,
      threadId: params.threadId,
      agentId: params.agentId,
      worktreeId: params.worktree?.id,
      environmentId: params.environment.id,
      cwd: params.environment.cwd,
      shell: params.environment.shell,
      envJson: params.environment.envJson,
      detectedTools: params.environment.detectedTools,
      createdAt: now,
      updatedAt: now,
    };

    this.database.createExecutionContext(executionContext);
    this.emit(executionContext);
    return executionContext;
  }

  list(projectId?: string): ExecutionContextRecord[] {
    return this.database.listExecutionContexts(projectId);
  }

  update(executionContext: ExecutionContextRecord): ExecutionContextRecord {
    const updated = this.database.updateExecutionContext({
      ...executionContext,
      updatedAt: new Date().toISOString(),
    });
    this.emit(updated);
    return updated;
  }
}
