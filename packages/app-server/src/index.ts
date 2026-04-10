#!/usr/bin/env node

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRuntimeKernel, type RuntimeKernel } from "@my-agent/core/runtime-kernel";
import { type HarnessEvent, type JsonRpcRequest, type JsonRpcResponse } from "@my-agent/protocol";

export interface AppServerInstance {
  authToken: string;
  runtime: RuntimeKernel;
  server: Server;
  start: () => Promise<number>;
  stop: () => Promise<void>;
}

export function createAppServer(options: {
  authToken?: string;
  host?: string;
  homeDir?: string;
  port?: number;
  runtime?: RuntimeKernel;
  onListening?: (payload: { server: string; port: number; authToken: string; homeDir: string }) => void;
} = {}): AppServerInstance {
  const runtime =
    options.runtime ??
    createRuntimeKernel({
      homeDir: options.homeDir,
      emitEvent: (event) => broadcastEvent(event),
    });
  const clients = new Set<ServerResponse>();
  const authToken = options.authToken ?? process.env.MY_AGENT_SERVER_TOKEN ?? randomBytes(24).toString("hex");
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.MY_AGENT_APP_SERVER_PORT ?? 4318);
  const server = createServer(async (req, res) => {
    await handleHttpRequest({
      runtime,
      clients,
      authToken,
      req,
      res,
    });
  });

  function broadcastEvent(event: HarnessEvent): void {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

    for (const client of clients) {
      client.write(payload);
    }
  }

  return {
    authToken,
    runtime,
    server,
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      options.onListening?.({
        server: "my-agent-app-server",
        port: resolvedPort,
        authToken,
        homeDir: runtime.homeDir,
      });
      return resolvedPort;
    },
    async stop() {
      for (const client of clients) {
        client.end();
      }

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      runtime.dispose();
    },
  };
}

async function handleHttpRequest(params: {
  runtime: RuntimeKernel;
  clients: Set<ServerResponse>;
  authToken: string;
  req: IncomingMessage;
  res: ServerResponse;
}): Promise<void> {
  if (!authorize(params.req.headers.authorization, params.authToken)) {
    writeJson(params.res, 401, { error: "Unauthorized" });
    return;
  }

  const url = new URL(params.req.url ?? "/", `http://${params.req.headers.host ?? "127.0.0.1"}`);

  if (params.req.method === "GET" && url.pathname === "/health") {
    writeJson(params.res, 200, { ok: true, server: "my-agent-app-server" });
    return;
  }

  if (params.req.method === "GET" && url.pathname === "/events") {
    params.res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    params.res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    params.clients.add(params.res);
    params.req.on("close", () => {
      params.clients.delete(params.res);
    });
    return;
  }

  if (params.req.method === "GET" && url.pathname === "/api/initialize") {
    const result = await params.runtime.server.handle({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    });
    writeJson(params.res, 200, result);
    return;
  }

  if (params.req.method === "POST" && url.pathname === "/api/rpc") {
    const body = (await readJson(params.req)) as JsonRpcRequest;
    const result = await params.runtime.server.handle(body);
    writeJson(params.res, 200, result);
    return;
  }

  writeJson(params.res, 404, { error: "Not found" });
}

function authorize(header: string | undefined, authToken: string): boolean {
  if (!authToken) {
    return true;
  }

  return header === `Bearer ${authToken}`;
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body ? JSON.parse(body) : {};
}

async function main(): Promise<void> {
  const instance = createAppServer({
    onListening(payload) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    },
  });

  process.on("SIGINT", () => {
    void instance.stop().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void instance.stop().finally(() => process.exit(0));
  });

  await instance.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).toString()) {
  void main();
}
