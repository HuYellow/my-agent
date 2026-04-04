import { create } from "zustand";
import {
  type AppConfig,
  type HarnessEvent,
  type InitializeResult,
  type ItemRecord,
  type PendingApproval,
  type SkillDescriptor,
  type ThreadRecord,
  type TurnRecord,
} from "@my-agent/protocol";

interface AppState {
  bootstrapped: boolean;
  loading: boolean;
  threads: ThreadRecord[];
  turns: TurnRecord[];
  items: ItemRecord[];
  skills: SkillDescriptor[];
  activeThreadId?: string;
  pendingApproval?: PendingApproval | null;
  config?: AppConfig;
  providerTestMessage?: string;
  bootstrap: () => Promise<void>;
  createThread: (title?: string) => Promise<void>;
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
  threads: [],
  turns: [],
  items: [],
  skills: [],
  pendingApproval: null,
  bootstrap: async () => {
    set({ loading: true });
    const initial = (await window.myAgent.initialize()) as InitializeResult;
    const activeThreadId = initial.threads[0]?.id;
    set({
      bootstrapped: true,
      loading: false,
      threads: initial.threads,
      skills: initial.skills,
      config: initial.config,
      activeThreadId,
    });

    if (activeThreadId) {
      await get().selectThread(activeThreadId);
    }

    window.myAgent.onEvent((event) => get().handleEvent(event));
  },
  createThread: async (title) => {
    const result = (await window.myAgent.startThread({ title })) as { thread: ThreadRecord };
    set((state) => ({
      threads: [result.thread, ...state.threads],
      activeThreadId: result.thread.id,
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
      activeThreadId: threadId,
      turns: result.turns,
      items: result.items,
      pendingApproval: result.pendingApproval ?? null,
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
    set({ config: result.config });
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
        set((state) => ({ threads: [event.payload.thread, ...state.threads] }));
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
