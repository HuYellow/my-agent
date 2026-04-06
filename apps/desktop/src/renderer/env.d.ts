import {
  type ApprovalResponseParams,
  type AppConfig,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type InitializeResult,
  type InterruptTurnParams,
  type ItemRecord,
  type ProviderModelRecord,
  type PendingApproval,
  type ProjectRecord,
  type SkillDescriptor,
  type StartThreadParams,
  type StartTurnParams,
  type TurnInputAttachment,
  type ThreadRecord,
  type TurnRecord,
  type UpdateThreadParams,
  type UpdateProjectParams,
} from "@my-agent/protocol";

declare global {
  interface Window {
    myAgent: {
      initialize: () => Promise<InitializeResult>;
      createProject: (params: CreateProjectParams) => Promise<{ project: ProjectRecord }>;
      updateProject: (params: UpdateProjectParams) => Promise<{ project: ProjectRecord }>;
      updateThread: (params: UpdateThreadParams) => Promise<{ thread: ThreadRecord }>;
      startThread: (params: StartThreadParams) => Promise<{ thread: ThreadRecord }>;
      resumeThread: (threadId: string) => Promise<{ thread: ThreadRecord; turns: TurnRecord[]; items: ItemRecord[]; pendingApproval?: PendingApproval | null }>;
      startTurn: (params: StartTurnParams) => Promise<{ turn: TurnRecord }>;
      interruptTurn: (params: InterruptTurnParams) => Promise<{ turn: TurnRecord }>;
      respondApproval: (params: ApprovalResponseParams) => Promise<{ turn: TurnRecord }>;
      listSkills: () => Promise<{ skills: SkillDescriptor[] }>;
      writeSkillConfig: (disabledSkillIds: string[]) => Promise<{ skills: SkillDescriptor[] }>;
      readConfig: () => Promise<{ config: AppConfig }>;
      writeConfig: (params: ConfigWriteParams) => Promise<{ config: AppConfig }>;
      testProvider: () => Promise<{ ok: boolean; status: number; message: string }>;
      listProviderModels: () => Promise<{ models: ProviderModelRecord[] }>;
      setTitleBarTheme: (theme: "light" | "dark") => Promise<void>;
      showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) => Promise<void>;
      pickWorkspace: () => Promise<string | null>;
      pickFiles: () => Promise<TurnInputAttachment[]>;
      execCommand: (params: { command: string; cwd?: string; threadId?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
      revealProjectPath: (projectPath: string) => Promise<{ ok: boolean; error?: string }>;
      windowMinimize: () => Promise<void>;
      windowToggleFullscreen: () => Promise<void>;
      windowClose: () => Promise<void>;
      onEvent: (listener: (event: HarnessEvent) => void) => () => void;
    };
  }
}

export {};
