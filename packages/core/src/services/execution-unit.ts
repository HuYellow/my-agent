import {
  type ProviderProfile,
  type ProjectRecord,
  type ReviewSource,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowRunStepRecord,
  type WorkflowStep,
  type WorkspaceProfile,
} from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { ToolService } from "../tools/tool-service.js";
import { AgentTaskManager } from "./agent-task-manager.js";
import { EnvironmentManager } from "./environment-manager.js";
import { ExecutionContextManager } from "./execution-context-manager.js";
import { ReviewManager } from "./review-manager.js";
import { WorktreeManager } from "./worktree-manager.js";

export interface ExecutionUnitContext {
  workflowId: string;
  workflow: WorkflowRecord;
  project: ProjectRecord;
  provider: ProviderProfile;
  workspace: WorkspaceProfile;
  threadId?: string;
  nonInteractive?: boolean;
  toolService: ToolService;
  run: WorkflowRunRecord;
}

export interface ExecutionUnitResources {
  worktree?: ReturnType<WorktreeManager["create"]>;
  environment: ReturnType<EnvironmentManager["detect"]>;
  executionContext: ReturnType<ExecutionContextManager["create"]>;
}

const DEFAULT_REVIEW_COMPLETION_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_REVIEW_COMPLETION_POLL_INTERVAL_MS = 250;

export class ExecutionUnitRunner {
  constructor(
    private readonly worktreeManager: WorktreeManager,
    private readonly environmentManager: EnvironmentManager,
    private readonly executionContextManager: ExecutionContextManager,
    private readonly agentTaskManager: AgentTaskManager,
    private readonly reviewManager: ReviewManager,
    private readonly database: HarnessDatabase,
  ) {}

  prepareResources(
    step: WorkflowStep,
    project: ProjectRecord,
    requirementId: string | undefined,
    threadId: string | undefined,
    stepRunRecord?: WorkflowRunStepRecord,
  ): ExecutionUnitResources {
    const existingWorktree =
      step.worktreeStrategy === "new" && stepRunRecord?.worktreeId
        ? this.worktreeManager.get(stepRunRecord.worktreeId)
        : undefined;
    const worktree =
      step.worktreeStrategy === "new"
        ? existingWorktree?.status === "ready"
          ? existingWorktree
          : this.worktreeManager.create({
              project,
              requirementId,
              threadId,
              branch: `workflow/${step.id}`,
            })
        : undefined;
    const environment = this.environmentManager.detect({
      project,
      requirementId,
      threadId,
      worktreeId: worktree?.id,
      cwd: worktree?.path ?? project.rootPath,
    });

    const executionContext = this.executionContextManager.create({
      project,
      requirementId,
      kind: "workflow",
      threadId,
      worktree,
      environment,
    });

    return { worktree, environment, executionContext };
  }

  async run(step: WorkflowStep, context: ExecutionUnitContext, resources: ExecutionUnitResources): Promise<WorkflowRunStepRecord> {
    return executeExecutionUnitInternal(step, context, resources, this.agentTaskManager, this.reviewManager, this.database);
  }
}

async function executeExecutionUnitInternal(
  step: WorkflowStep,
  context: ExecutionUnitContext,
  resources: ExecutionUnitResources,
  agentTaskManager: AgentTaskManager,
  reviewManager: ReviewManager,
  database: HarnessDatabase,
): Promise<WorkflowRunStepRecord> {
  const startedAt = new Date().toISOString();

  if (step.type === "approval") {
    if (context.nonInteractive) {
      return {
        stepId: step.id,
        status: "failed",
        output: step.approvalMessage ?? "Non-interactive mode rejected an approval step.",
        artifactSummary: summarizeExecutionUnitOutput(step.approvalMessage ?? "Non-interactive mode rejected an approval step."),
        worktreeId: resources.worktree?.id,
        environmentId: resources.environment.id,
        executionContextId: resources.executionContext.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    }

    return {
      stepId: step.id,
      status: "paused",
      output: step.approvalMessage ?? "Workflow paused awaiting approval.",
      artifactSummary: summarizeExecutionUnitOutput(step.approvalMessage ?? "Workflow paused awaiting approval."),
      worktreeId: resources.worktree?.id,
      environmentId: resources.environment.id,
      executionContextId: resources.executionContext.id,
      startedAt,
      completedAt: undefined,
      attempts: 1,
    };
  }

  if (step.type === "command" && step.command) {
    try {
      const output = await context.toolService.executeTool(
        "run_shell",
        {
          command: step.command,
          cwd: resources.worktree?.path ?? context.project.rootPath,
        },
        {
          workspace: context.workspace,
          emitCommandDelta: () => undefined,
        },
      );
      return {
        stepId: step.id,
        status: "completed",
        output,
        artifactSummary: summarizeExecutionUnitOutput(output),
        worktreeId: resources.worktree?.id,
        environmentId: resources.environment.id,
        executionContextId: resources.executionContext.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    } catch (error) {
      return {
        stepId: step.id,
        status: "failed",
        output: error instanceof Error ? error.message : String(error),
        artifactSummary: summarizeExecutionUnitOutput(error instanceof Error ? error.message : String(error)),
        worktreeId: resources.worktree?.id,
        environmentId: resources.environment.id,
        executionContextId: resources.executionContext.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    }
  }

  if (step.type === "agent" && step.prompt) {
    try {
      const scopedWorkspace = scopeWorkspaceToWorktree(context.workspace, resources.worktree?.path);
      const scopedProject = scopeProjectToWorktree(context.project, resources.worktree?.path);
      const task = agentTaskManager.spawn({
        provider: context.provider,
        workspace: scopedWorkspace,
        project: scopedProject,
        requirementId: context.run.requirementId,
        parentThreadId: context.threadId ?? createId("workflow_thread"),
        title: step.title,
        input: step.prompt,
      });
      const waitTimeoutMs = normalizeWorkflowStepTimeout(step.timeoutMs);
      const finalTask = await agentTaskManager.wait(task.id, waitTimeoutMs ?? Number.POSITIVE_INFINITY);

      if (finalTask.status === "running" || finalTask.status === "awaiting_approval") {
        const output =
          typeof waitTimeoutMs === "number"
            ? `Timed out after ${waitTimeoutMs}ms waiting for delegated agent ${task.id} to finish. Last known status: ${finalTask.status}.`
            : `Delegated agent ${task.id} did not reach a terminal state. Last known status: ${finalTask.status}.`;

        return {
          stepId: step.id,
          status: "failed",
          output,
          artifactSummary: summarizeExecutionUnitOutput(output),
          worktreeId: resources.worktree?.id ?? finalTask.worktreeId,
          environmentId: finalTask.environmentId ?? resources.environment.id,
          executionContextId: finalTask.executionContextId ?? resources.executionContext.id,
          agentId: finalTask.id,
          startedAt,
          completedAt: new Date().toISOString(),
          attempts: 1,
        };
      }

      return {
        stepId: step.id,
        status: finalTask.status === "completed" ? "completed" : "failed",
        output: finalTask.finalOutput,
        artifactSummary: summarizeExecutionUnitOutput(finalTask.summary?.finalMessage ?? finalTask.finalOutput),
        worktreeId: resources.worktree?.id ?? finalTask.worktreeId,
        environmentId: finalTask.environmentId ?? resources.environment.id,
        executionContextId: finalTask.executionContextId ?? resources.executionContext.id,
        agentId: finalTask.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      return {
        stepId: step.id,
        status: "failed",
        output,
        artifactSummary: summarizeExecutionUnitOutput(output),
        worktreeId: resources.worktree?.id,
        environmentId: resources.environment.id,
        executionContextId: resources.executionContext.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    }
  }

  if (step.type === "review") {
    try {
      const scopedProject = scopeProjectToWorktree(context.project, resources.worktree?.path);
      const review = reviewManager.start({
        project: scopedProject,
        provider: context.provider,
        requirementId: context.run.requirementId,
        threadId: context.threadId,
        source: step.reviewSource,
        instructions: step.prompt,
      });
      const finalReview = await waitForReviewCompletion(database, review.id, {
        timeoutMs: normalizeWorkflowStepTimeout(step.timeoutMs) ?? DEFAULT_REVIEW_COMPLETION_TIMEOUT_MS,
        pollIntervalMs: DEFAULT_REVIEW_COMPLETION_POLL_INTERVAL_MS,
      });

      return {
        stepId: step.id,
        status: finalReview.status === "completed" ? "completed" : "failed",
        output: finalReview.error ?? finalReview.summary,
        artifactSummary: summarizeExecutionUnitOutput(
          finalReview.summary ?? finalReview.error ?? `${finalReview.findings.length} findings`,
        ),
        environmentId: resources.environment.id,
        executionContextId: finalReview.executionContextId ?? resources.executionContext.id,
        worktreeId: resources.worktree?.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      return {
        stepId: step.id,
        status: "failed",
        output,
        artifactSummary: summarizeExecutionUnitOutput(output),
        environmentId: resources.environment.id,
        executionContextId: resources.executionContext.id,
        worktreeId: resources.worktree?.id,
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: 1,
      };
    }
  }

  return {
    stepId: step.id,
    status: "skipped",
    artifactSummary: "Skipped",
    worktreeId: resources.worktree?.id,
    environmentId: resources.environment.id,
    executionContextId: resources.executionContext.id,
    startedAt,
    completedAt: new Date().toISOString(),
    attempts: 1,
  };
}

export function summarizeExecutionUnitOutput(output: string | undefined): string | undefined {
  const compact = output?.replace(/\s+/g, " ").trim();

  if (!compact) {
    return undefined;
  }

  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

async function waitForReviewCompletion(
  database: HarnessDatabase,
  reviewId: string,
  options: {
    timeoutMs: number;
    pollIntervalMs: number;
  },
) {
  const timeoutMs = Math.max(options.timeoutMs, options.pollIntervalMs);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const review = database.getReview(reviewId);

    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    if (review.status === "completed" || review.status === "failed") {
      return review;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for review completion: ${reviewId}`);
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }
}

function normalizeWorkflowStepTimeout(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }

  return Math.trunc(timeoutMs);
}

function scopeWorkspaceToWorktree(workspace: WorkspaceProfile, worktreePath?: string): WorkspaceProfile {
  if (!worktreePath) {
    return workspace;
  }

  return {
    ...workspace,
    rootPath: worktreePath,
  };
}

function scopeProjectToWorktree(project: ProjectRecord, worktreePath?: string): ProjectRecord {
  if (!worktreePath) {
    return project;
  }

  return {
    ...project,
    rootPath: worktreePath,
  };
}
