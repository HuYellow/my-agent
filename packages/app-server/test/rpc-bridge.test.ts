import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeKernel } from "@yellow-flow/core/runtime-kernel";
import { createAppServer, type AppServerInstance } from "../src/index.js";

const runningServers: AppServerInstance[] = [];

afterEach(async () => {
  while (runningServers.length > 0) {
    await runningServers.pop()!.stop();
  }
});

describe("app-server RPC bridge", () => {
  it("forwards initialize and tool/list with compatibility metadata over HTTP", async () => {
    const instance = createAppServer({
      authToken: "test-token",
      homeDir: mkdtempSync(join(tmpdir(), "yellow-flow-app-server-")),
      port: 0,
    });
    runningServers.push(instance);
    const port = await instance.start();

    const initializeResponse = await fetch(`http://127.0.0.1:${port}/api/initialize`, {
      headers: {
        Authorization: "Bearer test-token",
      },
    }).then((response) => response.json() as Promise<any>);
    const toolListResponse = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tool-list",
        method: "tool/list",
      }),
    }).then((response) => response.json() as Promise<any>);

    expect(initializeResponse.result.compatibility.protocolVersion).toBe("0.1.0");
    expect(initializeResponse.result.compatibility.structuredEventTypes).toEqual(
      expect.arrayContaining(["tools/catalogUpdated"]),
    );
    expect(initializeResponse.result.tools.some((tool: any) => tool.source.type === "local")).toBe(true);
    expect(toolListResponse.result.tools.some((tool: any) => tool.source.type === "local")).toBe(true);
  });

  it("streams tools/catalogUpdated over SSE when runtime config changes", async () => {
    const instance = createAppServer({
      authToken: "test-token",
      homeDir: mkdtempSync(join(tmpdir(), "yellow-flow-app-server-")),
      port: 0,
    });
    runningServers.push(instance);
    const port = await instance.start();
    const eventsResponse = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: {
        Authorization: "Bearer test-token",
      },
    });

    expect(eventsResponse.ok).toBe(true);
    expect(eventsResponse.body).toBeTruthy();

    const reader = eventsResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const nextCatalogEvent = async () => {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          return null;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const eventLine = chunk.split(/\r?\n/).find((line) => line.startsWith("event: "));
          const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));

          if (!eventLine || !dataLine) {
            continue;
          }

          if (eventLine.slice("event: ".length) !== "tools/catalogUpdated") {
            continue;
          }

          return JSON.parse(dataLine.slice("data: ".length)) as any;
        }
      }
    };

    await fetch(`http://127.0.0.1:${port}/api/rpc`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "config-write",
        method: "config/write",
        params: {
          config: {},
        },
      }),
    });

    const catalogEvent = await nextCatalogEvent();
    expect(catalogEvent?.payload?.tools?.some((tool: any) => tool.source.type === "local")).toBe(true);
  });

  it("schedules due automation runs in headless app-server mode", async () => {
    const runtime = createRuntimeKernel({
      homeDir: mkdtempSync(join(tmpdir(), "yellow-flow-app-server-")),
      emitEvent: () => undefined,
    });
    const now = new Date().toISOString();
    const project = runtime.database.listProjects()[0]!;
    runtime.database.createAutomation({
      id: "automation-due",
      name: "Due automation",
      kind: "workflow",
      projectId: project.id,
      scheduleType: "interval",
      intervalMinutes: 1,
      status: "active",
      lastRunStatus: "idle",
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    const instance = createAppServer({
      authToken: "test-token",
      runtime,
      port: 0,
      schedulerPollIntervalMs: 50,
    });
    runningServers.push(instance);
    await instance.start();

    const deadline = Date.now() + 2_000;
    let runs = runtime.database.listAutomationRuns({ automationId: "automation-due" });

    while (runs.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      runs = runtime.database.listAutomationRuns({ automationId: "automation-due" });
    }

    expect(runs[0]).toMatchObject({
      trigger: "scheduler",
      runner: "app-server",
      status: "failed",
    });
    expect(runtime.database.listAutomationRunLogs({ runId: runs[0]!.id }).length).toBeGreaterThan(0);
  });
});
