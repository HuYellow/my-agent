import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewRecord } from "@my-agent/protocol";
import { useAppStore } from "./store";

const initialSession = {
  turns: [],
  items: [],
  pendingApproval: null,
  submitting: false,
};

afterEach(() => {
  useAppStore.setState({
    reviews: [],
    terminals: [],
    terminalOutputArchives: [],
    terminalCapabilities: [],
    terminalOutputs: {},
    threadSessions: {},
  } as never);
});

describe("desktop thread smoke", () => {
  it("binds steer and review events into UI state", () => {
    useAppStore.setState({
      reviews: [],
      terminalOutputs: {},
      threadSessions: {
        "thread-1": { ...initialSession },
      },
    } as never);

    useAppStore.getState().handleEvent({
      type: "turn/steered",
      payload: {
        steer: {
          id: "steer-1",
          turnId: "turn-1",
          threadId: "thread-1",
          input: "Stop and summarize first.",
          priority: "high",
          visibility: "user",
          status: "queued",
          createdAt: new Date().toISOString(),
        },
      },
    });

    const review: ReviewRecord = {
      id: "review-1",
      projectId: "project-1",
      threadId: "thread-1",
      status: "completed",
      source: { kind: "workspace" },
      summary: "One review issue found.",
      findings: [
        {
          id: "finding-1",
          severity: "medium",
          summary: "Add a missing test",
          file: "src/app.ts",
          line: 9,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    useAppStore.getState().handleEvent({
      type: "review/result",
      payload: { review },
    });

    const state = useAppStore.getState();
    expect(state.threadSessions["thread-1"]?.items).toMatchObject([
      {
        id: "steer-1",
        title: "Steer input",
        body: "Stop and summarize first.",
      },
    ]);
    expect(state.reviews).toMatchObject([
      {
        id: "review-1",
        findings: [
          {
            id: "finding-1",
            summary: "Add a missing test",
          },
        ],
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "terminal/updated",
      payload: {
        session: {
          id: "terminal-1",
          threadId: "thread-1",
          workspaceId: "project-1",
          cwd: "/workspace",
          shell: "bash",
          backend: "pipe",
          status: "failed",
          exitCode: 1,
          failureReason: "spawn failed",
          startedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    expect(useAppStore.getState().terminals).toMatchObject([
      {
        id: "terminal-1",
        status: "failed",
        exitCode: 1,
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "terminal/output",
      payload: {
        sessionId: "terminal-1",
        threadId: "thread-1",
        delta: "hello from terminal\n",
        timestamp: new Date().toISOString(),
      },
    });

    expect(useAppStore.getState().terminalOutputs["terminal-1"]).toContain("hello from terminal");

    useAppStore.getState().handleEvent({
      type: "terminal/outputArchived",
      payload: {
        archive: {
          id: "archive-1",
          sessionId: "terminal-1",
          threadId: "thread-1",
          reason: "manual_archive",
          output: "older output",
          createdAt: new Date().toISOString(),
        },
      },
    });
    expect(useAppStore.getState().terminalOutputArchives).toMatchObject([
      {
        id: "archive-1",
        sessionId: "terminal-1",
        reason: "manual_archive",
      },
    ]);

    useAppStore.getState().handleEvent({
      type: "terminal/outputCleared",
      payload: {
        sessionId: "terminal-1",
        threadId: "thread-1",
        timestamp: new Date().toISOString(),
      },
    });
    expect(useAppStore.getState().terminalOutputs["terminal-1"]).toBe("");
  });

  it("renders review and steer entrypoints in the thread view source", () => {
    const source = readFileSync(join(process.cwd(), "src", "renderer", "App.tsx"), "utf8");

    expect(source).toContain("ReviewSummaryCard");
    expect(source).toContain("SteerCard");
    expect(source).toContain("TerminalCard");
    expect(source).toContain("threadTerminals");
    expect(source).toContain("selectedTerminalId");
    expect(source).toContain("reviewMenuOpen");
    expect(source).toContain("triggerReview");
    expect(source).toContain("terminalSessions");
    expect(source).toContain("terminalCapabilities");
    expect(source).toContain("createTerminalSession");
    expect(source).toContain("sendTerminalInput");
    expect(source).toContain("respondTerminalApproval");
    expect(source).toContain("archiveTerminal");
    expect(source).toContain("clearTerminal");
    expect(source).toContain("Archived output");
    expect(source).toContain("artifactSummary");
    expect(source).toContain("executionContextId");
    expect(source).toContain("Failure artifacts");
    expect(source).toContain("Retry step");
    expect(source).toContain("retainedFailures");
    expect(source).not.toContain('window.setInterval(() => {\n      void readOutput();');
  });

  it("keeps desktop bridge methods in sync for turn/steer and review APIs", () => {
    const mainSource = readFileSync(join(process.cwd(), "src", "main", "index.ts"), "utf8");
    const preloadSource = readFileSync(join(process.cwd(), "src", "preload", "index.ts"), "utf8");
    const envSource = readFileSync(join(process.cwd(), "src", "renderer", "env.d.ts"), "utf8");

    expect(mainSource).toContain('"turn:steer"');
    expect(mainSource).toContain('"review:start"');
    expect(mainSource).toContain('"review:list"');
    expect(preloadSource).toContain("steerTurn");
    expect(preloadSource).toContain("startReview");
    expect(preloadSource).toContain("listReviews");
    expect(preloadSource).toContain("respondTerminalApproval");
    expect(preloadSource).toContain("createTerminal");
    expect(preloadSource).toContain("writeTerminal");
    expect(preloadSource).toContain("readTerminal");
    expect(preloadSource).toContain("closeTerminal");
    expect(preloadSource).toContain("archiveTerminal");
    expect(preloadSource).toContain("clearTerminal");
    expect(preloadSource).toContain("retryFailedStepIds");
    expect(envSource).toContain("steerTurn");
    expect(envSource).toContain("startReview");
    expect(envSource).toContain("listReviews");
    expect(envSource).toContain("respondTerminalApproval");
    expect(envSource).toContain("createTerminal");
    expect(envSource).toContain("writeTerminal");
    expect(envSource).toContain("readTerminal");
    expect(envSource).toContain("closeTerminal");
    expect(envSource).toContain("archiveTerminal");
    expect(envSource).toContain("clearTerminal");
    expect(envSource).toContain("retryFailedStepIds");
    expect(mainSource).toContain('"terminal:approval:respond"');
    expect(mainSource).toContain('"terminal:create"');
    expect(mainSource).toContain('"terminal:write"');
    expect(mainSource).toContain('"terminal:read"');
    expect(mainSource).toContain('"terminal:close"');
    expect(mainSource).toContain('"terminal:archive"');
    expect(mainSource).toContain('"terminal:clear"');
    expect(mainSource).toContain('"workflow:resume"');
    expect(mainSource).toContain("retryFailedStepIds");
  });
});
