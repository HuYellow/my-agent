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
  type WorkflowRunStepRecord,
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
import { approvePausedWorkflowRun, executeWorkflowGraph } from "./workflow-graph-runner.js";
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
      toolService: new ToolService(params.project, {
        database: this.database,
        threadId: params.threadId,
      }),
      run: initialRun,
    };

    return executeWorkflowGraph(
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
  }

  async resume(params: {
    runId: string;
    project: ProjectRecord;
    provider: ProviderProfile;
    workspace: WorkspaceProfile;
    approvePausedSteps?: boolean;
  }): Promise<WorkflowRunResult> {
    const run = this.database.getWorkflowRun(params.runId);

    if (!run) {
      throw new Error(`Workflow run not found: ${params.runId}`);
    }

    const resumedRun = params.approvePausedSteps === false ? run : approvePausedWorkflowRun(run);

    if (resumedRun !== run) {
      this.database.updateWorkflowRun(resumedRun);
      this.emitRun?.(resumedRun);
    }

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
}

async function executeWorkflowGraph(
  context: WorkflowExecutionContext,
  database: HarnessDatabase,
  worktreeManager: WorktreeManager,
  environmentManager: EnvironmentManager,
  executionContextManager: ExecutionContextManager,
  reviewManager: ReviewManager,
  agentTaskManager: AgentTaskManager,
  emitRun?: (run: WorkflowRunRecord) => void,
): Promise<WorkflowRunResult> {
  const executionUnitRunner = new ExecutionUnitRunner(
    worktreeManager,
    environmentManager,
    executionContextManager,
    agentTaskManager,
    reviewManager,
    database,
  );
  const stepsById = new Map(context.workflow.steps.map((step) => [step.id, step]));
  let run: WorkflowRunRecord =
    context.run.status === "running" || context.run.status === "paused"
      ? context.run
      : {
          ...context.run,
          status: "running",
          updatedAt: new Date().toISOString(),
        };
  run = database.updateWorkflowRun(run);
  emitRun?.(run);

  while (true) {
    const skippableSteps = getSkippableSteps(context.workflow.steps, run);
    if (skippableSteps.length > 0) {
      for (const step of skippableSteps) {
        run = applyStepResult(
          run,
          {
            stepId: step.id,
            status: "skipped",
            output: "Skipped because runIf conditions were not satisfied.",
            attempts: getRunStep(run, step.id).attempts + 1,
            completedAt: new Date().toISOString(),
          },
          step,
        );
      }
      run.updatedAt = new Date().toISOString();
      run.status = deriveRunStatus(run, context.workflow.steps);
      run = database.updateWorkflowRun(run);
      emitRun?.(run);
    }

    if (run.status === "paused") {
      break;
    }

    const readySteps = getReadySteps(context.workflow.steps, run);

    if (readySteps.length === 0) {
      break;
    }

    const batchResults = await Promise.all(
      readySteps.map(async (step) => {
        const resources = executionUnitRunner.prepareResources(step, context.project, context.threadId);
        return executionUnitRunner.run(step, context, resources);
      }),
    );

    for (const result of batchResults) {
      run = applyStepResult(run, result, stepsById.get(result.stepId));
    }

    run.updatedAt = new Date().toISOString();
    run.status = deriveRunStatus(run, context.workflow.steps);
    run = database.updateWorkflowRun(run);
    emitRun?.(run);

    if (run.status === "failed" || run.status === "completed" || run.status === "paused") {
      break;
    }
  }

  run.status = deriveRunStatus(run, context.workflow.steps);
  run.updatedAt = new Date().toISOString();
  run = database.updateWorkflowRun(run);
  emitRun?.(run);

  return {
    workflow: context.workflow,
    run,
    stepsRun: run.steps
      .filter(isFinishedWorkflowStep)
      .map((step) => ({
        stepId: step.stepId,
        status: step.status,
        output: step.output,
        artifactSummary: step.artifactSummary,
        worktreeId: step.worktreeId,
        environmentId: step.environmentId,
        executionContextId: step.executionContextId,
        agentId: step.agentId,
      })),
  };
}

function isFinishedWorkflowStep(
  step: WorkflowRunStepRecord,
): step is WorkflowRunStepRecord & { status: "completed" | "failed" | "skipped" } {
  return step.status === "completed" || step.status === "failed" || step.status === "skipped";
}

function getReadySteps(steps: WorkflowStep[], run: WorkflowRunRecord): WorkflowStep[] {
  return steps.filter((step) => {
    const record = getRunStep(run, step.id);
    if (record.status !== "pending") {
      return false;
    }
    if (!areDependenciesSatisfied(step, run)) {
      return false;
    }
    if (!evaluateRunConditions(step, run)) {
      return false;
    }
    return true;
  });
}

function getSkippableSteps(steps: WorkflowStep[], run: WorkflowRunRecord): WorkflowStep[] {
  return steps.filter((step) => {
    const record = getRunStep(run, step.id);
    return record.status === "pending" && areDependenciesSatisfied(step, run) && !evaluateRunConditions(step, run);
  });
}

function evaluateRunConditions(step: WorkflowStep, run: WorkflowRunRecord): boolean {
  if (!step.runIf || step.runIf.length === 0) {
    return true;
  }

  return step.runIf.every((condition) => getRunStep(run, condition.stepId).status === condition.status);
}

function areDependenciesSatisfied(step: WorkflowStep, run: WorkflowRunRecord): boolean {
  const dependencies = step.dependsOn ?? [];

  if (dependencies.length === 0) {
    return true;
  }

  if (step.dependencyMode === "any") {
    return dependencies.some((dependency) => getRunStep(run, dependency).status === "completed");
  }

  return dependencies.every((dependency) => getRunStep(run, dependency).status === "completed");
}


function applyStepResult(run: WorkflowRunRecord, result: WorkflowRunStepRecord, step?: WorkflowStep): WorkflowRunRecord {
  const nextPending = new Set(run.pendingStepIds);
  nextPending.delete(result.stepId);
  const paused = new Set(run.pausedStepIds);
  paused.delete(result.stepId);
  const completed = new Set(run.completedStepIds);
  const failed = new Set(run.failedStepIds);

  if (result.status === "completed") {
    completed.add(result.stepId);
    for (const nextId of step?.nextStepIds ?? []) {
      nextPending.add(nextId);
    }
  } else if (result.status === "failed") {
    failed.add(result.stepId);
    if (step?.onFailureAction === "continue") {
      for (const nextId of step.onFailureStepIds ?? []) {
        nextPending.add(nextId);
      }
    }
  } else if (result.status === "paused") {
    paused.add(result.stepId);

    if (step?.onFailureAction === "pause") {
      // explicit pause behavior shares the same paused state channel
    }
  } else if (result.status === "skipped") {
    completed.add(result.stepId);
  }

  return {
    ...run,
    pendingStepIds: [...nextPending],
    pausedStepIds: [...paused],
    completedStepIds: [...completed],
    failedStepIds: [...failed],
    pauseReason: paused.size > 0 ? result.output : undefined,
    steps: run.steps.map((entry) => (entry.stepId === result.stepId ? result : entry)),
  };
}

function deriveRunStatus(run: WorkflowRunRecord, workflowSteps: WorkflowStep[]): WorkflowRunRecord["status"] {
  if (run.pausedStepIds.length > 0) {
    return "paused";
  }

  const unfinished = workflowSteps.some((step) => {
    const status = getRunStep(run, step.id).status;
    return status === "pending" || status === "running" || status === "paused";
  });

  if (unfinished) {
    return "running";
  }

  return run.failedStepIds.length > 0 ? "failed" : "completed";
}

function getRunStep(run: WorkflowRunRecord, stepId: string): WorkflowRunStepRecord {
  return run.steps.find((step) => step.stepId === stepId) ?? {
    stepId,
    status: "pending",
    attempts: 0,
  };
}

function approvePausedWorkflowRun(run: WorkflowRunRecord): WorkflowRunRecord {
  if (run.pausedStepIds.length === 0) {
    return run;
  }

  const approvedAt = new Date().toISOString();
  const pausedSet = new Set(run.pausedStepIds);
  const completed = new Set(run.completedStepIds);
  const updatedSteps = run.steps.map((step) => {
    if (!pausedSet.has(step.stepId) || step.status !== "paused") {
      return step;
    }

    completed.add(step.stepId);
    return {
      ...step,
      status: "completed" as const,
      output: step.output ?? "Approval gate resumed.",
      artifactSummary: step.artifactSummary ?? summarizeExecutionUnitOutput(step.output ?? "Approval gate resumed."),
      completedAt: approvedAt,
      attempts: step.attempts + 1,
    };
  });

  return {
    ...run,
    status: "running",
    pausedStepIds: [],
    completedStepIds: [...completed],
    pauseReason: undefined,
    steps: updatedSteps,
    updatedAt: approvedAt,
  };
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
