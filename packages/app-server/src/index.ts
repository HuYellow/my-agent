#!/usr/bin/env node

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createRuntimeKernel } from "@my-agent/core/runtime-kernel";
import { type HarnessEvent, type JsonRpcRequest } from "@my-agent/protocol";

const runtime = createRuntimeKernel({
  emitEvent: (event) => broadcastEvent(event),
});

const clients = new Set<import("node:http").ServerResponse>();
const authToken = process.env.MY_AGENT_SERVER_TOKEN ?? randomBytes(24).toString("hex");
const port = Number(process.env.MY_AGENT_APP_SERVER_PORT ?? 4318);

const server = createServer(async (req, res) => {
  if (!authorize(req.headers.authorization)) {
    writeJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    writeJson(res, 200, { ok: true, server: "my-agent-app-server" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    clients.add(res);
    req.on("close", () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/initialize") {
    const result = await runtime.server.handle({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rpc") {
    const body = (await readJson(req)) as JsonRpcRequest;
    const result = await runtime.server.handle(body);
    writeJson(res, 200, result);
    return;
  }

  writeJson(res, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      server: "my-agent-app-server",
      port,
      authToken,
      homeDir: runtime.homeDir,
    })}\n`,
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown(): void {
  for (const client of clients) {
    client.end();
  }
  server.close(() => {
    runtime.dispose();
    process.exit(0);
  });
}

function authorize(header: string | undefined): boolean {
  if (!authToken) {
    return true;
  }

  return header === `Bearer ${authToken}`;
}

function broadcastEvent(event: HarnessEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of clients) {
    client.write(payload);
  }
}

function writeJson(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

async function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body ? JSON.parse(body) : {};
}
