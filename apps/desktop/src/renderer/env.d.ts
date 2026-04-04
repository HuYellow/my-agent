import {
  type ApprovalResponseParams,
  type AppConfig,
  type ConfigWriteParams,
  type CreateProjectParams,
  type HarnessEvent,
  type InitializeResult,
  type ItemRecord,
  type PendingApproval,
  type ProjectRecord,
  type SkillDescriptor,
  type StartThreadParams,
  type StartTurnParams,
  type ThreadRecord,
  type TurnRecord,
  type UpdateProjectParams,
} from "@my-agent/protocol";

declare global {
  interface Window {
    myAgent: {
      initialize: () => Promise<InitializeResult>;
      createProject: (params: CreateProjectParams) => Promise<{ project: ProjectRecord }>;
      updateProject: (params: UpdateProjectParams) => Promise<{ project: ProjectRecord }>;
      startThread: (params: StartThreadParams) => Promise<{ thread: ThreadRecord }>;
      resumeThread: (threadId: string) => Promise<{ thread: ThreadRecord; turns: TurnRecord[]; items: ItemRecord[]; pendingApproval?: PendingApproval | null }>;
      startTurn: (params: StartTurnParams) => Promise<{ turn: TurnRecord }>;
      respondApproval: (params: ApprovalResponseParams) => Promise<{ turn: TurnRecord }>;
      listSkills: () => Promise<{ skills: SkillDescriptor[] }>;
      writeSkillConfig: (disabledSkillIds: string[]) => Promise<{ skills: SkillDescriptor[] }>;
      readConfig: () => Promise<{ config: AppConfig }>;
      writeConfig: (params: ConfigWriteParams) => Promise<{ config: AppConfig }>;
      testProvider: () => Promise<{ ok: boolean; status: number; message: string }>;
      setTitleBarTheme: (theme: "light" | "dark") => Promise<void>;
      showAppMenu: (params: { menuId: "file" | "edit" | "view" | "window" | "help"; x: number; y: number }) => Promise<void>;
      pickWorkspace: () => Promise<string | null>;
      onEvent: (listener: (event: HarnessEvent) => void) => () => void;
    };
  }
}

export {};
