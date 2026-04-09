import { spawnSync } from "node:child_process";
import {
  type HarnessEvent,
  type ProjectRecord,
  type ProviderProfile,
  type ReviewFinding,
  type ReviewRecord,
  type ReviewSource,
} from "@my-agent/protocol";
import { HarnessDatabase } from "../store/database.js";
import { createId } from "../utils/ids.js";
import { EnvironmentManager } from "./environment-manager.js";
import { ExecutionContextManager } from "./execution-context-manager.js";
import { ProviderService, type ChatMessage } from "./provider-service.js";
import { RequirementMemoryManager } from "./requirement-memory-manager.js";

export class ReviewManager {
  constructor(
    private readonly database: HarnessDatabase,
    private readonly providerService: ProviderService,
    private readonly environmentManager: EnvironmentManager,
    private readonly executionContextManager: ExecutionContextManager,
    private readonly requirementMemoryManager: RequirementMemoryManager,
    private readonly emit: (event: HarnessEvent) => void,
  ) {}

  list(projectId?: string, threadId?: string): ReviewRecord[] {
    return this.database.listReviews(projectId, threadId);
  }

  start(params: {
    project: ProjectRecord;
    provider: ProviderProfile;
    requirementId?: string;
    threadId?: string;
    source?: ReviewSource;
    instructions?: string;
  }): ReviewRecord {
    const source = params.source ?? { kind: "workspace" };
    const environment = this.environmentManager.detect({
      project: params.project,
      requirementId: params.requirementId,
      threadId: params.threadId,
      cwd: params.project.rootPath,
    });
    const executionContext = this.executionContextManager.create({
      project: params.project,
      requirementId: params.requirementId,
      kind: "review",
      threadId: params.threadId,
      environment,
    });
    const timestamp = new Date().toISOString();
    const review: ReviewRecord = {
      id: createId("review"),
      projectId: params.project.id,
      requirementId: params.requirementId,
      threadId: params.threadId,
      executionContextId: executionContext.id,
      status: "running",
      source,
      instructions: params.instructions?.trim() || undefined,
      findings: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.database.createReview(review);
    this.emit({ type: "review/started", payload: { review } });
    this.emit({ type: "review/status", payload: { review } });

    void this.runReview(
      review,
      params.provider,
      executionContext.cwd,
      this.requirementMemoryManager.buildPromptContextSection(params.requirementId),
    );
    return review;
  }

  private async runReview(
    review: ReviewRecord,
    provider: ProviderProfile,
    cwd: string,
    requirementContext?: string,
  ): Promise<void> {
    try {
      if (!provider.baseUrl || !provider.model) {
        throw new Error("Provider is not configured yet. Configure baseUrl and model before starting review.");
      }

      const diff = loadReviewDiff(cwd, review.source);

      if (!diff.trim()) {
        const completed = this.database.updateReview({
          ...review,
          status: "completed",
          summary: "No diff is available for review.",
          findings: [],
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        this.emit({ type: "review/result", payload: { review: completed } });
        return;
      }

      const response = await this.providerService.complete({
        provider,
        messages: buildReviewMessages(review, truncateDiff(diff), requirementContext),
        tools: [],
      });
      const parsed = parseReviewResponse(response.content ?? "");
      const timestamp = new Date().toISOString();
      const completed = this.database.updateReview({
        ...review,
        status: "completed",
        summary: parsed.summary,
        findings: parsed.findings.map((finding) => ({
          ...finding,
          id: createId("finding"),
        })),
        updatedAt: timestamp,
        completedAt: timestamp,
      });
      this.emit({ type: "review/result", payload: { review: completed } });
    } catch (error) {
      const failed = this.database.updateReview({
        ...review,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.emit({ type: "review/result", payload: { review: failed } });
    }
  }
}

function loadReviewDiff(cwd: string, source: ReviewSource): string {
  switch (source.kind) {
    case "workspace":
      return runGit(cwd, ["diff", "--no-ext-diff", "--unified=3"]);
    case "staged":
      return runGit(cwd, ["diff", "--staged", "--no-ext-diff", "--unified=3"]);
    case "base_branch":
      if (!source.baseBranch) {
        throw new Error("Review source baseBranch is required.");
      }
      return runGit(cwd, ["diff", "--no-ext-diff", "--unified=3", `${source.baseBranch}...HEAD`]);
    case "commit":
      if (!source.commit) {
        throw new Error("Review source commit is required.");
      }
      return runGit(cwd, ["show", "--no-ext-diff", "--format=medium", "--stat", "--patch", source.commit]);
    default:
      return "";
  }
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const message = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(message || `git ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }

  return `${result.stdout ?? ""}`.trim();
}

function buildReviewMessages(review: ReviewRecord, diff: string, requirementContext?: string): ChatMessage[] {
  const instructions = review.instructions ? `\n\nAdditional review focus:\n${review.instructions}` : "";
  return [
    {
      role: "system",
      content: [
        "You are a strict code reviewer.",
        "Return JSON only.",
        "Focus on correctness bugs, regressions, security issues, and missing test coverage.",
        "Use this schema exactly:",
        '{"summary":"string","findings":[{"severity":"low|medium|high|critical","summary":"string","detail":"string","file":"optional path","line":123}]}',
        "If no actionable findings exist, return an empty findings array.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Review source: ${formatReviewSource(review.source)}`,
        requirementContext,
        instructions,
        "Review this diff:",
        diff,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function formatReviewSource(source: ReviewSource): string {
  if (source.kind === "base_branch") {
    return `base branch ${source.baseBranch}`;
  }

  if (source.kind === "commit") {
    return `commit ${source.commit}`;
  }

  return source.kind;
}

function truncateDiff(diff: string): string {
  const limit = 80_000;
  return diff.length <= limit ? diff : `${diff.slice(0, limit)}\n\n[diff truncated for review]`;
}

function parseReviewResponse(content: string): { summary: string; findings: Omit<ReviewFinding, "id">[] } {
  const parsed = JSON.parse(extractJsonObject(content)) as {
    summary?: unknown;
    findings?: unknown;
  };
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];

  return {
    summary: typeof parsed.summary === "string" && parsed.summary.trim().length > 0 ? parsed.summary.trim() : "Review completed.",
    findings: findings
      .filter((finding): finding is Record<string, unknown> => Boolean(finding) && typeof finding === "object")
      .map((finding) => ({
        severity: normalizeSeverity(finding.severity),
        summary: typeof finding.summary === "string" && finding.summary.trim().length > 0 ? finding.summary.trim() : "Untitled finding",
        detail: typeof finding.detail === "string" && finding.detail.trim().length > 0 ? finding.detail.trim() : undefined,
        file: typeof finding.file === "string" && finding.file.trim().length > 0 ? finding.file.trim() : undefined,
        line: typeof finding.line === "number" && Number.isFinite(finding.line) ? Math.max(1, Math.trunc(finding.line)) : undefined,
      })),
  };
}

function normalizeSeverity(value: unknown): ReviewFinding["severity"] {
  switch (String(value ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

function extractJsonObject(content: string): string {
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Review provider returned no JSON payload.");
  }

  return content.slice(start, end + 1).trim();
}
