import {
  type WorkflowStepFailureArtifact,
  type WorkflowRunRecord,
  type WorkflowRunResult,
  type WorkflowRunStepRecord,
  type WorkflowStep,
} from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import {
  ExecutionUnitRunner,
  type ExecutionUnitContext as WorkflowExecutionContext,
  summarizeExecutionUnitOutput,
} from "./execution-unit.js";

export async function executeWorkflowGraph(
  context: WorkflowExecutionContext,
  database: HarnessDatabase,
  executionUnitRunner: ExecutionUnitRunner,
  emitRun?: (run: WorkflowRunRecord) => void,
): Promise<WorkflowRunResult> {
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
            artifactSummary: "Skipped because runIf conditions were not satisfied.",
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
        const resources = executionUnitRunner.prepareResources(step, context.project, context.threadId, getRunStep(run, step.id));
        const result = await executionUnitRunner.run(step, context, resources);
        return {
          ...result,
          attempts: getRunStep(run, step.id).attempts + 1,
        };
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
        retainedFailures: step.retainedFailures,
      })),
  };
}

export function approvePausedWorkflowRun(run: WorkflowRunRecord): WorkflowRunRecord {
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

export function retryWorkflowRunSteps(
  run: WorkflowRunRecord,
  workflowSteps: WorkflowStep[],
  stepIds: string[],
): WorkflowRunRecord {
  const uniqueStepIds = [...new Set(stepIds.map((stepId) => stepId.trim()).filter(Boolean))];

  if (uniqueStepIds.length === 0) {
    return run;
  }

  const knownStepIds = new Set(workflowSteps.map((step) => step.id));
  const invalidStepId = uniqueStepIds.find((stepId) => !knownStepIds.has(stepId));

  if (invalidStepId) {
    throw new Error(`Workflow step not found: ${invalidStepId}`);
  }

  const retryTargets = new Set(uniqueStepIds);
  for (const stepId of retryTargets) {
    const stepRecord = getRunStep(run, stepId);

    if (stepRecord.status !== "failed") {
      throw new Error(`Workflow step ${stepId} is not in a failed state and cannot be retried.`);
    }
  }

  const affectedStepIds = getRetryAffectedStepIds(workflowSteps, retryTargets);
  const nextPending = new Set(run.pendingStepIds);
  const nextPaused = new Set(run.pausedStepIds);
  const nextCompleted = new Set(run.completedStepIds);
  const nextFailed = new Set(run.failedStepIds);

  for (const stepId of affectedStepIds) {
    nextPending.add(stepId);
    nextPaused.delete(stepId);
    nextCompleted.delete(stepId);
    nextFailed.delete(stepId);
  }

  return {
    ...run,
    status: "running",
    pendingStepIds: [...nextPending],
    pausedStepIds: [...nextPaused],
    completedStepIds: [...nextCompleted],
    failedStepIds: [...nextFailed],
    pauseReason: nextPaused.size > 0 ? run.pauseReason : undefined,
    steps: run.steps.map((step) =>
      affectedStepIds.has(step.stepId)
      ? {
          ...step,
          retainedFailures:
            step.status === "failed" ? appendRetainedFailure(step.retainedFailures, retainFailureArtifact(step)) : step.retainedFailures,
          status: "pending",
          output: undefined,
          artifactSummary: undefined,
          worktreeId: undefined,
          environmentId: undefined,
          executionContextId: undefined,
          agentId: undefined,
          startedAt: undefined,
          completedAt: undefined,
        }
        : step,
    ),
    updatedAt: new Date().toISOString(),
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
  const existing = getRunStep(run, result.stepId);
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
    steps: run.steps.map((entry) =>
      entry.stepId === result.stepId
        ? {
            ...result,
            retainedFailures:
              existing.status === "failed" && result.status !== "failed"
                ? appendRetainedFailure(existing.retainedFailures, retainFailureArtifact(existing))
                : existing.retainedFailures,
          }
        : entry,
    ),
  };
}

function deriveRunStatus(run: WorkflowRunRecord, workflowSteps: WorkflowStep[]): WorkflowRunRecord["status"] {
  if (run.pausedStepIds.length > 0) {
    return "paused";
  }

  if (run.failedStepIds.length > 0 && getReadySteps(workflowSteps, run).length === 0) {
    return "failed";
  }

  const unfinished = workflowSteps.some((step) => {
    const status = getRunStep(run, step.id).status;
    return status === "pending" || status === "running" || status === "paused";
  });

  if (unfinished) {
    return "running";
  }

  return "completed";
}

function getRunStep(run: WorkflowRunRecord, stepId: string): WorkflowRunStepRecord {
  return run.steps.find((step) => step.stepId === stepId) ?? {
    stepId,
    status: "pending",
    attempts: 0,
  };
}

export function getRetryAffectedStepIds(workflowSteps: WorkflowStep[], retryTargets: Set<string>): Set<string> {
  const affected = new Set(retryTargets);
  const queue = [...retryTargets];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const step of workflowSteps) {
      if (affected.has(step.id)) {
        continue;
      }

      const dependsOnCurrent = step.dependsOn?.includes(current) ?? false;
      const runIfDependsOnCurrent = step.runIf?.some((condition) => condition.stepId === current) ?? false;

      if (!dependsOnCurrent && !runIfDependsOnCurrent) {
        continue;
      }

      affected.add(step.id);
      queue.push(step.id);
    }
  }

  return affected;
}

function retainFailureArtifact(step: WorkflowRunStepRecord): WorkflowStepFailureArtifact {
  return {
    attempt: step.attempts,
    output: step.output,
    artifactSummary: step.artifactSummary,
    worktreeId: step.worktreeId,
    environmentId: step.environmentId,
    executionContextId: step.executionContextId,
    agentId: step.agentId,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    retainedAt: new Date().toISOString(),
  };
}

function appendRetainedFailure(
  retainedFailures: WorkflowStepFailureArtifact[] | undefined,
  failure: WorkflowStepFailureArtifact,
): WorkflowStepFailureArtifact[] {
  return [...(retainedFailures ?? []), failure];
}
