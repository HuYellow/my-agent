import { create } from "zustand";
import {
  type AppConfig,
  type CreateProjectParams,
  type HarnessEvent,
  type InitializeResult,
  type ItemRecord,
  type PendingApproval,
  type ProjectRecord,
  type ProviderProfile,
  type ProviderModelRecord,
  type ReviewRecord,
  type SkillDescriptor,
  type TerminalBackendCapability,
  type TerminalSessionRecord,
  type TurnInputAttachment,
  type ThreadRecord,
  type TurnSteerRecord,
  type TurnRecord,
} from "@my-agent/protocol";

let bootstrapPromise: Promise<void> | null = null;
let detachEventListener: (() => void) | null = null;

export interface ThreadSessionState {
  turns: TurnRecord[];
  items: ItemRecord[];
  pendingApproval?: PendingApproval | null;
  submitting: boolean;
}

interface AppState {
  bootstrapped: boolean;
  loading: boolean;
  bootError?: string;
  projects: ProjectRecord[];
  threads: ThreadRecord[];
  threadSessions: Record<string, ThreadSessionState>;
  reviews: ReviewRecord[];
  terminals: TerminalSessionRecord[];
  terminalCapabilities: TerminalBackendCapability[];
  skills: SkillDescriptor[];
  activeProjectId?: string;
  activeThreadId?: string;
  config?: AppConfig;
  providerTestMessage?: string;
  providerModels: ProviderModelRecord[];
  providerModelsLoading: boolean;
  providerModelsError?: string;
  bootstrap: () => Promise<void>;
  createProject: (params: CreateProjectParams) => Promise<void>;
  updateProject: (projectId: string, patch: Partial<Pick<ProjectRecord, "name" | "rootPath" | "shell" | "sandboxMode" | "approvalPolicy">>) => Promise<void>;
  updateThread: (threadId: string, patch: Partial<Pick<ThreadRecord, "title" | "sandboxMode" | "archivedAt">>) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  createThread: (title?: string, projectId?: string) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  sendTurn: (input: string, selectedSkillIds?: string[], attachments?: TurnInputAttachment[], includeIdeContext?: boolean) => Promise<void>;
  steerTurn: (turnId: string, input: string, priority?: TurnSteerRecord["priority"]) => Promise<TurnSteerRecord>;
  interruptTurn: (turnId: string) => Promise<void>;
  startReview: (params: { projectId?: string; threadId?: string; source?: ReviewRecord["source"]; instructions?: string }) => Promise<ReviewRecord>;
  respondApproval: (approvalId: string, decision: "approve" | "reject", scope?: "once" | "session") => Promise<void>;
  toggleSkill: (skillId: string) => Promise<void>;
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;
  testProvider: (provider?: Partial<ProviderProfile>) => Promise<void>;
  refreshProviderModels: (provider?: Partial<ProviderProfile>) => Promise<void>;
  handleEvent: (event: HarnessEvent) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  loading: false,
  bootError: undefined,
  projects: [],
  threads: [],
  threadSessions: {},
  reviews: [],
  terminals: [],
  terminalCapabilities: [],
  skills: [],
  providerModels: [],
  providerModelsLoading: false,
  bootstrap: async () => {
    if (get().bootstrapped) {
      return;
    }

    if (bootstrapPromise) {
      await bootstrapPromise;
      return;
    }

    bootstrapPromise = (async () => {
      set({ loading: true, bootError: undefined });

      try {
        const initial = (await withTimeout(window.myAgent.initialize(), 10_000, "Harness initialization timed out.")) as InitializeResult;
        const activeProjectId = initial.config.selectedProjectId ?? initial.projects[0]?.id;
        const activeThreadId = initial.threads.find((thread) => thread.projectId === activeProjectId)?.id ?? initial.threads[0]?.id;

        set({
          bootstrapped: true,
          loading: false,
          bootError: undefined,
          projects: initial.projects,
          threads: initial.threads,
          threadSessions: Object.fromEntries(initial.threads.map((thread) => [thread.id, createEmptyThreadSession()])),
          reviews: initial.reviews ?? [],
          terminals: initial.terminals ?? [],
          terminalCapabilities: initial.terminalCapabilities ?? [],
          skills: initial.skills,
          config: initial.config,
          activeProjectId,
          activeThreadId,
        });

        if (activeThreadId) {
          await get().selectThread(activeThreadId);
        }

        await get().refreshProviderModels();

        if (!detachEventListener) {
          detachEventListener = window.myAgent.onEvent((event) => get().handleEvent(event));
        }
      } catch (error) {
        set({
          loading: false,
          bootError: error instanceof Error ? error.message : String(error),
        });
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
    }));
  },
  updateProject: async (projectId, patch) => {
    const result = (await window.myAgent.updateProject({ projectId, patch })) as { project: ProjectRecord };
    set((state) => ({
      projects: state.projects.map((project) => (project.id === result.project.id ? result.project : project)),
    }));
  },
  updateThread: async (threadId, patch) => {
    const result = (await window.myAgent.updateThread({ threadId, patch })) as { thread: ThreadRecord };
    set((state) => ({
      threads: state.threads.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
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
    });
  },
  createThread: async (title, projectId) => {
    const ensuredProjectId = projectId ?? get().activeProjectId ?? get().config?.selectedProjectId;
    const result = (await window.myAgent.startThread({ title, projectId: ensuredProjectId })) as { thread: ThreadRecord };
    const currentConfig = get().config;
    set((state) => ({
      threads: upsertThread(state.threads, result.thread),
      threadSessions: ensureThreadSessionState(state.threadSessions, result.thread.id),
      activeProjectId: result.thread.projectId,
      activeThreadId: result.thread.id,
      config: currentConfig ? { ...currentConfig, selectedProjectId: result.thread.projectId } : currentConfig,
    }));
  },
  selectThread: async (threadId) => {
    const existingThread = get().threads.find((thread) => thread.id === threadId);

    if (existingThread) {
      set((state) => ({
        activeProjectId: existingThread.projectId,
        activeThreadId: threadId,
        threadSessions: ensureThreadSessionState(state.threadSessions, threadId),
        config: state.config ? { ...state.config, selectedProjectId: existingThread.projectId } : state.config,
      }));
    }

    const result = (await window.myAgent.resumeThread(threadId)) as {
      thread: ThreadRecord;
      turns: TurnRecord[];
      items: ItemRecord[];
      pendingApproval?: PendingApproval | null;
    };
    set((state) => ({
      activeProjectId: result.thread.projectId,
      activeThreadId: threadId,
      threadSessions: updateThreadSession(state.threadSessions, threadId, (session) => ({
        ...session,
        turns: result.turns,
        items: result.items,
        pendingApproval: result.pendingApproval ?? null,
        submitting: false,
      })),
      config: state.config ? { ...state.config, selectedProjectId: result.thread.projectId } : state.config,
    }));
  },
  sendTurn: async (input, selectedSkillIds, attachments, includeIdeContext) => {
    let threadId = get().activeThreadId;

    if (!threadId) {
      await get().createThread();
      threadId = get().activeThreadId;
    }

    if (!threadId) {
      throw new Error("Unable to create or resolve an active thread.");
    }

    set((state) => ({
      threadSessions: updateThreadSession(state.threadSessions, threadId!, (session) => ({
        ...session,
        submitting: true,
      })),
    }));

    try {
      const result = (await window.myAgent.startTurn({
        threadId,
        input,
        attachments,
        selectedSkillIds,
        includeIdeContext,
      })) as { turn: TurnRecord };

      set((state) => ({
        threadSessions: updateThreadSession(state.threadSessions, threadId!, (session) => ({
          ...session,
          submitting: false,
          turns: upsertTurn(session.turns, result.turn),
        })),
      }));
    } catch (error) {
      set((state) => ({
        threadSessions: updateThreadSession(state.threadSessions, threadId!, (session) => ({
          ...session,
          submitting: false,
        })),
      }));
      throw error;
    }
  },
  steerTurn: async (turnId, input, priority) => {
    const result = (await window.myAgent.steerTurn({
      turnId,
      input,
      priority,
    })) as { steer: TurnSteerRecord };
    return result.steer;
  },
  interruptTurn: async (turnId) => {
    const result = (await window.myAgent.interruptTurn({ turnId })) as { turn: TurnRecord };

    set((state) => ({
      threadSessions: updateThreadSession(state.threadSessions, result.turn.threadId, (session) => ({
        ...session,
        submitting: false,
        turns: session.turns.map((turn) => (turn.id === result.turn.id ? result.turn : turn)),
        pendingApproval: session.pendingApproval?.turnId === result.turn.id ? null : session.pendingApproval,
      })),
    }));
  },
  startReview: async (params) => {
    const result = (await window.myAgent.startReview(params)) as { review: ReviewRecord };
    set((state) => ({
      reviews: upsertReview(state.reviews, result.review),
    }));
    return result.review;
  },
  respondApproval: async (approvalId, decision, scope) => {
    const result = (await window.myAgent.respondApproval({
      approvalId,
      decision,
      scope,
    })) as { turn: TurnRecord };

    set((state) => ({
      threadSessions: updateThreadSession(state.threadSessions, result.turn.threadId, (session) => ({
        ...session,
        turns: session.turns.map((turn) => (turn.id === result.turn.id ? result.turn : turn)),
        pendingApproval: session.pendingApproval?.id === approvalId ? null : session.pendingApproval,
      })),
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
  testProvider: async (provider) => {
    const currentProvider = get().config?.provider;
    const effectiveProvider = currentProvider ? { ...currentProvider, ...(provider ?? {}) } : undefined;
    const result = (await window.myAgent.testProvider(effectiveProvider ? { provider: effectiveProvider } : undefined)) as {
      ok: boolean;
      status: number;
      message: string;
    };
    set({
      providerTestMessage: result.ok ? `Provider OK (${result.status})` : `Provider failed (${result.status}): ${result.message}`,
    });
  },
  refreshProviderModels: async (provider) => {
    const currentProvider = get().config?.provider;
    const effectiveProvider = currentProvider ? { ...currentProvider, ...(provider ?? {}) } : undefined;

    if (!effectiveProvider?.baseUrl) {
      set({
        providerModels: [],
        providerModelsLoading: false,
        providerModelsError: "Provider baseUrl is empty.",
      });
      return;
    }

    set({
      providerModelsLoading: true,
      providerModelsError: undefined,
    });

    try {
      const result = (await window.myAgent.listProviderModels({ provider: effectiveProvider })) as {
        models: ProviderModelRecord[];
      };
      set({
        providerModels: result.models,
        providerModelsLoading: false,
        providerModelsError: undefined,
      });
    } catch (error) {
      set({
        providerModels: [],
        providerModelsLoading: false,
        providerModelsError: error instanceof Error ? error.message : String(error),
      });
    }
  },
  handleEvent: (event) => {
    switch (event.type) {
      case "thread/started":
        set((state) => ({
          threads: upsertThread(state.threads, event.payload.thread),
          threadSessions: ensureThreadSessionState(state.threadSessions, event.payload.thread.id),
        }));
        break;
      case "turn/started":
        set((state) => ({
          threadSessions: updateThreadSession(state.threadSessions, event.payload.turn.threadId, (session) => ({
            ...session,
            submitting: false,
            turns: upsertTurn(session.turns, event.payload.turn),
          })),
        }));
        break;
      case "turn/steered":
        set((state) => ({
          threadSessions: updateThreadSession(state.threadSessions, event.payload.steer.threadId, (session) => ({
            ...session,
            items: upsertItem(session.items, {
              id: event.payload.steer.id,
              threadId: event.payload.steer.threadId,
              turnId: event.payload.steer.turnId,
              kind: "userMessage",
              status: "completed",
              title: "Steer input",
              body: event.payload.steer.input,
              metadata: {
                steerId: event.payload.steer.id,
                priority: event.payload.steer.priority,
              },
              createdAt: event.payload.steer.createdAt,
              updatedAt: event.payload.steer.createdAt,
            }),
          })),
        }));
        break;
      case "item/started":
      case "item/completed":
        set((state) => ({
          threadSessions: updateThreadSession(state.threadSessions, event.payload.item.threadId, (session) => ({
            ...session,
            items: upsertItem(session.items, event.payload.item),
          })),
        }));
        break;
      case "item/delta":
        set((state) => ({
          threadSessions: Object.fromEntries(
            Object.entries(state.threadSessions).map(([threadId, session]) => [
              threadId,
              {
                ...session,
                items: session.items.map((item) => (item.id === event.payload.itemId ? { ...item, body: `${item.body}${event.payload.delta}` } : item)),
              },
            ]),
          ),
        }));
        break;
      case "approval/requested":
        set((state) => ({
          threadSessions: updateThreadSession(state.threadSessions, event.payload.approval.threadId, (session) => ({
            ...session,
            pendingApproval: event.payload.approval,
            items: upsertItem(session.items, event.payload.item),
          })),
        }));
        break;
      case "serverRequest/resolved":
        set((state) => ({
          threadSessions: Object.fromEntries(
            Object.entries(state.threadSessions).map(([threadId, session]) => [
              threadId,
              {
                ...session,
                pendingApproval: session.pendingApproval?.id === event.payload.approvalId ? null : session.pendingApproval,
              },
            ]),
          ),
        }));
        break;
      case "turn/completed":
      case "turn/cancelled":
      case "turn/failed":
        set((state) => ({
          threadSessions: updateThreadSession(state.threadSessions, event.payload.turn.threadId, (session) => ({
            ...session,
            submitting: false,
            turns: session.turns.map((turn) => (turn.id === event.payload.turn.id ? event.payload.turn : turn)),
          })),
        }));
        break;
      case "review/started":
      case "review/status":
      case "review/result":
        set((state) => ({
          reviews: upsertReview(state.reviews, event.payload.review),
        }));
        break;
      case "terminal/updated":
        set((state) => ({
          terminals: upsertTerminal(state.terminals, event.payload.session),
        }));
        break;
      case "config/changed":
        set((state) => ({
          config: event.payload.config,
          activeProjectId: event.payload.config.selectedProjectId ?? state.activeProjectId,
        }));
        void get().refreshProviderModels();
        break;
      case "skills/changed":
        set({ skills: event.payload.skills });
        break;
      default:
        break;
    }
  },
}));

function upsertThread(threads: ThreadRecord[], thread: ThreadRecord): ThreadRecord[] {
  return [thread, ...threads.filter((entry) => entry.id !== thread.id)];
}

function upsertTurn(turns: TurnRecord[], turn: TurnRecord): TurnRecord[] {
  return [...turns.filter((entry) => entry.id !== turn.id), turn].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function upsertReview(reviews: ReviewRecord[], review: ReviewRecord): ReviewRecord[] {
  return [...reviews.filter((entry) => entry.id !== review.id), review].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertTerminal(terminals: TerminalSessionRecord[], terminal: TerminalSessionRecord): TerminalSessionRecord[] {
  return [...terminals.filter((entry) => entry.id !== terminal.id), terminal].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertItem(items: ItemRecord[], item: ItemRecord): ItemRecord[] {
  return [...items.filter((entry) => entry.id !== item.id), item].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function createEmptyThreadSession(): ThreadSessionState {
  return {
    turns: [],
    items: [],
    pendingApproval: null,
    submitting: false,
  };
}

function ensureThreadSessionState(sessions: Record<string, ThreadSessionState>, threadId: string) {
  if (sessions[threadId]) {
    return sessions;
  }

  return {
    ...sessions,
    [threadId]: createEmptyThreadSession(),
  };
}

function updateThreadSession(
  sessions: Record<string, ThreadSessionState>,
  threadId: string,
  updater: (session: ThreadSessionState) => ThreadSessionState,
): Record<string, ThreadSessionState> {
  const current = sessions[threadId] ?? createEmptyThreadSession();

  return {
    ...sessions,
    [threadId]: updater(current),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
