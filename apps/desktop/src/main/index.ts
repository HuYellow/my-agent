import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  type ApprovalResponseParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type StartThreadParams,
  type StartTurnParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

type TitleBarTheme = "light" | "dark";
type AppMenuId = "file" | "edit" | "view" | "window" | "help";

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
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: getTitleBarOverlay("dark"),
          autoHideMenuBar: true,
        }
      : {}),
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

  if (process.platform === "win32") {
    mainWindow.setMenuBarVisibility(false);
  }

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
  ipcMain.handle("project:create", (_event, params: CreateProjectParams) => harness.request("project/create", params));
  ipcMain.handle("project:update", (_event, params: UpdateProjectParams) => harness.request("project/update", params));
  ipcMain.handle("thread:start", (_event, params: StartThreadParams) => harness.request("thread/start", params));
  ipcMain.handle("thread:resume", (_event, params: { threadId: string }) => harness.request("thread/resume", params));
  ipcMain.handle("turn:start", (_event, params: StartTurnParams) => harness.request("turn/start", params));
  ipcMain.handle("approval:respond", (_event, params: ApprovalResponseParams) => harness.request("approval/respond", params));
  ipcMain.handle("skills:list", () => harness.request("skills/list"));
  ipcMain.handle("skills:config:write", (_event, params: { disabledSkillIds: string[] }) => harness.request("skills/config/write", params));
  ipcMain.handle("config:read", () => harness.request("config/read"));
  ipcMain.handle("config:write", (_event, params: ConfigWriteParams) => harness.request("config/write", params));
  ipcMain.handle("provider:test", () => harness.request("provider/test"));
  ipcMain.handle("window:set-titlebar-theme", (_event, theme: TitleBarTheme) => {
    if (process.platform !== "win32" || !mainWindow) {
      return;
    }

    mainWindow.setTitleBarOverlay(getTitleBarOverlay(theme));
  });
  ipcMain.handle("window:show-app-menu", (_event, params: { menuId: AppMenuId; x: number; y: number }) => {
    if (!mainWindow) {
      return;
    }

    const section = getAppMenuSections().find((entry) => entry.id === params.menuId);

    if (!section) {
      return;
    }

    Menu.buildFromTemplate(section.submenu).popup({
      window: mainWindow,
      x: Math.round(params.x),
      y: Math.round(params.y),
    });
  });
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
  Menu.setApplicationMenu(buildApplicationMenu());
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

function buildApplicationMenu() {
  return Menu.buildFromTemplate(
    getAppMenuSections().map((section) => ({
      label: section.label,
      submenu: section.submenu,
    })),
  );
}

function getAppMenuSections(): Array<{ id: AppMenuId; label: string; submenu: MenuItemConstructorOptions[] }> {
  return [
    {
      id: "file",
      label: "File",
      submenu: [
        {
          label: "Close Window",
          role: "close",
        },
        {
          type: "separator",
        },
        {
          label: "Quit my-agent",
          role: "quit",
        },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      id: "view",
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      id: "window",
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      id: "help",
      label: "Help",
      submenu: [
        {
          label: "About my-agent",
          click: () => {
            const options = {
              type: "info",
              title: "About my-agent",
              message: "my-agent",
              detail: "Mind Atlas for threads, context, skills, and runtime orchestration.",
            } as const;

            if (mainWindow) {
              void dialog.showMessageBox(mainWindow, options);
              return;
            }

            void dialog.showMessageBox(options);
          },
        },
      ],
    },
  ];
}

function getTitleBarOverlay(theme: TitleBarTheme) {
  if (theme === "light") {
    return {
      color: "#efe7db",
      symbolColor: "#221b15",
      height: 52,
    };
  }

  return {
    color: "#13171c",
    symbolColor: "#f4ecdc",
    height: 52,
  };
}
