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

export class ExecutionUnitRunner {
  constructor(
    private readonly worktreeManager: WorktreeManager,
    private readonly environmentManager: EnvironmentManager,
    private readonly executionContextManager: ExecutionContextManager,
    private readonly agentTaskManager: AgentTaskManager,
    private readonly reviewManager: ReviewManager,
    private readonly database: HarnessDatabase,
  ) {}

  prepareResources(step: WorkflowStep, project: ProjectRecord, threadId: string | undefined): ExecutionUnitResources {
    const worktree =
      step.worktreeStrategy === "new"
        ? this.worktreeManager.create({
            project,
            threadId,
            branch: `workflow/${step.id}`,
          })
        : undefined;
    const environment = this.environmentManager.detect({
      project,
      threadId,
      worktreeId: worktree?.id,
      cwd: worktree?.path ?? project.rootPath,
    });

    const executionContext = this.executionContextManager.create({
      project,
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
    const task = agentTaskManager.spawn({
      provider: context.provider,
      workspace: context.workspace,
      project: context.project,
      parentThreadId: context.threadId ?? createId("workflow_thread"),
      title: step.title,
      input: step.prompt,
    });
    const finalTask = await agentTaskManager.wait(task.id, 120_000);

    return {
      stepId: step.id,
      status: finalTask.status === "completed" ? "completed" : "failed",
      output: finalTask.finalOutput,
      artifactSummary: summarizeExecutionUnitOutput(finalTask.summary?.finalMessage ?? finalTask.finalOutput),
      worktreeId: finalTask.worktreeId ?? resources.worktree?.id,
      environmentId: finalTask.environmentId ?? resources.environment.id,
      executionContextId: finalTask.executionContextId ?? resources.executionContext.id,
      agentId: finalTask.id,
      startedAt,
      completedAt: new Date().toISOString(),
      attempts: 1,
    };
  }

  if (step.type === "review") {
    const review = reviewManager.start({
      project: context.project,
      provider: context.provider,
      threadId: context.threadId,
      source: step.reviewSource,
      instructions: step.prompt,
    });
    const finalReview = await waitForReviewCompletion(database, review.id);

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

async function waitForReviewCompletion(database: HarnessDatabase, reviewId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const review = database.getReview(reviewId);

    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    if (review.status === "completed" || review.status === "failed") {
      return review;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for review completion: ${reviewId}`);
}
