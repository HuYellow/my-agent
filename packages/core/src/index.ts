#!/usr/bin/env node

import dns from "node:dns";
import { createInterface } from "node:readline";
import { type JsonRpcMessage, type JsonRpcNotification, type JsonRpcRequest } from "@my-agent/protocol";
import { HarnessServer } from "./rpc/harness-server.js";
import { PromptBuilder } from "./services/prompt-builder.js";
import { getDefaultHomeDir, getDefaultSystemSkillsRoot, SkillService } from "./services/skill-service.js";
import { HarnessDatabase, getDefaultDatabasePath } from "./store/database.js";

// Prefer IPv4 first to avoid intermittent undici/OpenAI client connection failures
// on some Windows + Cloudflare-backed providers where IPv6/dual-stack resolution is flaky.
dns.setDefaultResultOrder("ipv4first");

const homeDir = process.env.MY_AGENT_HOME ?? getDefaultHomeDir();
const database = new HarnessDatabase(getDefaultDatabasePath(homeDir));
const skillService = new SkillService(getDefaultSystemSkillsRoot(), homeDir, (skills) => {
  writeJson({
    jsonrpc: "2.0",
    method: "skills/changed",
    params: { skills },
  } satisfies JsonRpcNotification);
});
const promptBuilder = new PromptBuilder(skillService);
const server = new HarnessServer(database, skillService, promptBuilder, writeJson, homeDir);

const reader = createInterface({
  input: process.stdin,
  output: process.stderr,
  terminal: false,
});

reader.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }

  try {
    const message = JSON.parse(line) as JsonRpcMessage;

    if (!("id" in message) || !("method" in message)) {
      return;
    }

    const response = await server.handle(message as JsonRpcRequest);
    writeJson(response);
  } catch (error) {
    writeJson({
      jsonrpc: "2.0",
      id: "unknown",
      error: {
        code: -32700,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

process.on("exit", () => {
  server.dispose();
});

function writeJson(message: JsonRpcMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
