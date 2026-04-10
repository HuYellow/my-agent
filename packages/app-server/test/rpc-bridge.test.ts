import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
      homeDir: mkdtempSync(join(tmpdir(), "my-agent-app-server-")),
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
      homeDir: mkdtempSync(join(tmpdir(), "my-agent-app-server-")),
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
});
