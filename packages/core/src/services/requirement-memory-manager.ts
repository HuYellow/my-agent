import {
  type AgentTaskRecord,
  type RequirementDerivedArtifactLink,
  type RequirementDerivedMemoryRecord,
  type RequirementDerivedProjectLink,
  type RequirementDerivedReviewLink,
  type RequirementDerivedThreadLink,
  type RequirementDerivedThreadSummary,
  type RequirementDerivedTurnSummary,
  type RequirementManualMemoryRecord,
  type RequirementMemoryRecord,
  type RequirementRecord,
} from "@yellow-flow/protocol";
import { HarnessDatabase } from "../store/database.js";

const EMPTY_MANUAL_MEMORY: RequirementManualMemoryRecord = {
  brief: "",
  goals: [],
  constraints: [],
  decisions: [],
  openQuestions: [],
  definitionOfDone: [],
};

const EMPTY_DERIVED_MEMORY: RequirementDerivedMemoryRecord = {
  linkedProjects: [],
  linkedThreads: [],
  threadSummaries: [],
  recentTurns: [],
  recentReviews: [],
  recentArtifacts: [],
  recentChanges: [],
  activitySummary: "",
};

export class RequirementMemoryManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly emit: (memory: RequirementMemoryRecord) => void,
  ) {}

  list(): RequirementMemoryRecord[] {
    return this.database.listRequirementMemories();
  }

  get(requirementId: string): RequirementMemoryRecord {
    return this.database.getRequirementMemory(requirementId) ?? this.createDefaultMemory(requirementId);
  }

  updateManualMemory(requirementId: string, patch: Partial<RequirementManualMemoryRecord>): RequirementMemoryRecord {
    const current = this.get(requirementId);
    const next: RequirementMemoryRecord = {
      ...current,
      manual: normalizeManualMemory({
        ...current.manual,
        ...patch,
      }),
      updatedAt: new Date().toISOString(),
    };

    this.database.upsertRequirementMemory(next);
    this.emit(next);
    return next;
  }

  rebuild(requirementId: string): RequirementMemoryRecord {
    const requirement = this.database.getRequirement(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }

    const current = this.get(requirementId);
    const rebuilt: RequirementMemoryRecord = {
      ...current,
      derived: buildDerivedMemory(this.database, requirement),
      updatedAt: new Date().toISOString(),
      lastRebuiltAt: new Date().toISOString(),
    };

    this.database.upsertRequirementMemory(rebuilt);
    this.emit(rebuilt);
    return rebuilt;
  }

  buildPromptContextSection(requirementId?: string): string | undefined {
    if (!requirementId) {
      return undefined;
    }

    const requirement = this.database.getRequirement(requirementId);

    if (!requirement) {
      return undefined;
    }

    const memory = this.get(requirementId);
    const primaryProject = this.database.getProject(requirement.primaryProjectId);
    const relatedProjectNames = requirement.relatedProjectIds
      .map((projectId) => this.database.getProject(projectId)?.name)
      .filter((value): value is string => Boolean(value));
    const sections: string[] = [
      "# Requirement Context",
      `Requirement: ${requirement.title}`,
      `Status: ${requirement.status}`,
      `Primary project: ${primaryProject?.name ?? requirement.primaryProjectId}`,
      `Related projects: ${relatedProjectNames.length > 0 ? relatedProjectNames.join(", ") : "None"}`,
    ];

    sections.push("## Goals / Constraints / Decisions");
    if (memory.manual.brief.trim()) {
      sections.push(`Brief: ${memory.manual.brief.trim()}`);
    }
    sections.push(renderStringList("Goals", memory.manual.goals, 6));
    sections.push(renderStringList("Constraints", memory.manual.constraints, 6));
    sections.push(renderStringList("Decisions", memory.manual.decisions, 6));
    sections.push(renderStringList("Open questions", memory.manual.openQuestions, 6));
    sections.push(renderStringList("Definition of done", memory.manual.definitionOfDone, 6));

    sections.push("## Current Activity Digest");
    if (memory.derived.activitySummary.trim()) {
      sections.push(memory.derived.activitySummary.trim());
    } else {
      sections.push("No requirement activity has been recorded yet.");
    }

    const recentTurnSummaries = (memory.derived.recentTurns ?? [])
      .map((turn) => `${turn.threadTitle}: ${turn.status}${turn.finalMessage ? ` - ${turn.finalMessage}` : ""}`)
      .slice(0, 6);
    sections.push(renderStringList("Latest turns", recentTurnSummaries, 6));

    sections.push("## Recent Artifacts");
    sections.push(renderArtifactGroup("Reviews", memory.derived.recentArtifacts.filter((artifact) => artifact.source === "review")));
    sections.push(renderArtifactGroup("Workflows", memory.derived.recentArtifacts.filter((artifact) => artifact.source === "workflow")));
    sections.push(renderArtifactGroup("Agents", memory.derived.recentArtifacts.filter((artifact) => artifact.source === "agent")));
    sections.push(
      renderStringList(
        "Review summaries",
        memory.derived.recentReviews.map((review) => `${review.status}: ${review.summary ?? review.reviewId}`),
        6,
      ),
    );

    sections.push("## Recent Changed Paths");
    sections.push(renderStringList("Paths", memory.derived.recentChanges, 12));

    sections.push("## Linked Thread Status");
    sections.push(
      renderStringList(
        "Threads",
        (memory.derived.threadSummaries ?? memory.derived.linkedThreads).map((thread) =>
          `${thread.title}: ${thread.latestTurnStatus ?? "idle"}${thread.hidden ? " (delegated)" : ""}${
            "latestFinalMessage" in thread && thread.latestFinalMessage ? ` - ${thread.latestFinalMessage}` : ""
          }`,
        ),
        12,
      ),
    );

    return sections.filter(Boolean).join("\n");
  }

  private createDefaultMemory(requirementId: string): RequirementMemoryRecord {
    const now = new Date().toISOString();
    const memory: RequirementMemoryRecord = {
      requirementId,
      manual: { ...EMPTY_MANUAL_MEMORY },
      derived: { ...EMPTY_DERIVED_MEMORY },
      updatedAt: now,
    };

    this.database.upsertRequirementMemory(memory);
    return memory;
  }
}

function buildDerivedMemory(database: HarnessDatabase, requirement: RequirementRecord): RequirementDerivedMemoryRecord {
  const threads = database
    .listThreads({ includeHidden: true })
    .filter((thread) => thread.requirementId === requirement.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const linkedThreadIds = new Set(threads.map((thread) => thread.id));
  const linkedProjects = buildLinkedProjects(database, requirement);
  const linkedThreads = buildLinkedThreads(database, threads);
  const threadSummaries = buildThreadSummaries(database, threads);
  const recentTurns = buildRecentTurns(database, threads);
  const reviews = database
    .listReviews()
    .filter((review) => review.requirementId === requirement.id || (review.threadId ? linkedThreadIds.has(review.threadId) : false))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8);
  const recentReviews = reviews.map<RequirementDerivedReviewLink>((review) => ({
    reviewId: review.id,
    status: review.status,
    summary: review.summary ?? review.error,
    updatedAt: review.updatedAt,
    threadId: review.threadId,
  }));
  const workflowRuns = database
    .listWorkflowRuns()
    .filter((run) => run.requirementId === requirement.id || (run.threadId ? linkedThreadIds.has(run.threadId) : false))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const agentTasks = database
    .listAgentTasks()
    .filter((task) => linkedThreadIds.has(task.parentThreadId) || (task.childThreadId ? linkedThreadIds.has(task.childThreadId) : false))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const recentArtifacts = buildRecentArtifacts(reviews, workflowRuns, agentTasks);
  const recentChanges = buildRecentChanges(database, threads, agentTasks);

  return {
    linkedProjects,
    linkedThreads,
    threadSummaries,
    recentTurns,
    recentReviews,
    recentArtifacts,
    recentChanges,
    activitySummary: buildActivitySummary({
      threadCount: threads.length,
      hiddenThreadCount: threads.filter((thread) => thread.hidden).length,
      reviewCount: reviews.length,
      workflowRunCount: workflowRuns.length,
      changedPathCount: recentChanges.length,
    }),
  };
}

function buildLinkedProjects(database: HarnessDatabase, requirement: RequirementRecord): RequirementDerivedProjectLink[] {
  const primaryProject = database.getProject(requirement.primaryProjectId);
  const links: RequirementDerivedProjectLink[] = [];

  if (primaryProject) {
    links.push({
      projectId: primaryProject.id,
      name: primaryProject.name,
      role: "primary",
    });
  }

  for (const projectId of requirement.relatedProjectIds) {
    const project = database.getProject(projectId);

    if (!project) {
      continue;
    }

    links.push({
      projectId: project.id,
      name: project.name,
      role: "related",
    });
  }

  return links;
}

function buildLinkedThreads(database: HarnessDatabase, threads: ReturnType<HarnessDatabase["listThreads"]>): RequirementDerivedThreadLink[] {
  return threads.slice(0, 12).map((thread) => {
    const latestTurn = database.listTurns(thread.id).at(-1);

    return {
      threadId: thread.id,
      title: thread.title,
      projectId: thread.projectId,
      updatedAt: thread.updatedAt,
      hidden: Boolean(thread.hidden),
      latestTurnStatus: latestTurn?.status ?? "idle",
    };
  });
}

function buildThreadSummaries(database: HarnessDatabase, threads: ReturnType<HarnessDatabase["listThreads"]>): RequirementDerivedThreadSummary[] {
  return threads.slice(0, 12).map((thread) => {
    const latestTurn = database.listTurns(thread.id).at(-1);

    return {
      threadId: thread.id,
      title: thread.title,
      projectId: thread.projectId,
      updatedAt: thread.updatedAt,
      hidden: Boolean(thread.hidden),
      latestTurnStatus: latestTurn?.status ?? "idle",
      latestTurnId: latestTurn?.id,
      latestFinalMessage: latestTurn ? findLatestAgentMessage(database, thread.id, latestTurn.id) : undefined,
    };
  });
}

function buildRecentTurns(database: HarnessDatabase, threads: ReturnType<HarnessDatabase["listThreads"]>): RequirementDerivedTurnSummary[] {
  const summaries: RequirementDerivedTurnSummary[] = [];

  for (const thread of threads) {
    const latestTurn = database.listTurns(thread.id).at(-1);

    if (!latestTurn) {
      continue;
    }

    summaries.push({
      turnId: latestTurn.id,
      threadId: thread.id,
      threadTitle: thread.title,
      hidden: Boolean(thread.hidden),
      status: latestTurn.status,
      input: truncateForSummary(latestTurn.input, 180),
      finalMessage: findLatestAgentMessage(database, thread.id, latestTurn.id),
      updatedAt: latestTurn.updatedAt,
    });
  }

  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 12);
}

function buildRecentArtifacts(
  reviews: ReturnType<HarnessDatabase["listReviews"]>,
  workflowRuns: ReturnType<HarnessDatabase["listWorkflowRuns"]>,
  agentTasks: AgentTaskRecord[],
): RequirementDerivedArtifactLink[] {
  const artifacts: RequirementDerivedArtifactLink[] = [];

  for (const review of reviews) {
    if (!review.summary && !review.error) {
      continue;
    }

    artifacts.push({
      source: "review",
      sourceId: review.id,
      summary: review.summary ?? review.error ?? "Review completed.",
      updatedAt: review.updatedAt,
    });
  }

  for (const run of workflowRuns) {
    for (const step of run.steps) {
      if (!step.artifactSummary) {
        continue;
      }

      artifacts.push({
        source: "workflow",
        sourceId: `${run.id}:${step.stepId}`,
        summary: step.artifactSummary,
        updatedAt: run.updatedAt,
      });
    }
  }

  for (const task of agentTasks) {
    const summary = task.summary?.finalMessage ?? task.finalOutput;

    if (!summary) {
      continue;
    }

    artifacts.push({
      source: "agent",
      sourceId: task.id,
      summary,
      updatedAt: task.updatedAt,
    });
  }

  return artifacts
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12);
}

function buildRecentChanges(database: HarnessDatabase, threads: ReturnType<HarnessDatabase["listThreads"]>, agentTasks: AgentTaskRecord[]): string[] {
  const fileChangePaths = threads.flatMap((thread) =>
    database
      .listItems(thread.id)
      .filter((item) => item.kind === "fileChange")
      .map((item) => (typeof item.metadata?.path === "string" ? item.metadata.path : null))
      .filter((value): value is string => Boolean(value)),
  );
  const taskPaths = agentTasks.flatMap((task) => task.summary?.changedPaths ?? []);

  return [...new Set([...fileChangePaths, ...taskPaths])].sort((left, right) => left.localeCompare(right)).slice(0, 24);
}

function findLatestAgentMessage(database: HarnessDatabase, threadId: string, turnId: string): string | undefined {
  const item = database
    .listItems(threadId)
    .filter((entry) => entry.turnId === turnId && entry.kind === "agentMessage")
    .at(-1);
  const body = item?.body.trim();
  return body ? truncateForSummary(body, 220) : undefined;
}

function buildActivitySummary(params: {
  threadCount: number;
  hiddenThreadCount: number;
  reviewCount: number;
  workflowRunCount: number;
  changedPathCount: number;
}): string {
  return [
    `${params.threadCount} linked thread${params.threadCount === 1 ? "" : "s"}`,
    params.hiddenThreadCount > 0 ? `${params.hiddenThreadCount} delegated thread${params.hiddenThreadCount === 1 ? "" : "s"}` : null,
    `${params.reviewCount} review${params.reviewCount === 1 ? "" : "s"}`,
    `${params.workflowRunCount} workflow run${params.workflowRunCount === 1 ? "" : "s"}`,
    `${params.changedPathCount} changed path${params.changedPathCount === 1 ? "" : "s"}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function normalizeManualMemory(memory: RequirementManualMemoryRecord): RequirementManualMemoryRecord {
  return {
    brief: memory.brief?.trim() ?? "",
    goals: normalizeStringList(memory.goals),
    constraints: normalizeStringList(memory.constraints),
    decisions: normalizeStringList(memory.decisions),
    openQuestions: normalizeStringList(memory.openQuestions),
    definitionOfDone: normalizeStringList(memory.definitionOfDone),
  };
}

function normalizeStringList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function renderStringList(label: string, values: string[], limit: number): string {
  if (values.length === 0) {
    return `${label}: None`;
  }

  return `${label}: ${values.slice(0, limit).join(" | ")}`;
}

function renderArtifactGroup(label: string, artifacts: Array<{ sourceId: string; summary: string }>): string {
  return renderStringList(
    label,
    artifacts.map((artifact) => `${artifact.sourceId}: ${artifact.summary}`),
    6,
  );
}

function truncateForSummary(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}
