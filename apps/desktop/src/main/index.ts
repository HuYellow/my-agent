import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import {
  type ApprovalResponseParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type InterruptTurnParams,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type StartThreadParams,
  type StartTurnParams,
  type TurnInputAttachment,
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
  ipcMain.handle("turn:interrupt", (_event, params: InterruptTurnParams) => harness.request("turn/interrupt", params));
  ipcMain.handle("approval:respond", (_event, params: ApprovalResponseParams) => harness.request("approval/respond", params));
  ipcMain.handle("skills:list", () => harness.request("skills/list"));
  ipcMain.handle("skills:config:write", (_event, params: { disabledSkillIds: string[] }) => harness.request("skills/config/write", params));
  ipcMain.handle("config:read", () => harness.request("config/read"));
  ipcMain.handle("config:write", (_event, params: ConfigWriteParams) => harness.request("config/write", params));
  ipcMain.handle("provider:test", () => harness.request("provider/test"));
  ipcMain.handle("provider:models", () => harness.request("provider/models"));
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
