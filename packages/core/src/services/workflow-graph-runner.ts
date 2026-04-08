import {
  type WorkflowRecord,
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
