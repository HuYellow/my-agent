#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { createRuntimeKernel, type RuntimeKernel } from "@my-agent/core/runtime-kernel";
import { type InitializeResult } from "@my-agent/protocol";

type McpMessage = { id?: string | number; method?: string; params?: any };
type McpResponse = { jsonrpc: "2.0"; id?: string | number; result?: unknown; error?: { code: number; message: string } };

export interface McpServerRuntime {
  runtime: RuntimeKernel;
  handleMessage: (message: McpMessage) => Promise<McpResponse | null>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  dispose: () => void;
}

export function createMcpServerRuntime(options: { runtime?: RuntimeKernel } = {}): McpServerRuntime {
  const runtime =
    options.runtime ??
    createRuntimeKernel({
      emitEvent: () => undefined,
    });

  return {
    runtime,
    handleMessage: (message) => handleMcpMessage(runtime, message),
    callTool: (name, args) => callTool(runtime, name, args),
    dispose: () => runtime.dispose(),
  };
}

export async function handleMcpMessage(runtime: RuntimeKernel, message: McpMessage): Promise<McpResponse | null> {
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
              name: "steer_turn",
              description: "Inject a steer instruction into a running turn.",
              inputSchema: {
                type: "object",
                properties: {
                  turnId: { type: "string" },
                  input: { type: "string" },
                  priority: { type: "string", enum: ["low", "normal", "high"] },
                },
                required: ["turnId", "input"],
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
              name: "list_runtime_tools",
              description: "List the governed runtime tool catalog with structured source and capability metadata.",
              inputSchema: {
                type: "object",
                properties: {
                  projectId: { type: "string" },
                  threadId: { type: "string" },
                },
                additionalProperties: false,
              },
            },
            {
              name: "get_protocol_compatibility",
              description: "Read protocol compatibility guarantees and structured event support from initialize.",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
            {
              name: "start_review",
              description: "Start a structured code review against a diff source.",
              inputSchema: {
                type: "object",
                properties: {
                  projectId: { type: "string" },
                  threadId: { type: "string" },
                  instructions: { type: "string" },
                  source: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: ["workspace", "staged", "base_branch", "commit"] },
                      baseBranch: { type: "string" },
                      commit: { type: "string" },
                    },
                    required: ["kind"],
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
            },
            {
              name: "list_reviews",
              description: "List structured review runs.",
              inputSchema: {
                type: "object",
                properties: {
                  projectId: { type: "string" },
                  threadId: { type: "string" },
                },
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
              text: await callTool(runtime, message.params?.name, message.params?.arguments ?? {}),
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

export async function callTool(runtime: RuntimeKernel, name: string, args: Record<string, unknown>): Promise<string> {
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
    case "steer_turn": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "turn-steer",
        method: "turn/steer",
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
    case "list_runtime_tools": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "tool-list",
        method: "tool/list",
        params: args,
      });
      return JSON.stringify("result" in response ? response.result : response.error, null, 2);
    }
    case "get_protocol_compatibility": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "initialize",
        method: "initialize",
      });
      const initialize = "result" in response ? (response.result as InitializeResult) : null;
      return JSON.stringify(
        initialize
          ? {
              protocolVersion: initialize.protocolVersion,
              compatibility: initialize.compatibility,
            }
          : "error" in response
            ? response.error
            : { code: -32000, message: "Unknown initialize failure." },
        null,
        2,
      );
    }
    case "start_review": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "review-start",
        method: "review/start",
        params: args,
      });
      return JSON.stringify("result" in response ? response.result : response.error, null, 2);
    }
    case "list_reviews": {
      const response = await runtime.server.handle({
        jsonrpc: "2.0",
        id: "review-list",
        method: "review/list",
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

async function main(): Promise<void> {
  const server = createMcpServerRuntime();
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

      const message = JSON.parse(payload) as McpMessage;
      const response = await server.handleMessage(message);
      if (response) {
        writeMessage(response);
      }
    }
  });

  process.on("SIGINT", () => server.dispose());
  process.on("SIGTERM", () => server.dispose());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).toString()) {
  void main();
}
