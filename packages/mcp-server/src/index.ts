#!/usr/bin/env node

import { createRuntimeKernel } from "@my-agent/core/runtime-kernel";

const runtime = createRuntimeKernel({
  emitEvent: () => undefined,
});

let buffer = "";
process.stdin.on("data", async (chunk) => {
  buffer += chunk.toString();

  while (true) {
    const separatorIndex = buffer.indexOf("\r\n\r\n");

    if (separatorIndex === -1) {
      break;
    }

    const header = buffer.slice(0, separatorIndex);
    const match = header.match(/Content-Length:\s*(\d+)/i);

    if (!match) {
      buffer = "";
      break;
    }

    const contentLength = Number(match[1]);
    const totalLength = separatorIndex + 4 + contentLength;

    if (buffer.length < totalLength) {
      break;
    }

    const payload = buffer.slice(separatorIndex + 4, totalLength);
    buffer = buffer.slice(totalLength);

    const message = JSON.parse(payload) as { id?: string | number; method?: string; params?: any };
    const response = await handleMcpMessage(message);
    if (response) {
      writeMessage(response);
    }
  }
});

process.on("SIGINT", () => runtime.dispose());
process.on("SIGTERM", () => runtime.dispose());

async function handleMcpMessage(message: { id?: string | number; method?: string; params?: any }) {
  switch (message.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "my-agent-mcp-server",
            version: "0.1.0",
          },
          capabilities: {
            tools: {},
          },
        },
      };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "list_threads",
              description: "List runtime threads.",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
            {
              name: "start_turn",
              description: "Start a new turn in a thread.",
              inputSchema: {
                type: "object",
                properties: {
                  threadId: { type: "string" },
                  input: { type: "string" },
                },
                required: ["threadId", "input"],
                additionalProperties: false,
              },
            },
            {
              name: "read_file",
              description: "Read a file via the runtime.",
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
                additionalProperties: false,
              },
            },
            {
              name: "run_workflow",
              description: "Run a workflow via the runtime.",
              inputSchema: {
                type: "object",
                properties: {
                  workflowId: { type: "string" },
                  projectId: { type: "string" },
                },
                required: ["workflowId", "projectId"],
                additionalProperties: false,
              },
            },
          ],
        },
      };
    case "tools/call":
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: await callTool(message.params?.name, message.params?.arguments ?? {}),
            },
          ],
        },
      };
    default:
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Unknown MCP method: ${message.method}`,
        },
      };
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "list_threads": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "thread-list",
        method: "thread/list",
      });
      return JSON.stringify("result" in response ? response.result : response.error, null, 2);
    }
    case "start_turn": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "turn-start",
        method: "turn/start",
        params: args,
      });
      return JSON.stringify("result" in response ? response.result : response.error, null, 2);
    }
    case "read_file": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "file-read",
        method: "fs/readFile",
        params: args,
      });
      return JSON.stringify("result" in response ? response.result : response.error, null, 2);
    }
    case "run_workflow": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "workflow-run",
        method: "workflow/run",
        params: args,
      });
      return JSON.stringify("result" in response ? response.result : response.error, null, 2);
    }
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

function writeMessage(payload: unknown): void {
  const json = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}
