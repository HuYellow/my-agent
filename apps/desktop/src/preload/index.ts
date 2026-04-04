import { contextBridge, ipcRenderer } from "electron";
import {
  type ApprovalResponseParams,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type StartThreadParams,
  type StartTurnParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

const api = {
  initialize: () => ipcRenderer.invoke("harness:initialize"),
  createProject: (params: CreateProjectParams) => ipcRenderer.invoke("project:create", params),
  updateProject: (params: UpdateProjectParams) => ipcRenderer.invoke("project:update", params),
  startThread: (params: StartThreadParams) => ipcRenderer.invoke("thread:start", params),
  resumeThread: (threadId: string) => ipcRenderer.invoke("thread:resume", { threadId }),
  startTurn: (params: StartTurnParams) => ipcRenderer.invoke("turn:start", params),
  respondApproval: (params: ApprovalResponseParams) => ipcRenderer.invoke("approval:respond", params),
  listSkills: () => ipcRenderer.invoke("skills:list"),
  writeSkillConfig: (disabledSkillIds: string[]) => ipcRenderer.invoke("skills:config:write", { disabledSkillIds }),
  readConfig: () => ipcRenderer.invoke("config:read"),
  writeConfig: (params: ConfigWriteParams) => ipcRenderer.invoke("config:write", params),
  testProvider: () => ipcRenderer.invoke("provider:test"),
  setTitleBarTheme: (theme: "light" | "dark") => ipcRenderer.invoke("window:set-titlebar-theme", theme),
  showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) =>
    ipcRenderer.invoke("window:show-app-menu", params),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
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
