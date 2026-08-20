import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpSessionManager } from "../src/services/mcp-session-manager.js";
import { HarnessDatabase } from "../src/store/database.js";

const childProcesses: McpSessionManager[] = [];

afterEach(async () => {
  await Promise.all(childProcesses.splice(0).map((manager) => manager.reconnect("test-mount").catch(() => undefined)));
});

describe("McpSessionManager", () => {
  it("marks stdio mounts as failed when the command cannot be spawned", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-mcp-session-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const manager = new McpSessionManager(database, () => undefined);
    const now = new Date().toISOString();
    const mount = database.upsertMcpMount({
      id: "bad-mount",
      name: "Bad Mount",
      transport: "stdio",
      command: "this-command-definitely-does-not-exist",
      args: [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(manager.refreshMount(mount)).rejects.toThrow();

    expect(database.getMcpSessionByMountId(mount.id)).toMatchObject({
      mountId: mount.id,
      status: "failed",
      transport: "stdio",
    });
  });

  it("ignores stdio notifications and resolves the matching response id", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-mcp-session-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const script = writeMcpServer(root, `
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", method: "notifications/progress", params: { message: "booting" } });
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        return;
      }
      if (message.method === "tools/call") {
        send({ jsonrpc: "2.0", method: "notifications/progress", params: { message: "calling" } });
        send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: message.params.name }] } });
      }
    `);
    const manager = new McpSessionManager(database, () => undefined);
    childProcesses.push(manager);
    const mount = createStdioMount(database, script);

    const result = JSON.parse(await manager.callTool(mount, "notification-safe", {}));

    expect(result).toMatchObject({
      id: "2",
      result: {
        content: [
          {
            text: "notification-safe",
          },
        ],
      },
    });
  });

  it("routes concurrent stdio responses by id when they arrive out of order", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-mcp-session-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const script = writeMcpServer(root, `
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        return;
      }
      if (message.method === "tools/call") {
        const delay = message.params.name === "first" ? 50 : 5;
        setTimeout(() => {
          send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: message.params.name }] } });
        }, delay);
      }
    `);
    const manager = new McpSessionManager(database, () => undefined);
    childProcesses.push(manager);
    const mount = createStdioMount(database, script);
    await manager.refreshMount(mount);

    const [first, second] = await Promise.all([
      manager.callTool(mount, "first", {}),
      manager.callTool(mount, "second", {}),
    ]);

    expect(JSON.parse(first)).toMatchObject({ id: "5", result: { content: [{ text: "first" }] } });
    expect(JSON.parse(second)).toMatchObject({ id: "6", result: { content: [{ text: "second" }] } });
  });

  it("rejects pending stdio requests when the server exits", async () => {
    const root = mkdtempSync(join(tmpdir(), "yellow-flow-mcp-session-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const script = writeMcpServer(root, `
      if (message.method === "initialize") {
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        return;
      }
      if (message.method === "tools/call") {
        setTimeout(() => process.exit(42), 5);
      }
    `);
    const manager = new McpSessionManager(database, () => undefined);
    childProcesses.push(manager);
    const mount = createStdioMount(database, script);
    await manager.refreshMount(mount);

    await expect(manager.callTool(mount, "exit", {})).rejects.toThrow(/exited before responding|Timed out waiting for MCP response/);
    expect(database.getMcpSessionByMountId(mount.id)?.status).toBe("closed");
  });
});

function createStdioMount(database: HarnessDatabase, script: string) {
  const now = new Date().toISOString();
  return database.upsertMcpMount({
    id: "test-mount",
    name: "Test Mount",
    transport: "stdio",
    command: process.execPath,
    args: [script],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

function writeMcpServer(root: string, handlerBody: string): string {
  const script = join(root, "mcp-server.cjs");
  writeFileSync(
    script,
    `
let buffer = "";

function send(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
}

function consume() {
  while (true) {
    const separatorIndex = buffer.indexOf("\\r\\n\\r\\n");
    if (separatorIndex === -1) return;
    const header = buffer.slice(0, separatorIndex);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) return;
    const length = Number(match[1]);
    const bodyStart = separatorIndex + 4;
    const body = buffer.slice(bodyStart, bodyStart + length);
    if (body.length < length) return;
    buffer = buffer.slice(bodyStart + length);
    const message = JSON.parse(body);
    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
      continue;
    }
    if (message.method === "prompts/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { prompts: [] } });
      continue;
    }
    if (message.method === "resources/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { resources: [] } });
      continue;
    }
    ${handlerBody}
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  consume();
});
`,
  );
  return script;
}
