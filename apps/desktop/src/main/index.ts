import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  type ApprovalResponseParams,
  type ConfigWriteParams,
  type HarnessEvent,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type StartThreadParams,
  type StartTurnParams,
} from "@my-agent/protocol";

class HarnessClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: HarnessEvent) => void>();

  start(coreEntry: string): void {
    if (this.child) {
      return;
    }

    this.child = spawn(resolveNodeBinary(), [coreEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const output = createInterface({
      input: this.child.stdout,
      terminal: false,
    });

    output.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      const message = JSON.parse(line) as JsonRpcMessage;

      if ("id" in message && ("result" in message || "error" in message)) {
        this.handleResponse(message as JsonRpcResponse);
        return;
      }

      if ("method" in message) {
        const notification = message as JsonRpcNotification;
        const event = {
          type: notification.method,
          payload: notification.params,
        } as HarnessEvent;
        for (const listener of this.listeners) {
          listener(event);
        }
      }
    });

    this.child.stderr.on("data", (chunk) => {
      console.error(`[my-agent-core] ${chunk.toString()}`);
    });

    this.child.on("exit", () => {
      this.child = null;
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  onEvent(listener: (event: HarnessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    if (!this.child) {
      throw new Error("Harness process is not running.");
    }

    const id = String(this.nextId++);
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return promise;
  }

  private handleResponse(message: JsonRpcResponse): void {
    const handler = this.pending.get(message.id);

    if (!handler) {
      return;
    }

    this.pending.delete(message.id);

    if ("error" in message) {
      handler.reject(new Error(message.error.message));
      return;
    }

    handler.resolve(message.result);
  }
}

let mainWindow: BrowserWindow | null = null;
const harness = new HarnessClient();

async function createWindow(): Promise<void> {
  const preload = resolve(app.getAppPath(), "dist-electron", "preload", "index.cjs");
  const devServerUrl = process.env.MY_AGENT_DEV_SERVER_URL;

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1240,
    minHeight: 760,
    backgroundColor: "#0b1020",
    title: "my-agent",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererHtml = resolve(app.getAppPath(), "dist", "index.html");

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  if (existsSync(rendererHtml)) {
    await mainWindow.loadURL(pathToFileURL(rendererHtml).toString());
    return;
  }

  throw new Error(`Renderer entry was not found at ${rendererHtml} and no dev server URL was provided.`);
}

function registerIpc(): void {
  harness.onEvent((event) => {
    mainWindow?.webContents.send("harness:event", event);
  });

  ipcMain.handle("harness:initialize", () => harness.request("initialize"));
  ipcMain.handle("thread:start", (_event, params: StartThreadParams) => harness.request("thread/start", params));
  ipcMain.handle("thread:resume", (_event, params: { threadId: string }) => harness.request("thread/resume", params));
  ipcMain.handle("turn:start", (_event, params: StartTurnParams) => harness.request("turn/start", params));
  ipcMain.handle("approval:respond", (_event, params: ApprovalResponseParams) => harness.request("approval/respond", params));
  ipcMain.handle("skills:list", () => harness.request("skills/list"));
  ipcMain.handle("skills:config:write", (_event, params: { disabledSkillIds: string[] }) => harness.request("skills/config/write", params));
  ipcMain.handle("config:read", () => harness.request("config/read"));
  ipcMain.handle("config:write", (_event, params: ConfigWriteParams) => harness.request("config/write", params));
  ipcMain.handle("provider:test", () => harness.request("provider/test"));
  ipcMain.handle("workspace:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });

    return result.filePaths[0] ?? null;
  });
}

app.whenReady().then(async () => {
  const coreEntry = resolve(app.getAppPath(), "../../packages/core/dist/index.js");
  harness.start(coreEntry);
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  harness.stop();
});

function resolveNodeBinary(): string {
  const candidates = [process.env.MY_AGENT_NODE_BINARY, process.env.npm_node_execpath, "node"];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate === "node") {
      return candidate;
    }

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "node";
}
