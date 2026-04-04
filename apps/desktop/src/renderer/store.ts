import { create } from "zustand";
import {
  type AppConfig,
  type CreateProjectParams,
  type HarnessEvent,
  type InitializeResult,
  type ItemRecord,
  type PendingApproval,
  type ProjectRecord,
  type SkillDescriptor,
  type ThreadRecord,
  type TurnRecord,
} from "@my-agent/protocol";

let bootstrapPromise: Promise<void> | null = null;
let detachEventListener: (() => void) | null = null;

function upsertThread(threads: ThreadRecord[], thread: ThreadRecord): ThreadRecord[] {
  return [thread, ...threads.filter((entry) => entry.id !== thread.id)];
}

interface AppState {
  bootstrapped: boolean;
  loading: boolean;
  projects: ProjectRecord[];
  threads: ThreadRecord[];
  turns: TurnRecord[];
  items: ItemRecord[];
  skills: SkillDescriptor[];
  activeProjectId?: string;
  activeThreadId?: string;
  pendingApproval?: PendingApproval | null;
  config?: AppConfig;
  providerTestMessage?: string;
  bootstrap: () => Promise<void>;
  createProject: (params: CreateProjectParams) => Promise<void>;
  updateProject: (projectId: string, patch: Partial<Pick<ProjectRecord, "name" | "rootPath" | "shell" | "sandboxMode" | "approvalPolicy">>) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  createThread: (title?: string, projectId?: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  sendTurn: (input: string, selectedSkillIds?: string[]) => Promise<void>;
  respondApproval: (approvalId: string, decision: "approve" | "reject", scope?: "once" | "session") => Promise<void>;
  toggleSkill: (skillId: string) => Promise<void>;
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;
  testProvider: () => Promise<void>;
  handleEvent: (event: HarnessEvent) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  loading: false,
  projects: [],
  threads: [],
  turns: [],
  items: [],
  skills: [],
  pendingApproval: null,
  bootstrap: async () => {
    if (get().bootstrapped) {
      return;
    }

    if (bootstrapPromise) {
      await bootstrapPromise;
      return;
    }

    bootstrapPromise = (async () => {
      set({ loading: true });
      const initial = (await window.myAgent.initialize()) as InitializeResult;
      const activeProjectId =
        initial.config.selectedProjectId ??
        initial.projects[0]?.id;
      const activeThreadId =
        initial.threads.find((thread) => thread.projectId === activeProjectId)?.id ??
        initial.threads[0]?.id;
      set({
        bootstrapped: true,
        loading: false,
        projects: initial.projects,
        threads: initial.threads,
        skills: initial.skills,
        config: initial.config,
        activeProjectId,
        activeThreadId,
      });

      if (activeThreadId) {
        await get().selectThread(activeThreadId);
      }

      if (!detachEventListener) {
        detachEventListener = window.myAgent.onEvent((event) => get().handleEvent(event));
      }
    })().finally(() => {
      bootstrapPromise = null;
    });

    await bootstrapPromise;
  },
  createProject: async (params) => {
    const result = (await window.myAgent.createProject(params)) as { project: ProjectRecord };
    set((state) => ({
      projects: [result.project, ...state.projects.filter((project) => project.id !== result.project.id)],
      activeProjectId: result.project.id,
      config: state.config ? { ...state.config, selectedProjectId: result.project.id } : state.config,
      activeThreadId: undefined,
      turns: [],
      items: [],
      pendingApproval: null,
    }));
  },
  updateProject: async (projectId, patch) => {
    const result = (await window.myAgent.updateProject({ projectId, patch })) as { project: ProjectRecord };
    set((state) => ({
      projects: state.projects.map((project) => (project.id === result.project.id ? result.project : project)),
    }));
  },
  selectProject: async (projectId) => {
    const current = get().config;
    const projectThreads = [...get().threads]
      .filter((thread) => thread.projectId === projectId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    if (current) {
      const result = (await window.myAgent.writeConfig({ config: { selectedProjectId: projectId } })) as { config: AppConfig };
      set({ config: result.config });
    }

    if (projectThreads[0]) {
      set({ activeProjectId: projectId });
      await get().selectThread(projectThreads[0].id);
      return;
    }

    set({
      activeProjectId: projectId,
      activeThreadId: undefined,
      turns: [],
      items: [],
      pendingApproval: null,
    });
  },
  createThread: async (title, projectId) => {
    const ensuredProjectId = projectId ?? get().activeProjectId ?? get().config?.selectedProjectId;
    const result = (await window.myAgent.startThread({ title, projectId: ensuredProjectId })) as { thread: ThreadRecord };
    const currentConfig = get().config;
    set((state) => ({
      threads: upsertThread(state.threads, result.thread),
      activeProjectId: result.thread.projectId,
      activeThreadId: result.thread.id,
      config: currentConfig ? { ...currentConfig, selectedProjectId: result.thread.projectId } : currentConfig,
      turns: [],
      items: [],
      pendingApproval: null,
    }));
  },
  selectThread: async (threadId) => {
    const result = (await window.myAgent.resumeThread(threadId)) as {
      thread: ThreadRecord;
      turns: TurnRecord[];
      items: ItemRecord[];
      pendingApproval?: PendingApproval | null;
    };
    set({
      activeProjectId: result.thread.projectId,
      activeThreadId: threadId,
      turns: result.turns,
      items: result.items,
      pendingApproval: result.pendingApproval ?? null,
      config: get().config ? { ...get().config!, selectedProjectId: result.thread.projectId } : get().config,
    });
  },
  sendTurn: async (input, selectedSkillIds) => {
    const threadId = get().activeThreadId;

    if (!threadId) {
      await get().createThread();
    }

    const ensuredThreadId = get().activeThreadId!;
    set({ loading: true });
    const result = (await window.myAgent.startTurn({
      threadId: ensuredThreadId,
      input,
      selectedSkillIds,
    })) as { turn: TurnRecord };

    set((state) => ({
      loading: false,
      turns: [...state.turns.filter((turn) => turn.id !== result.turn.id), result.turn],
    }));
  },
  respondApproval: async (approvalId, decision, scope) => {
    const result = (await window.myAgent.respondApproval({
      approvalId,
      decision,
      scope,
    })) as { turn: TurnRecord };

    set((state) => ({
      turns: state.turns.map((turn) => (turn.id === result.turn.id ? result.turn : turn)),
      pendingApproval: decision === "approve" || decision === "reject" ? null : state.pendingApproval,
    }));
  },
  toggleSkill: async (skillId) => {
    const current = get().config;

    if (!current) {
      return;
    }

    const disabled = new Set<string>(current.disabledSkillIds);

    if (disabled.has(skillId)) {
      disabled.delete(skillId);
    } else {
      disabled.add(skillId);
    }

    const result = (await window.myAgent.writeSkillConfig([...disabled])) as { skills: SkillDescriptor[] };

    set({
      skills: result.skills,
      config: {
        ...current,
        disabledSkillIds: [...disabled],
      },
    });
  },
  updateConfig: async (config) => {
    const result = (await window.myAgent.writeConfig({ config })) as { config: AppConfig };
    set({ config: result.config, activeProjectId: result.config.selectedProjectId ?? get().activeProjectId });
  },
  testProvider: async () => {
    const result = (await window.myAgent.testProvider()) as { ok: boolean; status: number; message: string };
    set({
      providerTestMessage: result.ok ? `Provider OK (${result.status})` : `Provider failed (${result.status}): ${result.message}`,
    });
  },
  handleEvent: (event) => {
    switch (event.type) {
      case "thread/started":
        set((state) => ({ threads: upsertThread(state.threads, event.payload.thread) }));
        break;
      case "turn/started":
        set((state) => ({ turns: [...state.turns.filter((turn) => turn.id !== event.payload.turn.id), event.payload.turn] }));
        break;
      case "item/started":
      case "item/completed":
        set((state) => ({
          items: [...state.items.filter((item) => item.id !== event.payload.item.id), event.payload.item].sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt),
          ),
        }));
        break;
      case "item/delta":
        set((state) => ({
          items: state.items.map((item) => (item.id === event.payload.itemId ? { ...item, body: `${item.body}${event.payload.delta}` } : item)),
        }));
        break;
      case "approval/requested":
        set((state) => ({
          pendingApproval: event.payload.approval,
          items: [...state.items.filter((item) => item.id !== event.payload.item.id), event.payload.item],
        }));
        break;
      case "serverRequest/resolved":
        set((state) => ({
          pendingApproval: state.pendingApproval?.id === event.payload.approvalId ? null : state.pendingApproval,
        }));
        break;
      case "turn/completed":
        set((state) => ({
          loading: false,
          turns: state.turns.map((turn) => (turn.id === event.payload.turn.id ? event.payload.turn : turn)),
        }));
        break;
      case "turn/cancelled":
        set((state) => ({
          loading: false,
          turns: state.turns.map((turn) => (turn.id === event.payload.turn.id ? event.payload.turn : turn)),
        }));
        break;
      case "turn/failed":
        set((state) => ({
          loading: false,
          turns: state.turns.map((turn) => (turn.id === event.payload.turn.id ? event.payload.turn : turn)),
        }));
        break;
      case "skills/changed":
        set({ skills: event.payload.skills });
        break;
      default:
        break;
    }
  },
}));
