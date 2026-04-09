import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import {
  type ApprovalResponseParams,
  type CommandExecParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type EnvironmentDetectParams,
  type HarnessEvent,
  type InterruptTurnParams,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type CreateRequirementParams,
  type RequirementAssignThreadParams,
  type RequirementGetParams,
  type RequirementListParams,
  type RequirementUnassignThreadParams,
  type ReviewStartParams,
  type StartThreadParams,
  type StartTurnParams,
  type TerminalArchiveParams,
  type TerminalApprovalResponseParams,
  type TerminalClearBufferParams,
  type TerminalCloseParams,
  type TerminalCreateParams,
  type TerminalReadParams,
  type TerminalResizeParams,
  type TerminalWriteParams,
  type TurnInputAttachment,
  type TurnSteerParams,
  type UpdateRequirementParams,
  type WorkflowRunParams,
  type WorktreeCreateParams,
  type WorktreeListParams,
  type WorktreeRemoveParams,
  type UpdateThreadParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

type TitleBarTheme = "light" | "dark";
type AppMenuId = "file" | "edit" | "view" | "window" | "help";

class HarnessClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private serverChild: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: HarnessEvent) => void>();
  private activeServerUrl: string | null = process.env.MY_AGENT_SERVER_URL?.replace(/\/$/, "") ?? null;
  private activeServerToken: string | null = process.env.MY_AGENT_SERVER_TOKEN ?? null;
  private serverAbortController: AbortController | null = null;

  start(coreEntry: string, appServerEntry: string): void {
    const backendMode = process.env.MY_AGENT_BACKEND_MODE ?? "server";

    if (this.activeServerUrl) {
      this.startRemoteEventStream();
      return;
    }

    if (backendMode !== "stdio") {
      if (existsSync(appServerEntry)) {
        this.startLocalServer(appServerEntry);
        return;
      }

      safeConsoleLog(
        `[my-agent] App server entry not found at ${appServerEntry}; falling back to stdio harness.`,
      );
    }

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
      safeConsoleError(`[my-agent-core] ${chunk.toString()}`);
    });

    this.child.on("exit", () => {
      this.child = null;
    });
  }

  stop(): void {
    this.serverAbortController?.abort();
    this.serverAbortController = null;
    this.serverChild?.kill();
    this.serverChild = null;
    this.child?.kill();
    this.child = null;
  }

  onEvent(listener: (event: HarnessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    if (this.activeServerUrl) {
      return this.requestRemote<TResult>(method, params);
    }

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

    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      this.pending.delete(id);
      throw wrapPipeError(error, "Failed to write to my-agent-core. The harness process may have exited.");
    }
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

  private startLocalServer(appServerEntry: string): void {
    if (this.serverChild || this.activeServerUrl) {
      return;
    }

    const port = process.env.MY_AGENT_APP_SERVER_PORT ?? "4318";
    const token = process.env.MY_AGENT_SERVER_TOKEN ?? `desktop-${Date.now()}`;
    const child = spawn(resolveNodeBinary(), [appServerEntry], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MY_AGENT_APP_SERVER_PORT: port,
        MY_AGENT_SERVER_TOKEN: token,
      },
    });
    this.serverChild = child;
    const output = createInterface({
      input: child.stdout!,
      terminal: false,
    });
    output.on("line", (line) => {
      try {
        const payload = JSON.parse(line) as { port?: number; authToken?: string };
        if (payload.port) {
          this.activeServerUrl = `http://127.0.0.1:${payload.port}`;
          this.activeServerToken = payload.authToken ?? token;
          this.startRemoteEventStream();
        }
      } catch {
        safeConsoleLog(line);
      }
    });
    child.stderr?.on("data", (chunk) => {
      safeConsoleError(`[my-agent-app-server] ${chunk.toString()}`);
    });
    child.on("exit", () => {
      this.serverChild = null;
      this.activeServerUrl = null;
    });
  }

  private async requestRemote<TResult>(method: string, params?: unknown): Promise<TResult> {
    if (!this.activeServerUrl) {
      throw new Error("Remote runtime server is not configured.");
    }

    if (method === "initialize") {
      const response = await fetch(`${this.activeServerUrl}/api/initialize`, {
        headers: this.buildRemoteHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Remote initialize failed (${response.status}).`);
      }
      const payload = (await response.json()) as JsonRpcResponse;
      if ("error" in payload) {
        throw new Error(payload.error.message);
      }
      return payload.result as TResult;
    }

    const rpcRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: String(this.nextId++),
      method,
      params,
    };
    const response = await fetch(`${this.activeServerUrl}/api/rpc`, {
      method: "POST",
      headers: {
        ...this.buildRemoteHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rpcRequest),
    });
    if (!response.ok) {
      throw new Error(`Remote runtime request failed (${response.status}).`);
    }
    const payload = (await response.json()) as JsonRpcResponse;
    if ("error" in payload) {
      throw new Error(payload.error.message);
    }
    return payload.result as TResult;
  }

  private startRemoteEventStream(): void {
    if (!this.activeServerUrl || this.serverAbortController) {
      return;
    }

    const controller = new AbortController();
    this.serverAbortController = controller;
    void (async () => {
      try {
        const response = await fetch(`${this.activeServerUrl}/events`, {
          headers: this.buildRemoteHeaders(),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const event = parseSseEvent(chunk);
            if (!event) {
              continue;
            }
            for (const listener of this.listeners) {
              listener(event);
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          safeConsoleError(`[my-agent-app-server] ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        this.serverAbortController = null;
      }
    })();
  }

  private buildRemoteHeaders(): Record<string, string> {
    return this.activeServerToken ? { Authorization: `Bearer ${this.activeServerToken}` } : {};
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
    backgroundColor: "#efe7dc",
    title: "my-agent",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererHtml = resolve(app.getAppPath(), "dist", "index.html");

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    safeConsoleError(`[renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    safeConsoleLog(`[renderer:${level}] ${sourceId}:${line} ${message}`);
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
  ipcMain.handle("requirement:list", (_event, params: RequirementListParams) => harness.request("requirement/list", params));
  ipcMain.handle("requirement:get", (_event, params: RequirementGetParams) => harness.request("requirement/get", params));
  ipcMain.handle("requirement:create", (_event, params: CreateRequirementParams) => harness.request("requirement/create", params));
  ipcMain.handle("requirement:update", (_event, params: UpdateRequirementParams) => harness.request("requirement/update", params));
  ipcMain.handle("requirement:assign-thread", (_event, params: RequirementAssignThreadParams) =>
    harness.request("requirement/assignThread", params),
  );
  ipcMain.handle("requirement:unassign-thread", (_event, params: RequirementUnassignThreadParams) =>
    harness.request("requirement/unassignThread", params),
  );
  ipcMain.handle("project:path:reveal", async (_event, params: { projectPath: string }) => {
    const error = await shell.openPath(params.projectPath);
    return { ok: error.length === 0, error: error || undefined };
  });
  ipcMain.handle("thread:start", (_event, params: StartThreadParams) => harness.request("thread/start", params));
  ipcMain.handle("thread:resume", (_event, params: { threadId: string }) => harness.request("thread/resume", params));
ipcMain.handle("thread:update", (_event, params: UpdateThreadParams) => harness.request("thread/update", params));
ipcMain.handle("turn:start", (_event, params: StartTurnParams) => harness.request("turn/start", params));
ipcMain.handle("turn:steer", (_event, params: TurnSteerParams) => harness.request("turn/steer", params));
ipcMain.handle("turn:interrupt", (_event, params: InterruptTurnParams) => harness.request("turn/interrupt", params));
ipcMain.handle("review:start", (_event, params: ReviewStartParams) => harness.request("review/start", params));
ipcMain.handle("review:list", (_event, params: { projectId?: string; threadId?: string }) => harness.request("review/list", params));
ipcMain.handle("terminal:create", (_event, params: TerminalCreateParams) => harness.request("terminal/create", params));
ipcMain.handle("terminal:write", (_event, params: TerminalWriteParams) => harness.request("terminal/write", params));
ipcMain.handle("terminal:read", (_event, params: TerminalReadParams) => harness.request("terminal/read", params));
ipcMain.handle("terminal:archive", (_event, params: TerminalArchiveParams) => harness.request("terminal/archive", params));
ipcMain.handle("terminal:clear", (_event, params: TerminalClearBufferParams) => harness.request("terminal/clear", params));
ipcMain.handle("terminal:resize", (_event, params: TerminalResizeParams) => harness.request("terminal/resize", params));
ipcMain.handle("terminal:close", (_event, params: TerminalCloseParams) => harness.request("terminal/close", params));
ipcMain.handle("terminal:approval:respond", (_event, params: TerminalApprovalResponseParams) =>
  harness.request("terminal/approval/respond", params),
);
ipcMain.handle("command:exec", (_event, params: CommandExecParams) => harness.request("command/exec", params));
  ipcMain.handle("approval:respond", (_event, params: ApprovalResponseParams) => harness.request("approval/respond", params));
  ipcMain.handle("skills:list", () => harness.request("skills/list"));
  ipcMain.handle("skills:config:write", (_event, params: { disabledSkillIds: string[] }) => harness.request("skills/config/write", params));
  ipcMain.handle("skills:document:read", async (_event, params: { skillPath: string }) => ({
    content: await fs.readFile(join(params.skillPath, "SKILL.md"), "utf8"),
  }));
  ipcMain.handle("skills:path:reveal", async (_event, params: { skillPath: string }) => {
    const skillFile = join(params.skillPath, "SKILL.md");

    if (existsSync(skillFile)) {
      shell.showItemInFolder(skillFile);
      return { ok: true };
    }

    const error = await shell.openPath(params.skillPath);
    return { ok: error.length === 0, error: error || undefined };
  });
  ipcMain.handle("config:read", () => harness.request("config/read"));
  ipcMain.handle("config:write", (_event, params: ConfigWriteParams) => harness.request("config/write", params));
  ipcMain.handle("provider:test", (_event, params) => harness.request("provider/test", params));
  ipcMain.handle("provider:models", (_event, params) => harness.request("provider/models", params));
  ipcMain.handle("worktree:list", (_event, params: WorktreeListParams) => harness.request("worktree/list", params));
  ipcMain.handle("worktree:create", (_event, params: WorktreeCreateParams) => harness.request("worktree/create", params));
  ipcMain.handle("worktree:remove", (_event, params: WorktreeRemoveParams) => harness.request("worktree/remove", params));
  ipcMain.handle("environment:list", (_event, params: { projectId?: string }) => harness.request("environment/list", params));
  ipcMain.handle("environment:detect", (_event, params: EnvironmentDetectParams) => harness.request("environment/detect", params));
  ipcMain.handle("workflow:list", (_event, params: { projectId?: string }) => harness.request("workflow/list", params));
  ipcMain.handle("workflow:run", (_event, params: WorkflowRunParams) => harness.request("workflow/run", params));
  ipcMain.handle("workflow:runs", (_event, params: { workflowId?: string }) => harness.request("workflow/runs", params));
  ipcMain.handle(
    "workflow:resume",
    (_event, params: { runId: string; approvePausedSteps?: boolean; retryFailedStepIds?: string[] }) =>
      harness.request("workflow/resume", params),
  );
  ipcMain.handle("executionContext:list", (_event, params: { projectId?: string }) => harness.request("executionContext/list", params));
  ipcMain.handle("agent:list", (_event, params: { projectId?: string }) => harness.request("agent/list", params));
  ipcMain.handle("plugin:list", () => harness.request("plugin/list"));
  ipcMain.handle("mcp:list", () => harness.request("mcp/list"));
  ipcMain.handle("mcp:sessions", () => harness.request("mcp/sessions"));
  ipcMain.handle("mcp:refresh", (_event, params: { mountId: string }) => harness.request("mcp:refresh", params));
  ipcMain.handle("window:set-titlebar-theme", (_event, theme: TitleBarTheme) => {
    // 不再动态设置标题栏覆盖层，因为使用 frameless 窗口
  });
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle("window:toggle-fullscreen", () => {
    if (!mainWindow) {
      return;
    }

    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  ipcMain.handle("window:close", () => {
    mainWindow?.close();
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
  ipcMain.handle("files:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Supported files",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf", "txt", "md", "json", "csv", "ts", "tsx", "js", "jsx", "py", "java", "go", "rs", "css", "html"],
        },
        {
          name: "All files",
          extensions: ["*"],
        },
      ],
    });

    const prepared = await Promise.all(result.filePaths.map((filePath) => prepareAttachment(filePath)));
    return prepared.filter((entry): entry is TurnInputAttachment => Boolean(entry));
  });
}

app.whenReady().then(async () => {
  const coreEntry = resolve(app.getAppPath(), "../../packages/core/dist/index.js");
  const appServerEntry = resolve(app.getAppPath(), "../../packages/app-server/dist/index.js");
  harness.start(coreEntry, appServerEntry);
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

process.stdout.on("error", swallowBrokenPipeError);
process.stderr.on("error", swallowBrokenPipeError);

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

function safeConsoleLog(message: string): void {
  safeWrite(process.stdout, `${message}\n`);
}

function safeConsoleError(message: string): void {
  safeWrite(process.stderr, `${message}\n`);
}

function safeWrite(stream: NodeJS.WriteStream, value: string): void {
  try {
    if (stream.destroyed || !stream.writable) {
      return;
    }

    stream.write(value);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  }
}

function swallowBrokenPipeError(error: Error): void {
  if (!isBrokenPipeError(error)) {
    throw error;
  }
}

function isBrokenPipeError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      ((error as { code?: string }).code === "EPIPE" || (error as { code?: string }).code === "ERR_STREAM_DESTROYED"),
  );
}

function wrapPipeError(error: unknown, fallbackMessage: string): Error {
  if (isBrokenPipeError(error)) {
    return new Error(fallbackMessage);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function parseSseEvent(chunk: string): HarnessEvent | null {
  const eventLine = chunk
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));

  if (!eventLine) {
    return null;
  }

  try {
    const payload = JSON.parse(eventLine.slice("data: ".length)) as HarnessEvent | { ok: boolean };
    return "type" in payload ? (payload as HarnessEvent) : null;
  } catch {
    return null;
  }
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

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".jsonl",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".css",
  ".scss",
  ".html",
  ".htm",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".sh",
  ".ps1",
  ".sql",
  ".log",
]);
const MAX_TEXT_ATTACHMENT_BYTES = 160_000;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 40;
const MAX_PDF_TEXT_BYTES = 220_000;

async function prepareAttachment(filePath: string): Promise<TurnInputAttachment | null> {
  const stats = await fs.stat(filePath);
  const extension = extname(filePath).toLowerCase();
  const name = basename(filePath);
  const mediaType = detectMediaType(extension);

  if (IMAGE_EXTENSIONS.has(extension)) {
    if (stats.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      return {
        path: filePath,
        name,
        kind: "binary",
        mediaType,
        sizeBytes: stats.size,
        textContent: `Image "${name}" was selected but exceeds the ${Math.round(MAX_IMAGE_ATTACHMENT_BYTES / (1024 * 1024))} MB inline limit.`,
      };
    }

    const buffer = await fs.readFile(filePath);
    return {
      path: filePath,
      name,
      kind: "image",
      mediaType,
      sizeBytes: stats.size,
      imageDataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
    };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    const buffer = await fs.readFile(filePath);
    const truncated = buffer.byteLength > MAX_TEXT_ATTACHMENT_BYTES;
    const textContent = buffer.subarray(0, MAX_TEXT_ATTACHMENT_BYTES).toString("utf8");

    return {
      path: filePath,
      name,
      kind: "text",
      mediaType,
      sizeBytes: stats.size,
      textContent,
      truncated,
    };
  }

  if (extension === ".pdf") {
    return preparePdfAttachment(filePath, stats.size);
  }

  return {
    path: filePath,
    name,
    kind: "binary",
    mediaType,
    sizeBytes: stats.size,
    textContent: `Binary file "${name}" (${mediaType}, ${formatBytes(stats.size)}) is attached. Inline preview is unavailable.`,
  };
}

function detectMediaType(extension: string): string {
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".md":
      return "text/markdown";
    case ".html":
    case ".htm":
      return "text/html";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".pdf":
      return "application/pdf";
    default:
      return TEXT_EXTENSIONS.has(extension) ? "text/plain" : "application/octet-stream";
  }
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function preparePdfAttachment(filePath: string, sizeBytes: number): Promise<TurnInputAttachment> {
  try {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText({ first: MAX_PDF_PAGES });
      const fullText = result.text.trim();
      const truncatedByBytes = Buffer.byteLength(fullText, "utf8") > MAX_PDF_TEXT_BYTES;
      const textContent = truncatedByBytes
        ? Buffer.from(fullText, "utf8").subarray(0, MAX_PDF_TEXT_BYTES).toString("utf8")
        : fullText;
      const truncatedByPages = result.total > MAX_PDF_PAGES;

      return {
        path: filePath,
        name: basename(filePath),
        kind: "text",
        mediaType: "application/pdf",
        sizeBytes,
        textContent: [
          `[PDF extracted text]`,
          `Pages parsed: ${Math.min(result.total, MAX_PDF_PAGES)}${truncatedByPages ? ` of ${result.total}` : ` of ${result.total}`}`,
          "",
          textContent || "No extractable text was found in this PDF.",
        ].join("\n"),
        truncated: truncatedByPages || truncatedByBytes,
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    return {
      path: filePath,
      name: basename(filePath),
      kind: "binary",
      mediaType: "application/pdf",
      sizeBytes,
      textContent: `PDF "${basename(filePath)}" was attached, but text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
