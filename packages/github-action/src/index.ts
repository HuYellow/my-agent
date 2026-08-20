#!/usr/bin/env node

import { createRuntimeKernel } from "@yellow-flow/core/runtime-kernel";
import { appendFileSync } from "node:fs";

async function main() {
  const runtime = createRuntimeKernel({
    emitEvent: () => undefined,
  });

  try {
    const automationId = process.env.YELLOW_FLOW_AUTOMATION_ID;
    const workflowId = process.env.YELLOW_FLOW_WORKFLOW_ID;
    const projectId = process.env.YELLOW_FLOW_PROJECT_ID ?? runtime.database.getConfig().selectedProjectId;
    const prompt = process.env.YELLOW_FLOW_PROMPT;

    if (automationId) {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "automation-run",
        method: "automation/run",
        params: {
          automationId,
          trigger: "github_action",
          runner: "github-action",
          initiatedBy: "GitHub Actions",
        },
      });
      const run = "result" in response ? (response.result as { run?: { id?: string; summary?: string } }).run : undefined;
      writeGithubOutputs({
        mode: "automation",
        automation_id: automationId,
        automation_run_id: run?.id ?? "",
        summary: run?.summary ?? "",
        success: "result" in response ? "true" : "false",
      });
      writeGithubSummary("automation", response);
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      return;
    }

    if (workflowId && projectId) {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "workflow-run",
        method: "workflow/run",
        params: {
          workflowId,
          projectId,
          nonInteractive: true,
        },
      });
      writeGithubOutputs({
        mode: "workflow",
        success: "result" in response ? "true" : "false",
      });
      writeGithubSummary("workflow", response);
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      return;
    }

    if (prompt && projectId) {
      const threadResponse = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "thread-start",
        method: "thread/start",
        params: {
          projectId,
          title: process.env.YELLOW_FLOW_THREAD_TITLE ?? "GitHub Action Run",
        },
      });

      if (!("result" in threadResponse)) {
        throw new Error(threadResponse.error.message);
      }

      const threadId = (threadResponse.result as { thread: { id: string } }).thread.id;
      const turnResponse = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "turn-start",
        method: "turn/start",
        params: {
          threadId,
          input: prompt,
          includeIdeContext: false,
        },
      });
      writeGithubOutputs({
        mode: "prompt",
        thread_id: threadId,
        success: "result" in turnResponse ? "true" : "false",
      });
      writeGithubSummary("prompt", turnResponse);
      process.stdout.write(`${JSON.stringify(turnResponse, null, 2)}\n`);
      return;
    }

    throw new Error("Provide YELLOW_FLOW_WORKFLOW_ID + YELLOW_FLOW_PROJECT_ID, or YELLOW_FLOW_PROMPT + YELLOW_FLOW_PROJECT_ID.");
  } finally {
    runtime.dispose();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function writeGithubOutputs(values: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  for (const [key, value] of Object.entries(values)) {
    appendFileSync(outputPath, `${key}=${escapeGithubValue(value)}\n`, "utf8");
  }
}

function writeGithubSummary(mode: string, payload: unknown): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  const body = [
    `# Yellow Flow ${mode} result`,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
  ].join("\n");
  appendFileSync(summaryPath, body, "utf8");
}

function escapeGithubValue(value: string): string {
  return value.replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
