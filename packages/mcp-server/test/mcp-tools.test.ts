import { afterEach, describe, expect, it } from "vitest";
import { createMcpServerRuntime } from "../src/index.js";

const runtimes: Array<ReturnType<typeof createMcpServerRuntime>> = [];

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()!.dispose();
  }
});

describe("mcp-server tool compatibility", () => {
  it("exposes governed tool catalog and protocol compatibility tools", async () => {
    const runtime = createMcpServerRuntime();
    runtimes.push(runtime);

    const toolsList = await runtime.handleMessage({
      jsonrpc: "2.0",
      id: "tools-list",
      method: "tools/list",
    } as any);

    expect(toolsList && "result" in toolsList && (toolsList as any).result.tools.map((tool: any) => tool.name)).toEqual(
      expect.arrayContaining(["list_runtime_tools", "get_protocol_compatibility"]),
    );
  });

  it("returns tool/list and compatibility data through MCP tool calls", async () => {
    const runtime = createMcpServerRuntime();
    runtimes.push(runtime);

    const toolCatalog = JSON.parse(await runtime.callTool("list_runtime_tools", {}));
    const compatibility = JSON.parse(await runtime.callTool("get_protocol_compatibility", {}));

    expect(toolCatalog.tools.some((tool: any) => tool.source.type === "local")).toBe(true);
    expect(compatibility.compatibility.structuredEventTypes).toEqual(
      expect.arrayContaining(["tools/catalogUpdated"]),
    );
  });
});
