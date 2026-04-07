import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import type { ProjectRecord, ReviewRecord, ReviewSource } from "@my-agent/protocol";
import { ReviewManager } from "../src/services/review-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("ReviewManager", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["workspace", ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--unified=3"]],
    ["staged", ["-c", "core.quotepath=false", "diff", "--staged", "--no-ext-diff", "--unified=3"]],
    ["base_branch", ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--unified=3", "main...HEAD"]],
    ["commit", ["-c", "core.quotepath=false", "show", "--no-ext-diff", "--format=medium", "--stat", "--patch", "abc123"]],
  ] as const)("reviews %s diff sources and stores structured findings", async (kind, expectedArgs) => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-review-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const project = database.listProjects()[0]!;
    const now = new Date().toISOString();
    const source: ReviewSource =
      kind === "base_branch"
        ? { kind, baseBranch: "main" }
        : kind === "commit"
          ? { kind, commit: "abc123" }
          : { kind };

    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "diff --git a/src/app.ts b/src/app.ts\n+const safe = true;\n",
      stderr: "",
    });

    const manager = new ReviewManager(
      database,
      {
        complete: vi.fn().mockResolvedValue({
          role: "assistant",
          content: JSON.stringify({
            summary: "One issue found.",
            findings: [
              {
                severity: "high",
                summary: "Missing guard",
                detail: "A null guard is missing.",
                file: "src/app.ts",
                line: 12,
              },
            ],
          }),
        }),
      } as never,
      {
        detect: ({ cwd }: { cwd?: string }) => ({
          id: "env-1",
          projectId: project.id,
          cwd: cwd ?? root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      {
        create: () => ({
          id: "exec-1",
          projectId: project.id,
          kind: "review",
          cwd: root,
          shell: process.platform === "win32" ? "powershell" : "bash",
          envJson: {},
          detectedTools: ["git"],
          createdAt: now,
          updatedAt: now,
        }),
      } as never,
      () => undefined,
    );

    const review = manager.start({
      project,
      provider: {
        id: "provider-1",
        name: "Test",
        baseUrl: "https://example.com/v1",
        apiKey: "test",
        model: "gpt-test",
        apiFlavor: "responses",
      },
      source,
    });

    await vi.waitFor(() => {
      const stored = database.getReview(review.id);
      expect(stored?.status).toBe("completed");
    });

    expect(spawnSyncMock).toHaveBeenCalledWith("git", expectedArgs, expect.any(Object));
    expect(database.getReview(review.id)).toMatchObject({
      summary: "One issue found.",
      findings: [
        {
          severity: "high",
          summary: "Missing guard",
          file: "src/app.ts",
          line: 12,
        },
      ],
    });
  });

  it("completes with no findings when the diff is empty", async () => {
    const { manager, database, project } = createReviewHarness();
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const review = manager.start({
      project,
      provider: configuredProvider(),
      source: { kind: "workspace" },
    });

    await vi.waitFor(() => {
      expect(database.getReview(review.id)?.status).toBe("completed");
    });

    expect(database.getReview(review.id)).toMatchObject({
      summary: "No diff is available for review.",
      findings: [],
    });
  });

  it("fails the review when git diff collection fails", async () => {
    const { manager, database, project } = createReviewHarness();
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "fatal: bad revision" });

    const review = manager.start({
      project,
      provider: configuredProvider(),
      source: { kind: "base_branch", baseBranch: "missing" },
    });

    await vi.waitFor(() => {
      expect(database.getReview(review.id)?.status).toBe("failed");
    });

    expect(database.getReview(review.id)?.error).toContain("fatal: bad revision");
  });
});

function configuredProvider() {
  return {
    id: "provider-1",
    name: "Test",
    baseUrl: "https://example.com/v1",
    apiKey: "test",
    model: "gpt-test",
    apiFlavor: "responses" as const,
  };
}

function createReviewHarness() {
  const root = mkdtempSync(join(tmpdir(), "my-agent-review-"));
  const database = new HarnessDatabase(join(root, "app.db"));
  const project = database.listProjects()[0]!;
  const now = new Date().toISOString();
  const manager = new ReviewManager(
    database,
    {
      complete: vi.fn().mockResolvedValue({
        role: "assistant",
        content: JSON.stringify({
          summary: "No findings.",
          findings: [],
        }),
      }),
    } as never,
    {
      detect: ({ cwd }: { cwd?: string }) => ({
        id: "env-1",
        projectId: project.id,
        cwd: cwd ?? root,
        shell: process.platform === "win32" ? "powershell" : "bash",
        envJson: {},
        detectedTools: ["git"],
        createdAt: now,
        updatedAt: now,
      }),
    } as never,
    {
      create: () => ({
        id: "exec-1",
        projectId: project.id,
        kind: "review",
        cwd: root,
        shell: process.platform === "win32" ? "powershell" : "bash",
        envJson: {},
        detectedTools: ["git"],
        createdAt: now,
        updatedAt: now,
      }),
    } as never,
    () => undefined,
  );

  return { manager, database, project };
}
