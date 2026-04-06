import { contextBridge, ipcRenderer } from "electron";
import {
  type ApprovalResponseParams,
  type CommandExecParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type InterruptTurnParams,
  type ProviderModelRecord,
  type StartThreadParams,
  type StartTurnParams,
  type TurnInputAttachment,
  type UpdateThreadParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

const api = {
  initialize: () => ipcRenderer.invoke("harness:initialize"),
  createProject: (params: CreateProjectParams) => ipcRenderer.invoke("project:create", params),
  updateProject: (params: UpdateProjectParams) => ipcRenderer.invoke("project:update", params),
  updateThread: (params: UpdateThreadParams) => ipcRenderer.invoke("thread:update", params),
  startThread: (params: StartThreadParams) => ipcRenderer.invoke("thread:start", params),
  resumeThread: (threadId: string) => ipcRenderer.invoke("thread:resume", { threadId }),
  startTurn: (params: StartTurnParams) => ipcRenderer.invoke("turn:start", params),
  interruptTurn: (params: InterruptTurnParams) => ipcRenderer.invoke("turn:interrupt", params),
  respondApproval: (params: ApprovalResponseParams) => ipcRenderer.invoke("approval:respond", params),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  writeSkillConfig: (disabledSkillIds: string[]) => ipcRenderer.invoke("skills:config:write", { disabledSkillIds }),
  readSkillDocument: (skillPath: string) => ipcRenderer.invoke("skills:document:read", { skillPath }) as Promise<{ content: string }>,
  revealSkillPath: (skillPath: string) => ipcRenderer.invoke("skills:path:reveal", { skillPath }) as Promise<{ ok: boolean; error?: string }>,
  readConfig: () => ipcRenderer.invoke("config:read"),
  writeConfig: (params: ConfigWriteParams) => ipcRenderer.invoke("config:write", params),
  testProvider: () => ipcRenderer.invoke("provider:test"),
  listProviderModels: () => ipcRenderer.invoke("provider:models") as Promise<{ models: ProviderModelRecord[] }>,
  setTitleBarTheme: (theme: "light" | "dark") => ipcRenderer.invoke("window:set-titlebar-theme", theme),
  showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) =>
    ipcRenderer.invoke("window:show-app-menu", params),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  pickFiles: () => ipcRenderer.invoke("files:pick") as Promise<TurnInputAttachment[]>,
  revealProjectPath: (projectPath: string) =>
    ipcRenderer.invoke("project:path:reveal", { projectPath }) as Promise<{ ok: boolean; error?: string }>,
  execCommand: (params: CommandExecParams) =>
    ipcRenderer.invoke("command:exec", params) as Promise<{ code: number; stdout: string; stderr: string }>,
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowToggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  onEvent: (listener: (event: HarnessEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: HarnessEvent) => listener(payload);
    ipcRenderer.on("harness:event", wrapped);
    return () => ipcRenderer.off("harness:event", wrapped);
  },
};

contextBridge.exposeInMainWorld("myAgent", api);

declare global {
  interface Window {
    myAgent: typeof api;
  }
}
