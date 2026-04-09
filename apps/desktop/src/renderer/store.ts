import { create } from "zustand";
import {
  type AgentTaskRecord,
  type AppConfig,
  type CreateProjectParams,
  type CreateRequirementParams,
  type EnvironmentRecord,
  type ExecutionContextRecord,
  type HarnessEvent,
  type InitializeResult,
  type ItemRecord,
  type PendingApproval,
  type ProjectRecord,
  type ProviderProfile,
  type ProviderModelRecord,
  type RequirementMemoryRecord,
  type RequirementRecord,
  type ReviewRecord,
  type SkillDescriptor,
  type TerminalBackendCapability,
  type TerminalOutputArchiveRecord,
  type TerminalSessionRecord,
  type TurnInputAttachment,
  type ThreadRecord,
  type TurnSteerRecord,
  type TurnRecord,
  type UpdateRequirementParams,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorktreeRecord,
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
  requirements: RequirementRecord[];
  requirementMemories: RequirementMemoryRecord[];
  threads: ThreadRecord[];
  threadSessions: Record<string, ThreadSessionState>;
  reviews: ReviewRecord[];
  worktrees: WorktreeRecord[];
  environments: EnvironmentRecord[];
  executionContexts: ExecutionContextRecord[];
  workflows: WorkflowRecord[];
  workflowRuns: WorkflowRunRecord[];
  agentTasks: AgentTaskRecord[];
  terminals: TerminalSessionRecord[];
  terminalOutputs: Record<string, string>;
  terminalOutputArchives: TerminalOutputArchiveRecord[];
  terminalCapabilities: TerminalBackendCapability[];
  skills: SkillDescriptor[];
  activeProjectId?: string;
  activeRequirementId?: string;
  activeThreadId?: string;
  config?: AppConfig;
  providerTestMessage?: string;
  providerModels: ProviderModelRecord[];
  providerModelsLoading: boolean;
  providerModelsError?: string;
  bootstrap: () => Promise<void>;
  createProject: (params: CreateProjectParams) => Promise<void>;
  createRequirement: (params: CreateRequirementParams) => Promise<void>;
  updateRequirement: (requirementId: string, patch: UpdateRequirementParams["patch"]) => Promise<void>;
  updateProject: (projectId: string, patch: Partial<Pick<ProjectRecord, "name" | "rootPath" | "shell" | "sandboxMode" | "approvalPolicy">>) => Promise<void>;
  updateThread: (threadId: string, patch: Partial<Pick<ThreadRecord, "title" | "sandboxMode" | "archivedAt">>) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  selectRequirement: (requirementId?: string) => Promise<void>;
  createThread: (title?: string, projectId?: string, requirementId?: string) => Promise<void>;
  assignThreadToRequirement: (requirementId: string, threadId: string) => Promise<void>;
  unassignThreadFromRequirement: (threadId: string) => Promise<void>;
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
  refreshRuntimeProjectState: (projectId?: string) => Promise<void>;
  handleEvent: (event: HarnessEvent) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  loading: false,
  bootError: undefined,
  projects: [],
  requirements: [],
  requirementMemories: [],
  threads: [],
  threadSessions: {},
  reviews: [],
  worktrees: [],
  environments: [],
  executionContexts: [],
  workflows: [],
  workflowRuns: [],
  agentTasks: [],
  terminals: [],
  terminalOutputs: {},
  terminalOutputArchives: [],
  terminalCapabilities: [],
  skills: [],
  activeRequirementId: undefined,
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
        const activeRequirementId = initial.config.selectedRequirementId ?? initial.requirements?.[0]?.id;
        const activeThreadId = activeRequirementId
          ? undefined
          : initial.threads.find((thread) => thread.projectId === activeProjectId)?.id ?? initial.threads[0]?.id;

        set({
          bootstrapped: true,
          loading: false,
          bootError: undefined,
          projects: initial.projects,
          requirements: initial.requirements ?? [],
          requirementMemories: initial.requirementMemories ?? [],
          threads: initial.threads,
          threadSessions: Object.fromEntries(initial.threads.map((thread) => [thread.id, createEmptyThreadSession()])),
          reviews: initial.reviews ?? [],
          worktrees: initial.worktrees ?? [],
          environments: initial.environments ?? [],
          executionContexts: initial.executionContexts ?? [],
          workflows: initial.workflows ?? [],
          workflowRuns: initial.workflowRuns ?? [],
          agentTasks: initial.agentTasks ?? [],
          terminals: initial.terminals ?? [],
          terminalOutputArchives: initial.terminalOutputArchives ?? [],
          terminalCapabilities: initial.terminalCapabilities ?? [],
          skills: initial.skills,
          config: initial.config,
          activeProjectId,
          activeRequirementId,
          activeThreadId,
        });

        if (activeThreadId) {
          await get().selectThread(activeThreadId);
        }

        await get().refreshProviderModels();
        await get().refreshRuntimeProjectState(activeProjectId);

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
      activeRequirementId: undefined,
      config: state.config ? { ...state.config, selectedProjectId: result.project.id } : state.config,
      activeThreadId: undefined,
    }));
    await get().refreshRuntimeProjectState(result.project.id);
  },
  createRequirement: async (params) => {
    const result = (await window.myAgent.createRequirement(params)) as { requirement: RequirementRecord; memory: RequirementMemoryRecord };
    set((state) => ({
      requirements: upsertRequirement(state.requirements, result.requirement),
      requirementMemories: upsertRequirementMemory(state.requirementMemories, result.memory),
      activeRequirementId: result.requirement.id,
      activeProjectId: result.requirement.primaryProjectId,
      activeThreadId: undefined,
      config: state.config
        ? {
            ...state.config,
            selectedRequirementId: result.requirement.id,
            selectedProjectId: result.requirement.primaryProjectId,
          }
        : state.config,
    }));
    await get().refreshRuntimeProjectState(result.requirement.primaryProjectId);
  },
  updateRequirement: async (requirementId, patch) => {
    const result = (await window.myAgent.updateRequirement({ requirementId, patch })) as {
      requirement: RequirementRecord;
      memory: RequirementMemoryRecord;
    };
    set((state) => ({
      requirements: upsertRequirement(state.requirements, result.requirement),
      requirementMemories: upsertRequirementMemory(state.requirementMemories, result.memory),
      activeProjectId:
        state.activeRequirementId === result.requirement.id ? result.requirement.primaryProjectId : state.activeProjectId,
      config:
        state.config && state.activeRequirementId === result.requirement.id
          ? {
              ...state.config,
              selectedProjectId: result.requirement.primaryProjectId,
            }
          : state.config,
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
      const result = (await window.myAgent.writeConfig({
        config: {
          selectedProjectId: projectId,
          selectedRequirementId: undefined,
        },
      })) as { config: AppConfig };
      set({ config: result.config });
    }

    if (projectThreads[0]) {
      set({ activeProjectId: projectId, activeRequirementId: undefined });
      await get().selectThread(projectThreads[0].id);
      return;
    }

    set({
      activeProjectId: projectId,
      activeRequirementId: undefined,
      activeThreadId: undefined,
    });
    await get().refreshRuntimeProjectState(projectId);
  },
  selectRequirement: async (requirementId) => {
    const requirement = requirementId ? get().requirements.find((entry) => entry.id === requirementId) : undefined;
    const selectedProjectId = requirement?.primaryProjectId;

    const result = (await window.myAgent.writeConfig({
      config: {
        selectedRequirementId: requirementId,
        selectedProjectId,
      },
    })) as { config: AppConfig };

    set({
      config: result.config,
      activeRequirementId: requirementId,
      activeProjectId: selectedProjectId,
      activeThreadId: undefined,
    });

    await get().refreshRuntimeProjectState(selectedProjectId);
  },
  createThread: async (title, projectId, requirementId) => {
    const activeRequirementId = requirementId ?? get().activeRequirementId;
    const activeRequirement = activeRequirementId ? get().requirements.find((entry) => entry.id === activeRequirementId) : undefined;
    const ensuredProjectId = projectId ?? activeRequirement?.primaryProjectId ?? get().activeProjectId ?? get().config?.selectedProjectId;
    const result = (await window.myAgent.startThread({
      title,
      projectId: ensuredProjectId,
      requirementId: activeRequirementId,
    })) as { thread: ThreadRecord };
    const currentConfig = get().config;
    set((state) => ({
      threads: upsertThread(state.threads, result.thread),
      threadSessions: ensureThreadSessionState(state.threadSessions, result.thread.id),
      activeProjectId: result.thread.projectId,
      activeRequirementId: result.thread.requirementId,
      activeThreadId: result.thread.id,
      config: currentConfig
        ? {
            ...currentConfig,
            selectedProjectId: result.thread.projectId,
            selectedRequirementId: result.thread.requirementId,
          }
        : currentConfig,
    }));
  },
  assignThreadToRequirement: async (requirementId, threadId) => {
    const result = (await window.myAgent.assignThreadToRequirement({ requirementId, threadId })) as {
      requirement: RequirementRecord;
      memory: RequirementMemoryRecord;
      thread: ThreadRecord;
    };
    set((state) => ({
      requirements: upsertRequirement(state.requirements, result.requirement),
      requirementMemories: upsertRequirementMemory(state.requirementMemories, result.memory),
      threads: state.threads.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
      activeRequirementId: result.requirement.id,
      activeProjectId: result.requirement.primaryProjectId,
      config: state.config
        ? {
            ...state.config,
            selectedRequirementId: result.requirement.id,
            selectedProjectId: result.requirement.primaryProjectId,
          }
        : state.config,
    }));
  },
  unassignThreadFromRequirement: async (threadId) => {
    const result = (await window.myAgent.unassignThreadFromRequirement({ threadId })) as { thread: ThreadRecord };
    set((state) => ({
      threads: state.threads.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
      activeRequirementId: state.activeThreadId === threadId ? result.thread.requirementId : state.activeRequirementId,
      config:
        state.config && state.activeThreadId === threadId
          ? {
              ...state.config,
              selectedRequirementId: result.thread.requirementId,
            }
          : state.config,
    }));
  },
  selectThread: async (threadId) => {
    const existingThread = get().threads.find((thread) => thread.id === threadId);

    if (existingThread) {
      set((state) => ({
        activeProjectId: existingThread.projectId,
        activeRequirementId: existingThread.requirementId,
        activeThreadId: threadId,
        threadSessions: ensureThreadSessionState(state.threadSessions, threadId),
        config: state.config
          ? {
              ...state.config,
              selectedProjectId: existingThread.projectId,
              selectedRequirementId: existingThread.requirementId,
            }
          : state.config,
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
      activeRequirementId: result.thread.requirementId,
      activeThreadId: threadId,
      threadSessions: updateThreadSession(state.threadSessions, threadId, (session) => ({
        ...session,
        turns: result.turns,
        items: result.items,
        pendingApproval: result.pendingApproval ?? null,
        submitting: false,
      })),
      config: state.config
        ? {
            ...state.config,
            selectedProjectId: result.thread.projectId,
            selectedRequirementId: result.thread.requirementId,
          }
        : state.config,
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
    set({
      config: result.config,
      activeProjectId: result.config.selectedProjectId ?? get().activeProjectId,
      activeRequirementId: result.config.selectedRequirementId,
    });
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
  refreshRuntimeProjectState: async (projectId) => {
    const activeProjectId = projectId ?? get().activeProjectId ?? get().config?.selectedProjectId;

    if (!activeProjectId) {
      set({
        worktrees: [],
        environments: [],
        executionContexts: [],
        workflows: [],
        workflowRuns: [],
        agentTasks: [],
      });
      return;
    }

    const [worktrees, environments, executionContexts, workflows, workflowRuns, agentTasks] = await Promise.all([
      window.myAgent.listWorktrees(activeProjectId).then((result) => result.worktrees),
      window.myAgent.listEnvironments(activeProjectId).then((result) => result.environments),
      window.myAgent.listExecutionContexts(activeProjectId).then((result) => result.executionContexts),
      window.myAgent.listWorkflows(activeProjectId).then((result) => result.workflows),
      window.myAgent.listWorkflowRuns().then((result) => result.runs),
      window.myAgent.listAgentTasks(activeProjectId).then((result) => result.tasks),
    ]);

    set({
      worktrees,
      environments,
      executionContexts,
      workflows,
      workflowRuns,
      agentTasks,
    });
  },
  handleEvent: (event) => {
    switch (event.type) {
      case "thread/started":
        set((state) => ({
          threads: upsertThread(state.threads, event.payload.thread),
          threadSessions: ensureThreadSessionState(state.threadSessions, event.payload.thread.id),
        }));
        break;
      case "requirement/updated":
        set((state) => ({
          requirements: upsertRequirement(state.requirements, event.payload.requirement),
        }));
        break;
      case "requirement/memoryUpdated":
        set((state) => ({
          requirementMemories: upsertRequirementMemory(state.requirementMemories, event.payload.memory),
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
      case "agent/updated":
        set((state) => ({
          agentTasks: upsertAgentTask(state.agentTasks, event.payload.task),
        }));
        break;
      case "worktree/updated":
        set((state) => ({
          worktrees: upsertWorktree(state.worktrees, event.payload.worktree),
        }));
        break;
      case "environment/updated":
        set((state) => ({
          environments: upsertEnvironment(state.environments, event.payload.environment),
        }));
        break;
      case "executionContext/updated":
        set((state) => ({
          executionContexts: upsertExecutionContext(state.executionContexts, event.payload.executionContext),
        }));
        break;
      case "workflow/updated":
        set((state) => ({
          workflows: upsertWorkflow(state.workflows, event.payload.workflow),
        }));
        break;
      case "workflow/run":
        set((state) => ({
          workflowRuns: upsertWorkflowRun(state.workflowRuns, event.payload.run),
        }));
        break;
      case "terminal/updated":
        set((state) => ({
          terminals: upsertTerminal(state.terminals, event.payload.session),
        }));
        break;
      case "terminal/output":
        set((state) => ({
          terminalOutputs: {
            ...state.terminalOutputs,
            [event.payload.sessionId]: `${state.terminalOutputs[event.payload.sessionId] ?? ""}${event.payload.delta}`.slice(-24_000),
          },
        }));
        break;
      case "terminal/outputArchived":
        set((state) => ({
          terminalOutputArchives: upsertTerminalArchive(state.terminalOutputArchives, event.payload.archive),
        }));
        break;
      case "terminal/outputCleared":
        set((state) => ({
          terminalOutputs: {
            ...state.terminalOutputs,
            [event.payload.sessionId]: "",
          },
        }));
        break;
      case "config/changed":
        set((state) => ({
          config: event.payload.config,
          activeProjectId: event.payload.config.selectedProjectId ?? state.activeProjectId,
          activeRequirementId: event.payload.config.selectedRequirementId,
        }));
        void get().refreshProviderModels();
        void get().refreshRuntimeProjectState(event.payload.config.selectedProjectId ?? get().activeProjectId);
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

function upsertRequirement(requirements: RequirementRecord[], requirement: RequirementRecord): RequirementRecord[] {
  return [requirement, ...requirements.filter((entry) => entry.id !== requirement.id)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function upsertRequirementMemory(
  memories: RequirementMemoryRecord[],
  memory: RequirementMemoryRecord,
): RequirementMemoryRecord[] {
  return [...memories.filter((entry) => entry.requirementId !== memory.requirementId), memory].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function upsertTurn(turns: TurnRecord[], turn: TurnRecord): TurnRecord[] {
  return [...turns.filter((entry) => entry.id !== turn.id), turn].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function upsertReview(reviews: ReviewRecord[], review: ReviewRecord): ReviewRecord[] {
  return [...reviews.filter((entry) => entry.id !== review.id), review].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertAgentTask(tasks: AgentTaskRecord[], task: AgentTaskRecord): AgentTaskRecord[] {
  return [...tasks.filter((entry) => entry.id !== task.id), task].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertWorktree(worktrees: WorktreeRecord[], worktree: WorktreeRecord): WorktreeRecord[] {
  return [...worktrees.filter((entry) => entry.id !== worktree.id), worktree].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function upsertEnvironment(environments: EnvironmentRecord[], environment: EnvironmentRecord): EnvironmentRecord[] {
  return [...environments.filter((entry) => entry.id !== environment.id), environment].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function upsertExecutionContext(
  executionContexts: ExecutionContextRecord[],
  executionContext: ExecutionContextRecord,
): ExecutionContextRecord[] {
  return [...executionContexts.filter((entry) => entry.id !== executionContext.id), executionContext].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function upsertWorkflow(workflows: WorkflowRecord[], workflow: WorkflowRecord): WorkflowRecord[] {
  return [...workflows.filter((entry) => entry.id !== workflow.id), workflow].sort((left, right) => left.name.localeCompare(right.name));
}

function upsertWorkflowRun(workflowRuns: WorkflowRunRecord[], run: WorkflowRunRecord): WorkflowRunRecord[] {
  return [...workflowRuns.filter((entry) => entry.id !== run.id), run].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertTerminal(terminals: TerminalSessionRecord[], terminal: TerminalSessionRecord): TerminalSessionRecord[] {
  return [...terminals.filter((entry) => entry.id !== terminal.id), terminal].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function upsertTerminalArchive(
  archives: TerminalOutputArchiveRecord[],
  archive: TerminalOutputArchiveRecord,
): TerminalOutputArchiveRecord[] {
  return [...archives.filter((entry) => entry.id !== archive.id), archive].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
