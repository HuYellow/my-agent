import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import {
  type ProviderProfile,
  type ProjectRecord,
  type WorkspaceProfile,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowRunResult,
  type WorkflowStep,
} from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { ToolService } from "../tools/tool-service.js";
import { findGitRoot } from "../utils/path-utils.js";
import { AgentTaskManager } from "./agent-task-manager.js";
import { EnvironmentManager } from "./environment-manager.js";
import { ExecutionContextManager } from "./execution-context-manager.js";
import { ReviewManager } from "./review-manager.js";
import {
  ExecutionUnitRunner,
  type ExecutionUnitContext as WorkflowExecutionContext,
} from "./execution-unit.js";
import {
  approvePausedWorkflowRun,
  executeWorkflowGraph,
  getRetryAffectedStepIds,
  retryWorkflowRunSteps,
} from "./workflow-graph-runner.js";
import { WorktreeManager } from "./worktree-manager.js";

export class WorkflowManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly worktreeManager: WorktreeManager,
    private readonly environmentManager: EnvironmentManager,
    private readonly executionContextManager: ExecutionContextManager,
    private readonly reviewManager: ReviewManager,
    private readonly agentTaskManager: AgentTaskManager,
    private readonly emit: (workflow: WorkflowRecord) => void,
    private readonly emitRun?: (run: WorkflowRunRecord) => void,
  ) {}

  list(project?: ProjectRecord): WorkflowRecord[] {
    const discovered = discoverWorkflows(project);
    for (const workflow of discovered) {
      this.database.upsertWorkflow(workflow);
      this.emit(workflow);
    }
    return this.database.listWorkflows(project?.id);
  }

  listRuns(workflowId?: string): WorkflowRunRecord[] {
    return this.database.listWorkflowRuns(workflowId);
  }

  async run(params: {
    workflowId: string;
    project: ProjectRecord;
    provider: ProviderProfile;
    workspace: WorkspaceProfile;
    threadId?: string;
    nonInteractive?: boolean;
    runId?: string;
  }): Promise<WorkflowRunResult> {
    const workflow = this.database.getWorkflow(params.workflowId) ?? this.list(params.project).find((entry) => entry.id === params.workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${params.workflowId}`);
    }

    const run = params.runId ? this.database.getWorkflowRun(params.runId) : null;
    const initialRun = run ?? this.createRunRecord(workflow, params.project, params.threadId);
    if (!run) {
      this.database.createWorkflowRun(initialRun);
      this.emitRun?.(initialRun);
    }

    const context: WorkflowExecutionContext = {
      workflowId: workflow.id,
      workflow,
      project: params.project,
      provider: params.provider,
      workspace: params.workspace,
      threadId: params.threadId,
      nonInteractive: params.nonInteractive,
      toolService: new ToolService(params.workspace, {
        database: this.database,
        threadId: params.threadId,
      }),
      run: initialRun,
    };

    const result = await executeWorkflowGraph(
      context,
      this.database,
      new ExecutionUnitRunner(
        this.worktreeManager,
        this.environmentManager,
        this.executionContextManager,
        this.agentTaskManager,
        this.reviewManager,
        this.database,
      ),
      this.emitRun,
    );

    const cleanedRun = this.cleanupWorkflowWorktrees(workflow, result.run);
    const finalRun = cleanedRun.id === result.run.id ? this.database.updateWorkflowRun(cleanedRun) : cleanedRun;
    this.emitRun?.(finalRun);

    return {
      ...result,
      run: finalRun,
      stepsRun: finalRun.steps
        .filter((step): step is typeof step & { status: "completed" | "failed" | "skipped" } =>
          step.status === "completed" || step.status === "failed" || step.status === "skipped",
        )
        .map((step) => ({
          stepId: step.stepId,
          status: step.status,
          output: step.output,
          artifactSummary: step.artifactSummary,
          worktreeId: step.worktreeId,
          environmentId: step.environmentId,
          executionContextId: step.executionContextId,
          agentId: step.agentId,
          retainedFailures: step.retainedFailures,
        })),
    };
  }

  async resume(params: {
    runId: string;
    project: ProjectRecord;
    provider: ProviderProfile;
    workspace: WorkspaceProfile;
    approvePausedSteps?: boolean;
    retryFailedStepIds?: string[];
  }): Promise<WorkflowRunResult> {
    const run = this.database.getWorkflowRun(params.runId);

    if (!run) {
      throw new Error(`Workflow run not found: ${params.runId}`);
    }

    const workflow = this.database.getWorkflow(run.workflowId) ?? this.list(params.project).find((entry) => entry.id === run.workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${run.workflowId}`);
    }

    let resumedRun = params.approvePausedSteps === false ? run : approvePausedWorkflowRun(run);

    if (params.retryFailedStepIds && params.retryFailedStepIds.length > 0) {
      const retryAffectedStepIds = getRetryAffectedStepIds(workflow.steps, new Set(params.retryFailedStepIds));
      resumedRun = this.cleanupRetriedWorkflowWorktrees(resumedRun, retryAffectedStepIds);
      resumedRun = retryWorkflowRunSteps(resumedRun, workflow.steps, params.retryFailedStepIds);
    }

    if (resumedRun === run) {
      throw new Error("Workflow run has no paused or failed steps selected for recovery.");
    }

    this.database.updateWorkflowRun(resumedRun);
    this.emitRun?.(resumedRun);

    return this.run({
      workflowId: run.workflowId,
      project: params.project,
      provider: params.provider,
      workspace: params.workspace,
      threadId: resumedRun.threadId,
      nonInteractive: false,
      runId: resumedRun.id,
    });
  }

  private createRunRecord(workflow: WorkflowRecord, project: ProjectRecord, threadId?: string): WorkflowRunRecord {
    const now = new Date().toISOString();
    return {
      id: createId("workflow_run"),
      workflowId: workflow.id,
      projectId: project.id,
      threadId,
      status: "running",
      pendingStepIds: workflow.steps.map((step) => step.id),
      pausedStepIds: [],
      completedStepIds: [],
      failedStepIds: [],
      steps: workflow.steps.map((step) => ({
        stepId: step.id,
        status: "pending",
        attempts: 0,
      })),
      createdAt: now,
      updatedAt: now,
    };
  }

  private cleanupWorkflowWorktrees(workflow: WorkflowRecord, run: WorkflowRunRecord): WorkflowRunRecord {
    const cleanupStatuses =
      run.status === "completed"
        ? new Set<WorkflowRunRecord["steps"][number]["status"]>(["completed", "failed", "skipped"])
        : new Set<WorkflowRunRecord["steps"][number]["status"]>(["completed", "skipped"]);
    const workflowStepMap = new Map(workflow.steps.map((step) => [step.id, step]));
    const cleanedWorktreeIds = new Set<string>();

    for (const step of run.steps) {
      const workflowStep = workflowStepMap.get(step.stepId);

      if (workflowStep?.worktreeStrategy !== "new" || !step.worktreeId || !cleanupStatuses.has(step.status)) {
        continue;
      }

      if (cleanedWorktreeIds.has(step.worktreeId)) {
        continue;
      }

      this.tryRemoveWorktree(step.worktreeId);
      cleanedWorktreeIds.add(step.worktreeId);
    }

    return run;
  }

  private cleanupRetriedWorkflowWorktrees(run: WorkflowRunRecord, affectedStepIds: Set<string>): WorkflowRunRecord {
    const cleanedWorktreeIds = new Set<string>();

    for (const step of run.steps) {
      if (!affectedStepIds.has(step.stepId) || !step.worktreeId || cleanedWorktreeIds.has(step.worktreeId)) {
        continue;
      }

      this.tryRemoveWorktree(step.worktreeId);
      cleanedWorktreeIds.add(step.worktreeId);
    }

    return run;
  }

  private tryRemoveWorktree(worktreeId: string): void {
    const worktree = this.worktreeManager.get(worktreeId);

    if (!worktree || worktree.status === "removed") {
      return;
    }

    try {
      this.worktreeManager.remove(worktreeId);
    } catch {
      // best effort cleanup; retained state in the database is still useful for debugging
    }
  }
}

function discoverWorkflows(project?: ProjectRecord): WorkflowRecord[] {
  const roots: Array<{ source: WorkflowRecord["source"]; path: string }> = [
    { source: "system", path: join(process.cwd(), "packages", "core", "system-workflows") },
    { source: "user", path: join(homedir(), ".my-agent", "workflows") },
  ];
  const repoRoot = project ? findGitRoot(project.rootPath) : undefined;

  if (repoRoot) {
    roots.push({ source: "repo", path: join(repoRoot, ".agents", "workflows") });
    roots.push({ source: "repo", path: join(repoRoot, ".codex", "workflows") });
  }

  return roots.flatMap((root) => loadWorkflowDirectory(root.path, root.source));
}

function loadWorkflowDirectory(rootPath: string, source: WorkflowRecord["source"]): WorkflowRecord[] {
  if (!existsSync(rootPath)) {
    return [];
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && [".yml", ".yaml", ".toml"].includes(entry.name.slice(entry.name.lastIndexOf("."))))
    .map((entry) => parseWorkflowFile(join(rootPath, entry.name), source))
    .filter((entry): entry is WorkflowRecord => Boolean(entry));
}

function parseWorkflowFile(filePath: string, source: WorkflowRecord["source"]): WorkflowRecord | null {
  const raw = readFileSync(filePath, "utf8");
  const now = new Date().toISOString();
  let parsed: Record<string, unknown>;

  if (filePath.endsWith(".toml")) {
    parsed = parseVerySmallToml(raw);
  } else {
    parsed = (YAML.parse(raw) as Record<string, unknown>) ?? {};
  }

  const name = typeof parsed.name === "string" ? parsed.name : filePath.split(/[\\/]/).pop()?.replace(/\.(yaml|yml|toml)$/i, "") ?? "workflow";
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];

  return {
    id: createIdFromPath(filePath),
    name,
    description: typeof parsed.description === "string" ? parsed.description : "Workflow",
    path: filePath,
    source,
    steps: steps.map((step, index) => normalizeWorkflowStep(step, index)),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeWorkflowStep(step: unknown, index: number): WorkflowStep {
  const record = typeof step === "object" && step !== null ? (step as Record<string, unknown>) : {};
  const type = record.type === "approval" || record.type === "agent" || record.type === "review" ? record.type : "command";

  return {
    id: typeof record.id === "string" ? record.id : `step-${index + 1}`,
    type,
    title: typeof record.title === "string" ? record.title : `Step ${index + 1}`,
    command: typeof record.command === "string" ? record.command : undefined,
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
    reviewSource: normalizeWorkflowReviewSource(record),
    approvalMessage: typeof record.approvalMessage === "string" ? record.approvalMessage : undefined,
    worktreeStrategy: record.worktreeStrategy === "new" ? "new" : "inherit",
    dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn.map((entry) => String(entry)) : undefined,
    nextStepIds: Array.isArray(record.nextStepIds) ? record.nextStepIds.map((entry) => String(entry)) : undefined,
    onFailureStepIds: Array.isArray(record.onFailureStepIds) ? record.onFailureStepIds.map((entry) => String(entry)) : undefined,
    runIf: Array.isArray(record.runIf)
      ? record.runIf.map((entry) => {
          const condition = entry as Record<string, unknown>;
          return {
            stepId: String(condition.stepId),
            status: (String(condition.status) as "completed" | "failed" | "skipped"),
          };
        })
      : undefined,
  };
}

function normalizeWorkflowReviewSource(record: Record<string, unknown>) {
  const source = record.reviewSource;

  if (source && typeof source === "object") {
    const reviewSource = source as Record<string, unknown>;
    const kind = String(reviewSource.kind ?? "workspace");
    if (kind === "base_branch") {
      return { kind, baseBranch: typeof reviewSource.baseBranch === "string" ? reviewSource.baseBranch : undefined } as const;
    }
    if (kind === "commit") {
      return { kind, commit: typeof reviewSource.commit === "string" ? reviewSource.commit : undefined } as const;
    }
    if (kind === "staged" || kind === "workspace") {
      return { kind } as const;
    }
  }

  const kind = typeof record.reviewSourceKind === "string" ? record.reviewSourceKind : undefined;
  if (kind === "base_branch") {
    return { kind, baseBranch: typeof record.reviewBaseBranch === "string" ? record.reviewBaseBranch : undefined } as const;
  }
  if (kind === "commit") {
    return { kind, commit: typeof record.reviewCommit === "string" ? record.reviewCommit : undefined } as const;
  }
  if (kind === "staged" || kind === "workspace") {
    return { kind } as const;
  }

  return undefined;
}

function createIdFromPath(filePath: string): string {
  return `workflow_${Buffer.from(filePath).toString("base64url").slice(0, 16)}`;
}

function parseVerySmallToml(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const steps: Array<Record<string, unknown>> = [];
  let currentStep: Record<string, unknown> | null = null;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line === "[[steps]]") {
      currentStep = {};
      steps.push(currentStep);
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
    if (currentStep) {
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        currentStep[key] = rawValue
          .slice(1, -1)
          .split(",")
          .map((entry) => entry.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      } else {
        currentStep[key] = rawValue;
      }
    } else {
      result[key] = rawValue;
    }
  }

  if (steps.length > 0) {
    result.steps = steps;
  }

  return result;
}
