import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MessageSquarePlus,
  Zap,
  Grid3X3,
  GitBranch,
  Settings,
  ArrowUp,
  Plus,
  Search,
  FolderOpen,
  AlertTriangle,
  CheckCircle,
  Check,
  XCircle,
  ChevronDown,
  ChevronRight,
  Minus,
  Square,
  X,
  ImagePlus,
  Cpu,
  FileText,
  Box,
  Sun,
  Moon,
  Rabbit,
  MoreHorizontal,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  type ApprovalPolicy,
  type ItemKind,
  type ItemRecord,
  type ModelReasoningEffort,
  type McpMountRecord,
  type McpSessionRecord,
  type PendingApproval,
  type PluginRecord,
  type ProjectRecord,
  type ProviderModelRecord,
  type SandboxMode,
  type SkillDescriptor,
  type TurnInputAttachment,
  type TurnRecord,
  type WorktreeRecord,
  type EnvironmentRecord,
  type WorkflowRecord,
  type WorkflowRunRecord,
} from "@my-agent/protocol";
import { useAppStore } from "./store";

interface ProviderFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: ModelReasoningEffort;
  rootPath: string;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
}

type NavView = "threads" | "skills" | "plugins" | "automation" | "settings";
type ComposerAttachment = TurnInputAttachment;
type ThemeMode = "light" | "dark";

const SIDEBAR_WIDTH_STORAGE_KEY = "my-agent-sidebar-width-ratio";
const SIDEBAR_MIN_RATIO = 0.18;
const SIDEBAR_MAX_RATIO = 0.34;
const SIDEBAR_DEFAULT_RATIO = 0.22;

const REASONING_OPTIONS: Array<{ value: ModelReasoningEffort; label: string; hint: string }> = [
  { value: "minimal", label: "Minimal", hint: "Fastest, uses fewer tokens" },
  { value: "low", label: "Low", hint: "Lightweight analysis" },
  { value: "medium", label: "Medium", hint: "Balanced speed and depth" },
  { value: "high", label: "High", hint: "Best for complex tasks" },
  { value: "xhigh", label: "Max", hint: "Strongest reasoning, slowest" },
];

const SANDBOX_MODE_OPTIONS: Array<{ value: SandboxMode; label: string; hint: string }> = [
  { value: "read-only", label: "Read only", hint: "Only allow reading files inside the workspace." },
  { value: "workspace-write", label: "Workspace write", hint: "Allow editing files inside the workspace." },
  { value: "danger-full-access", label: "Full access", hint: "Allow unrestricted filesystem and network access." },
];

interface BranchSummary {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  loading: boolean;
  error?: string;
}

interface ContextSummary {
  usedTokens: number;
  totalTokens: number;
  remainingTokens: number;
  usedRatio: number;
}

const ITEM_LABELS: Record<ItemKind, string> = {
  userMessage: "Question",
  agentMessage: "Response",
  reasoning: "Reasoning",
  toolCall: "Tool call",
  toolResult: "Tool result",
  commandExecution: "Command",
  fileChange: "File change",
  approvalRequest: "Approval",
  approvalResult: "Approval result",
  terminalSession: "Terminal",
  agentTask: "Agent task",
  error: "Error",
};

const APP_MENU_ITEMS = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
] as const;

type ConversationEntry =
  | { id: string; kind: "user"; item: ItemRecord }
  | { id: string; kind: "thought"; items: ItemRecord[]; completed: boolean; durationMs: number; startedAtMs: number }
  | { id: string; kind: "answer"; item: ItemRecord }
  | { id: string; kind: "changes"; items: ItemRecord[] }
  | { id: string; kind: "system"; item: ItemRecord };

const THOUGHT_ITEM_KINDS: ItemKind[] = [
  "reasoning",
  "toolCall",
  "toolResult",
  "commandExecution",
];

interface ChangedFileReview {
  path: string;
  additions?: number;
  deletions?: number;
  diff?: string;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

interface ComposerDraftState {
  input: string;
  attachments: ComposerAttachment[];
  includeIdeContext: boolean;
  planMode: boolean;
}

interface UserAttachmentSummary {
  name: string;
  path?: string;
  kind: "image" | "text" | "binary";
  mediaType?: string;
  truncated?: boolean;
  previewSrc?: string;
}

export function App() {
  const {
    bootstrapped,
    bootError,
    loading,
    projects,
    threads,
    threadSessions,
    skills,
    activeProjectId,
    activeThreadId,
    config,
    providerTestMessage,
    providerModels,
    providerModelsLoading,
    providerModelsError,
    bootstrap,
    createProject,
    createThread,
    updateProject,
    updateThread,
    selectThread,
    sendTurn,
    interruptTurn,
    respondApproval,
    toggleSkill,
    updateConfig,
    testProvider,
    refreshProviderModels,
  } = useAppStore();

  const [activeView, setActiveView] = useState<NavView>("threads");
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraftState>>({});
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [skillDetailId, setSkillDetailId] = useState<string | null>(null);
  const [skillDocument, setSkillDocument] = useState("");
  const [skillDocumentLoading, setSkillDocumentLoading] = useState(false);
  const [skillDocumentError, setSkillDocumentError] = useState<string | null>(null);
  const [runtimeWorktrees, setRuntimeWorktrees] = useState<WorktreeRecord[]>([]);
  const [runtimeEnvironments, setRuntimeEnvironments] = useState<EnvironmentRecord[]>([]);
  const [runtimeWorkflows, setRuntimeWorkflows] = useState<WorkflowRecord[]>([]);
  const [runtimeWorkflowRuns, setRuntimeWorkflowRuns] = useState<WorkflowRunRecord[]>([]);
  const [runtimePlugins, setRuntimePlugins] = useState<PluginRecord[]>([]);
  const [runtimeMcpMounts, setRuntimeMcpMounts] = useState<McpMountRecord[]>([]);
  const [runtimeMcpSessions, setRuntimeMcpSessions] = useState<McpSessionRecord[]>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidthRatio, setSidebarWidthRatio] = useState(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
    return Number.isFinite(parsed) ? clamp(parsed, SIDEBAR_MIN_RATIO, SIDEBAR_MAX_RATIO) : SIDEBAR_DEFAULT_RATIO;
  });
  const [sandboxMenuOpen, setSandboxMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchSummary, setBranchSummary] = useState<BranchSummary>({
    isGitRepo: false,
    currentBranch: null,
    branches: [],
    loading: false,
  });
  const [providerForm, setProviderForm] = useState<ProviderFormState>({
    baseUrl: "",
    apiKey: "",
    model: "",
    reasoningEffort: "high",
    rootPath: "",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  });
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const reasoningMenuRef = useRef<HTMLDivElement | null>(null);
  const sandboxMenuRef = useRef<HTMLDivElement | null>(null);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);
  const appContainerRef = useRef<HTMLDivElement | null>(null);
  const messageAreaRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStateRef = useRef<{ pointerId: number; startX: number; startRatio: number } | null>(null);
  const pendingThreadScrollRef = useRef<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("my-agent-theme");

    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeMode(storedTheme);
      return;
    }

    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    setThemeMode(prefersDark ? "dark" : "light");
    // hiddenInset 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸湱铏庨崰鏍ㄦ償婵犲洦鐓犵痪鏉垮船婢ь垱銇勯锝嗙闁哄苯绉归崺鈩冩媴閸涘﹥顔勬俊鐐€栧ú婵囥仈閹间礁绠為柕濞垮剻閻旂厧浼犻柛鏇ㄥ墯閻︼絾绻濋悽闈涗粶闁绘鎳樺畷锟犲箮閽樺鎽曞┑鐐村灟閸ㄧ懓螞濮椻偓閹綊宕堕妸銉хシ濡炪値鍋勫ú顓烆潖濞差亝鐒婚柣鎰蔼鐎氭澘顭胯閸ｏ綁寮诲☉娆戠瘈闁稿本绋戞禒鎾倵鐟欏嫭纾搁柛銊ㄥГ娣囧﹪鎳滈棃娑氱獮闁诲函缍嗛崑鍛存偟椤愶附鈷戦悹鍥皺缁犳娊鏌涚€ｎ剙鏋涚€规洘鍨块獮妯肩磼濡粯顏熼梻渚€娼чˇ顐﹀疾濠婂牆鐓曢柟鐑橆殕閻撴洟鏌曟径妯虹仯闁告帗婢橀湁婵犲﹤鐗忛悾鐑樻叏婵犲洨绱伴柕鍥ㄥ姍楠炴帡骞橀幘顔芥殬濠碉紕鍋戦崐鏍垂閻㈢绠犻煫鍥ㄧ☉缁犵偤鏌曟繛鐐珔闁绘挻鐩弻娑㈠箛閵婏附鐝斿銈呭閻╊垰顫忓ú顏勫窛濠电姴鍟惁鐑芥⒑閸涘﹣绶遍柛鐘冲哺閸┾偓妞ゆ帒顦顔芥叏婵犲啯銇濈€规洦鍋婂畷鐔碱敇婢跺牆鐏紒缁樼☉椤斿繘顢欓悡搴ｇ潉闂備線娼уΛ妤呭磹閸︻厾鐭夐柟鐑樻煛閸嬫捇鏁愭惔婵堢泿闂佸摜鍋戦崝鎴澪涢崨鎼晝闁靛繆鍓濋幃娆愪繆閵堝洤校闁诡喖鍊块獮鍡樻媴閸撹尙鍙嗛梺鍓插亞閸犳捇宕?    // void window.myAgent.setTitleBarTheme("dark");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("my-agent-theme", themeMode);
    void window.myAgent.setTitleBarTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthRatio));
  }, [sidebarWidthRatio]);

  useEffect(() => {
    if (!config) {
      return;
    }

    const selectedProject =
      projects.find((project) => project.id === activeProjectId) ??
      projects[0];

    setProviderForm({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey,
      model: config.provider.model,
      reasoningEffort: config.provider.reasoningEffort ?? "high",
      rootPath: selectedProject?.rootPath ?? config.workspace.rootPath,
      approvalPolicy: selectedProject?.approvalPolicy ?? config.workspace.approvalPolicy,
      sandboxMode: selectedProject?.sandboxMode ?? config.workspace.sandboxMode,
    });
  }, [activeProjectId, config, projects]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (composerMenuRef.current && !composerMenuRef.current.contains(target)) {
        setComposerMenuOpen(false);
      }

      if (modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false);
      }

      if (reasoningMenuRef.current && !reasoningMenuRef.current.contains(target)) {
        setReasoningMenuOpen(false);
      }

      if (sandboxMenuRef.current && !sandboxMenuRef.current.contains(target)) {
        setSandboxMenuOpen(false);
      }

      if (branchMenuRef.current && !branchMenuRef.current.contains(target)) {
        setBranchMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      pendingThreadScrollRef.current = null;
      return;
    }

    pendingThreadScrollRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = sidebarResizeStateRef.current;
      const container = appContainerRef.current;

      if (!resizeState || !container || event.pointerId !== resizeState.pointerId) {
        return;
      }

      const rect = container.getBoundingClientRect();

      if (rect.width <= 0) {
        return;
      }

      const deltaRatio = (event.clientX - resizeState.startX) / rect.width;
      setSidebarWidthRatio(clamp(resizeState.startRatio + deltaRatio, SIDEBAR_MIN_RATIO, SIDEBAR_MAX_RATIO));
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (!sidebarResizeStateRef.current || event.pointerId !== sidebarResizeStateRef.current.pointerId) {
        return;
      }

      sidebarResizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const orderedThreads = useMemo(
    () => [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [threads],
  );
  const activeSession = useMemo(
    () => (activeThreadId ? threadSessions[activeThreadId] ?? createEmptyThreadSessionView() : null),
    [activeThreadId, threadSessions],
  );
  const orderedItems = useMemo(
    () => [...(activeSession?.items ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [activeSession?.items],
  );
  const conversationEntries = useMemo(
    () => buildConversationEntries(orderedItems),
    [orderedItems],
  );
  const activeThread = useMemo(
    () => orderedThreads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, orderedThreads],
  );
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects],
  );
  const activeTurn = useMemo(
    () => [...(activeSession?.turns ?? [])].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1),
    [activeSession?.turns],
  );
  const interruptibleTurnId = useMemo(() => {
    const candidate = [...(activeSession?.turns ?? [])]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .reverse()
      .find((turn) => turn.status === "running");

    return candidate?.id;
  }, [activeSession?.turns]);
  const workingThreadIds = useMemo(
    () =>
      new Set(
        Object.entries(threadSessions)
          .filter(([, session]) => session.submitting || session.turns.some((turn) => turn.status === "running" || turn.status === "awaiting_approval"))
          .map(([threadId]) => threadId),
      ),
    [threadSessions],
  );
  const currentThreadBusy = Boolean(activeThreadId && workingThreadIds.has(activeThreadId));
  const canInterrupt = currentThreadBusy && Boolean(interruptibleTurnId);
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);
  const currentSkillDetail = useMemo(
    () => skills.find((skill) => skill.id === skillDetailId) ?? null,
    [skillDetailId, skills],
  );
  const currentSandboxMode = activeThread?.sandboxMode ?? activeProject?.sandboxMode ?? config?.workspace.sandboxMode ?? "workspace-write";
  const availableModels = useMemo(() => {
    const merged = new Map<string, ProviderModelRecord>();

    for (const model of providerModels) {
      merged.set(model.id, model);
    }

    const configuredModel = config?.provider.model?.trim();

    if (configuredModel && !merged.has(configuredModel)) {
      merged.set(configuredModel, { id: configuredModel });
    }

    return [...merged.values()];
  }, [config?.provider.model, providerModels]);
  const filteredBranches = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();

    if (!query) {
      return branchSummary.branches;
    }

    return branchSummary.branches.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchSearch, branchSummary.branches]);
  const activeDraft = useMemo(
    () => getComposerDraft(composerDrafts, activeThreadId),
    [activeThreadId, composerDrafts],
  );
  const input = activeDraft.input;
  const attachments = activeDraft.attachments;
  const includeIdeContext = activeDraft.includeIdeContext;
  const planMode = activeDraft.planMode;
  const pendingApproval = activeSession?.pendingApproval ?? null;
  useEffect(() => {
    const targetThreadId = pendingThreadScrollRef.current;

    if (!activeThreadId || !targetThreadId || targetThreadId !== activeThreadId) {
      return;
    }

    const delays = [0, 80, 220];
    const timers = delays.map((delay, index) =>
      window.setTimeout(() => {
        const container = messageAreaRef.current;

        if (!container || pendingThreadScrollRef.current !== targetThreadId) {
          return;
        }

        container.scrollTop = container.scrollHeight;

        if (index === delays.length - 1) {
          pendingThreadScrollRef.current = null;
        }
      }, delay),
    );

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [activeThreadId, orderedItems.length, pendingApproval?.id]);
  const contextSummary = useMemo(
    () =>
      estimateContextUsage({
        modelId: config?.provider.model,
        items: orderedItems,
        turns: activeSession?.turns ?? [],
        input,
        attachments,
      }),
    [activeSession?.turns, attachments, config?.provider.model, input, orderedItems],
  );
  const setActiveDraft = (updater: (draft: ComposerDraftState) => ComposerDraftState) => {
    setComposerDrafts((current) => {
      const key = activeThreadId ?? "__draft__";
      const draft = getComposerDraft(current, activeThreadId);
      return {
        ...current,
        [key]: updater(draft),
      };
    });
  };

  useEffect(() => {
    if (!currentSkillDetail) {
      setSkillDocument("");
      setSkillDocumentLoading(false);
      setSkillDocumentError(null);
      return;
    }

    let cancelled = false;

    setSkillDocumentLoading(true);
    setSkillDocumentError(null);

    const loadSkillDocument = async () => {
      try {
        const readSkillDocument = window.myAgent?.readSkillDocument;

        if (typeof readSkillDocument !== "function") {
          throw new Error("Skill document reader is unavailable. Restart my-agent and try again.");
        }

        const { content } = await readSkillDocument(currentSkillDetail.path);

        if (cancelled) {
          return;
        }

        setSkillDocument(content);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        setSkillDocument("");
        setSkillDocumentError(error instanceof Error ? error.message : "Unable to load SKILL.md.");
      } finally {
        if (!cancelled) {
          setSkillDocumentLoading(false);
        }
      }
    };

    void loadSkillDocument();

    return () => {
      cancelled = true;
    };
  }, [currentSkillDetail]);

  useEffect(() => {
    if (!activeProjectId) {
      setRuntimeWorktrees([]);
      setRuntimeEnvironments([]);
      setRuntimeWorkflows([]);
      return;
    }

    void Promise.all([
      window.myAgent.listWorktrees(activeProjectId).then((result) => setRuntimeWorktrees(result.worktrees)),
      window.myAgent.listEnvironments(activeProjectId).then((result) => setRuntimeEnvironments(result.environments)),
      window.myAgent.listWorkflows(activeProjectId).then((result) => setRuntimeWorkflows(result.workflows)),
      window.myAgent.listWorkflowRuns().then((result) => setRuntimeWorkflowRuns(result.runs)),
    ]).catch(() => undefined);
  }, [activeProjectId]);

  useEffect(() => {
    void Promise.all([
      window.myAgent.listPlugins().then((result) => setRuntimePlugins(result.plugins)),
      window.myAgent.listMcpMounts().then((result) => setRuntimeMcpMounts(result.mounts)),
      window.myAgent.listMcpSessions().then((result) => setRuntimeMcpSessions(result.sessions)),
    ]).catch(() => undefined);
  }, []);

  useEffect(() => {
    setBranchMenuOpen(false);
    setBranchSearch("");
  }, [activeProjectId, activeThreadId]);

  useEffect(() => {
    let cancelled = false;

    const loadBranchSummary = async () => {
      if (!activeProject?.rootPath) {
        setBranchSummary({
          isGitRepo: false,
          currentBranch: null,
          branches: [],
          loading: false,
        });
        return;
      }

      setBranchSummary((current) => ({ ...current, loading: true, error: undefined }));

      try {
        const scope = activeThreadId ? { threadId: activeThreadId, cwd: activeProject.rootPath } : { cwd: activeProject.rootPath };
        const repoCheck = await window.myAgent.execCommand({
          ...scope,
          command: "git rev-parse --is-inside-work-tree",
        });

        if (cancelled) {
          return;
        }

        if (repoCheck.code !== 0 || repoCheck.stdout.trim() !== "true") {
          setBranchSummary({
            isGitRepo: false,
            currentBranch: null,
            branches: [],
            loading: false,
          });
          return;
        }

        const [currentResult, branchesResult] = await Promise.all([
          window.myAgent.execCommand({
            ...scope,
            command: "git branch --show-current",
          }),
          window.myAgent.execCommand({
            ...scope,
            command: 'git for-each-ref --format="%(refname:short)" refs/heads',
          }),
        ]);

        if (cancelled) {
          return;
        }

        const currentBranch = currentResult.code === 0 ? currentResult.stdout.trim() || null : null;
        const branches = branchesResult.stdout
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean);

        setBranchSummary({
          isGitRepo: true,
          currentBranch,
          branches,
          loading: false,
          error: undefined,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setBranchSummary({
          isGitRepo: false,
          currentBranch: null,
          branches: [],
          loading: false,
          error: error instanceof Error ? error.message : "Unable to inspect git branches.",
        });
      }
    };

    void loadBranchSummary();

    return () => {
      cancelled = true;
    };
  }, [activeProject?.rootPath, activeThreadId]);

  const handleCreateThread = async (projectId?: string) => {
    await createThread(undefined, projectId ?? activeProjectId);
    setActiveView("threads");
  };

  const handleThreadSandboxModeChange = async (mode: SandboxMode) => {
    if (!activeThread || activeThread.sandboxMode === mode) {
      setSandboxMenuOpen(false);
      return;
    }

    await updateThread(activeThread.id, { sandboxMode: mode });
    setSandboxMenuOpen(false);
  };

  const handleSelectThread = async (threadId: string) => {
    await selectThread(threadId);
    setActiveView("threads");
  };

  const handleCreateProject = async () => {
    const picked = await window.myAgent.pickWorkspace();

    if (!picked) {
      return;
    }

    await createProject({ rootPath: picked });
    setActiveView("threads");
  };

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) {
      return;
    }

    sidebarResizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startRatio: sidebarWidthRatio,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleShowAppMenu = (
    menuId: (typeof APP_MENU_ITEMS)[number]["id"],
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();

    void window.myAgent.showAppMenu({
      menuId,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 6),
    });
  };

  const handlePickFiles = async () => {
    const pickedFiles = await window.myAgent.pickFiles();

    if (pickedFiles.length === 0) {
      return;
    }

    setActiveDraft((draft) => ({
      ...draft,
      attachments: mergeComposerAttachments(draft.attachments, pickedFiles),
    }));
    setComposerMenuOpen(false);
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (!activeProject?.rootPath) {
      return;
    }

    const scope = activeThreadId ? { threadId: activeThreadId, cwd: activeProject.rootPath } : { cwd: activeProject.rootPath };
    const result = await window.myAgent.execCommand({
      ...scope,
      command: `git checkout ${quoteGitPath(branchName)}`,
    });

    if (result.code !== 0) {
      setBranchSummary((current) => ({
        ...current,
        error: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `Unable to checkout ${branchName}.`,
      }));
      return;
    }

    setBranchMenuOpen(false);
    setBranchSearch("");
    setBranchSummary((current) => ({ ...current, currentBranch: branchName, error: undefined }));
  };

  const handleCreateBranch = async () => {
    if (!activeProject?.rootPath) {
      return;
    }

    const branchName = window.prompt("New branch name", "");

    if (!branchName) {
      return;
    }

    const trimmed = branchName.trim();

    if (!trimmed) {
      return;
    }

    const scope = activeThreadId ? { threadId: activeThreadId, cwd: activeProject.rootPath } : { cwd: activeProject.rootPath };
    const result = await window.myAgent.execCommand({
      ...scope,
      command: `git checkout -b ${quoteGitPath(trimmed)}`,
    });

    if (result.code !== 0) {
      setBranchSummary((current) => ({
        ...current,
        error: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `Unable to create branch ${trimmed}.`,
      }));
      return;
    }

    setBranchMenuOpen(false);
    setBranchSearch("");
    setBranchSummary((current) => ({
      isGitRepo: true,
      currentBranch: trimmed,
      branches: current.branches.includes(trimmed) ? current.branches : [trimmed, ...current.branches],
      loading: false,
      error: undefined,
    }));
  };

  const handleModelSelect = async (modelId: string) => {
    setModelMenuOpen(false);

    if (!config || config.provider.model === modelId) {
      return;
    }

    await updateConfig({
      provider: {
        ...config.provider,
        model: modelId,
      },
    });
  };

  const handleReasoningSelect = async (effort: ModelReasoningEffort) => {
    setReasoningMenuOpen(false);

    if (!config || config.provider.reasoningEffort === effort) {
      return;
    }

    await updateConfig({
      provider: {
        ...config.provider,
        reasoningEffort: effort,
      },
    });
  };

  const submitTurn = async () => {
    const message = input.trim();

    if (!message && attachments.length === 0) {
      return;
    }

    const composedMessage = buildComposerInput({
      message,
      planMode,
    });

    setActiveDraft((draft) => ({
      ...draft,
      input: "",
      attachments: [],
    }));
    setComposerMenuOpen(false);
    await sendTurn(composedMessage, [], attachments, includeIdeContext);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (currentThreadBusy) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitTurn();
    }
  };

  const handleComposerPaste = async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();

    const pastedAttachments = await Promise.all(
      imageFiles.map((file, index) => createPastedImageAttachment(file, index)),
    );

    setActiveDraft((draft) => ({
      ...draft,
      attachments: mergeComposerAttachments(draft.attachments, pastedAttachments),
    }));
  };

  if (bootError) {
    return <StartupErrorShell message={bootError} onRetry={() => void bootstrap()} />;
  }

  if (!bootstrapped) {
    return <LoadingShell />;
  }

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}
      style={
        {
          "--shell-sidebar-width": sidebarCollapsed ? "0px" : `${(sidebarWidthRatio * 100).toFixed(2)}%`,
          "--shell-resize-handle-width": sidebarCollapsed ? "0px" : "10px",
        } as CSSProperties
      }
    >
      <header className="app-toolbar">
        <div className="app-toolbar__menus">
          <button
            className="app-toolbar__brand"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <Rabbit className="app-toolbar__logo" aria-hidden="true" size={15} strokeWidth={1.9} />
          </button>
          <button
            className="app-toolbar__theme-toggle"
            onClick={() => setThemeMode((current) => (current === "light" ? "dark" : "light"))}
            aria-label={themeMode === "light" ? "Switch to dark theme" : "Switch to light theme"}
            title={themeMode === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {themeMode === "light" ? <Moon size={14} /> : <Sun size={14} />}
          </button>
          {APP_MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              className="app-toolbar__menu-button"
              onClick={(event) => handleShowAppMenu(item.id, event)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="app-toolbar__drag-region" aria-hidden="true" />
        <div className="app-toolbar__controls">
          <button
            className="app-toolbar__control"
            onClick={() => window.myAgent.windowMinimize()}
            aria-label="Minimize"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            className="app-toolbar__control"
            onClick={() => window.myAgent.windowToggleFullscreen()}
            aria-label="Toggle fullscreen"
            title="Toggle fullscreen"
          >
            <Square size={12} />
          </button>
          <button
            className="app-toolbar__control app-toolbar__control--close"
            onClick={() => window.myAgent.windowClose()}
            aria-label="Close"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="app-container" ref={appContainerRef}>
      {/* 闂傚倷娴囬褎顨ラ崫銉х濠电姴鍋嗛悞浠嬫煠婵劕鈧澹曢懞銉﹀弿婵☆垱瀵х涵楣冩煟閵堝鐣洪柡灞诲€楃划娆戞崉閵娿倗椹崇紓鍌氬€哥粔鏉懨洪銏犵畺鐎瑰嫭澹嬮弸搴ㄧ叓閸ャ劍鎯勫ù灏栧亾闂傚倷鑳剁涵鍫曞疾濞戔懞鍥偨缁嬭儻鎽曢梺闈涱焾閸庮喖危閸喓绠鹃柛鈩兠悘鈺呮煕濞嗘劗绠樼紒杈ㄦ尰閹峰懘鐛径鍛婂媰闂備胶鍘ч悿鍥春閺嶎偆鐭夐柟鐑橆殕閺呮繈鏌涚仦鐐殤闁挎稒绮岄埞鎴︽偐鐠囇冧紣闂佺懓鍟跨换鎺撶缁嬪簱鏀介悗锝庡亐閹?*/}
      <aside className="sidebar">
        {/* 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€堕埀顒€鍟崇粻娑樷槈濡⒈妲繝鐢靛仦閸ㄨ泛顫濋妸鈺佺婵鍩栭崐鐢告煟閵忕姵鍟炴繛鍛矋缁绘稑鐣濇繝渚€鍋楅梺鍝勬湰缁嬫垿鎮惧┑鍫氬亾閿濆簼鎲炬繛宸幘缁辨挻鎷呴悷鏉款潔濡炪們鍔岄敃顏勵嚕鐠囨祴妲堥柕蹇曞Х閻嫰姊虹粙鎸庢拱缁炬澘绉归幃姗€宕卞☉娆屾嫼缂備礁顑堝▔鏇犵不閺屻儲鐓忛柛顐犲灲閸忔 */}
        <div className="sidebar__section sidebar__section--tabs">
          <nav className="sidebar__nav">
            <NavButton
              icon={<MessageSquarePlus size={18} />}
              label="Workspace"
              active={activeView === "threads"}
              onClick={() => setActiveView("threads")}
            />
            <NavButton
              icon={<Zap size={18} />}
              label="Skills"
              active={activeView === "skills"}
              onClick={() => setActiveView("skills")}
            />
            <NavButton
              icon={<Grid3X3 size={18} />}
              label="Plugins"
              active={activeView === "plugins"}
              onClick={() => setActiveView("plugins")}
            />
            <NavButton
              icon={<GitBranch size={18} />}
              label="Automation"
              active={activeView === "automation"}
              onClick={() => setActiveView("automation")}
            />
          </nav>
        </div>

        {/* 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€堕埀顒€鍟崇粻娑樷槈濡⒈妲繝鐢靛仦閸ㄨ埖绌遍悜妯诲弿闁规儼濮ら悡鍐煕濠靛棗顏╅柡鍡樻礃缁绘稑鐣濇繝渚€鍋楅梺鍝勬湰缁嬫垿鎮惧┑鍫氬亾閿濆簼鎲炬繛宸幘缁辨挻鎷呴悷鏉款潔闂侀潧妫楃粣宸搄ect闂傚倷娴囬褍顫濋敃鍌︾稏濠㈣埖鍔曠粻鏍煕椤愶絾绀€缁炬儳娼￠弻鐔封枔閸喗鐏撶紓浣插亾濠电姴娲﹂悡娑㈡煕閹扳晛濡垮褎鐩弻?*/}
        <div className="sidebar__section sidebar__section--projects">
          <ThreadsPanel
            projects={projects}
            activeProjectId={activeProjectId}
            threads={orderedThreads}
            activeThreadId={activeThreadId}
            workingThreadIds={workingThreadIds}
            search={threadSearch}
            onSearchChange={setThreadSearch}
            onSelectThread={handleSelectThread}
            onCreateThread={handleCreateThread}
            onCreateProject={handleCreateProject}
            onRevealProject={async (projectPath) => {
              await window.myAgent.revealProjectPath(projectPath).catch(() => null);
            }}
          />
        </div>

        {/* 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€堕埀顒€鍟崇粻娑樷槈濡⒈妲繝鐢靛仦閸ㄨ泛顫濋妸褏涓嶉柡鍌涳紩瑜版帗鏅查柛顐ゅ枂閳ь剙鍟换娑樼暆婵犱線鍋楅梺鍝勬湰缁嬫垿鎮惧┑鍫氬亾閿濆簼鎲炬繛宸幘缁辨挻鎷呴悷鏉款潔濡炪們鍔岄敃顏堢嵁閸愵亝鍠嗛柛鏇ㄥ墮椤庢挾绱撴担鍓插剰缂併劑浜堕獮鎰板礃椤旇В鎷?*/}
        <div className="sidebar__section sidebar__section--footer">
          <NavButton
            icon={<Settings size={18} />}
            label="Settings"
            active={activeView === "settings"}
            onClick={() => setActiveView("settings")}
          />
        </div>
      </aside>
      <div
        className="sidebar-resize-handle"
        onPointerDown={handleSidebarResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />

      {/* 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犳彃銆掑锝呬壕濡炪們鍨烘穱娲囬崷顓涘亾鐟欏嫭澶勯柛鎾寸洴閸┾偓妞ゆ帒鍊归弳鈺冪棯椤撶偟鍩ｇ€规洘鍨块獮妯兼嫚閸欏绁舵俊鐐€栭幐楣冨窗鎼粹檧鏋旂€光偓閸曨剛鍘?*/}
      <main className="main-content">
        {activeView === "threads" ? (
          <>
            {/* 婵犵數濮烽。顔炬閺囥垹纾婚柟杈剧畱绾惧綊鏌￠崶銉ョ仾闁稿顦埞鎴﹀磼濠婂海鍔哥紒鐐劤濞硷繝寮婚悢铏圭＜闁靛繒濮甸悘鍫ユ⒑閸涘﹤濮€闁稿鎹囧缁樻媴鐟欏嫬浠╅梺绋垮濡炶棄鐣峰鍫熸櫇闁稿本纰嶆潏鍫濐渻閵堝棛澧遍柛瀣仱閹?*/}
            <header className="main-header">
              <div className="main-header__title">
                <h1>{activeThread?.title ?? "New Thread"}</h1>
                <span className="main-header__project">{activeProject?.name ?? "Current Project"}</span>
              </div>
            </header>

            {/* 濠电姷鏁告慨鐑藉极閹间礁纾婚柣鎰惈閸ㄥ倿鏌ｉ姀鐘冲暈闁稿顑呴埞鎴︽偐閹绘帗娈銈嗘礋娴滃爼寮诲☉妯锋婵炲棙鍔楃粙鍥╃磽娴ｆ彃浜鹃梺绯曞墲鐪夌紒璇叉閺屾洟宕煎┑鍥ф濡炪倕绻堥崕鐢稿蓟?*/}
            <div className="message-area" ref={messageAreaRef}>
              {orderedItems.length === 0 ? (
                <EmptyState />
              ) : (
                <ConversationFeed entries={conversationEntries} threadId={activeThreadId} />
              )}

              {/* 闂傚倸鍊峰ù鍥敋瑜庨〃銉╁箹娴ｇ鍋嶅┑鐘诧工閻楀棛绮堥崼鐔虹瘈闂傚牊绋掑婵嬫煟濠靛棛鍩ｉ柡宀€鍠栭幃婊兾熼悜鈺傚闂佽瀛╃喊宥呯暆缁嬫娼栨繛宸簻閸ㄥ倹銇勯弴鐐村櫣闁告挸鍟块埞鎴︽偐椤愵澀澹?*/}
              {pendingApproval && (
                <ApprovalRequest
                  approval={pendingApproval}
                  onApprove={(scope) => void respondApproval(pendingApproval.id, "approve", scope)}
                  onReject={() => void respondApproval(pendingApproval.id, "reject")}
                />
              )}
            </div>

            {/* 闂傚倸鍊风粈浣革耿闁秴鍌ㄧ憸鏃堝箖濞差亜惟闁靛鍟浠嬪箖閵忋倖鍋傞幖杈剧秶缁辩敻姊虹拠鎻掝劉缂佸甯熼幗顐ょ磽閸屾氨孝婵炲樊鍙冨濠氭偄閻撳海鐣鹃悷婊冪Ч瀵櫕娼忛埞鎯т壕婵炲牆鐏濋弸鐔封攽閻愯韬€?*/}
            <ComposerBar
              input={input}
              onChange={(value) =>
                setActiveDraft((draft) => ({
                  ...draft,
                  input: value,
                }))
              }
              onSubmit={submitTurn}
              onInterrupt={() => interruptibleTurnId && void interruptTurn(interruptibleTurnId)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              attachments={attachments}
              skills={enabledSkills}
              onAddFiles={() => void handlePickFiles()}
              onRemoveAttachment={(path) =>
                setActiveDraft((draft) => ({
                  ...draft,
                  attachments: draft.attachments.filter((attachment) => attachment.path !== path),
                }))
              }
              composerMenuOpen={composerMenuOpen}
              onToggleComposerMenu={() => {
                setComposerMenuOpen((current) => !current);
                setModelMenuOpen(false);
                setReasoningMenuOpen(false);
              }}
              composerMenuRef={composerMenuRef}
              includeIdeContext={includeIdeContext}
              onToggleIdeContext={() =>
                setActiveDraft((draft) => ({
                  ...draft,
                  includeIdeContext: !draft.includeIdeContext,
                }))
              }
              planMode={planMode}
              onTogglePlanMode={() =>
                setActiveDraft((draft) => ({
                  ...draft,
                  planMode: !draft.planMode,
                }))
              }
              modelMenuOpen={modelMenuOpen}
              onToggleModelMenu={() => {
                setModelMenuOpen((current) => !current);
                setComposerMenuOpen(false);
                setReasoningMenuOpen(false);
              }}
              modelMenuRef={modelMenuRef}
              availableModels={availableModels}
              providerModelsLoading={providerModelsLoading}
              providerModelsError={providerModelsError}
              selectedModel={config?.provider.model ?? ""}
              onSelectModel={(modelId) => void handleModelSelect(modelId)}
              reasoningMenuOpen={reasoningMenuOpen}
              onToggleReasoningMenu={() => {
                setReasoningMenuOpen((current) => !current);
                setComposerMenuOpen(false);
                setModelMenuOpen(false);
              }}
              reasoningMenuRef={reasoningMenuRef}
              selectedReasoningEffort={config?.provider.reasoningEffort ?? "high"}
              onSelectReasoningEffort={(effort) => void handleReasoningSelect(effort)}
              currentSandboxMode={currentSandboxMode}
              sandboxMenuOpen={sandboxMenuOpen}
              onToggleSandboxMenu={() => {
                setSandboxMenuOpen((current) => !current);
                setBranchMenuOpen(false);
              }}
              sandboxMenuRef={sandboxMenuRef}
              onSelectSandboxMode={(mode) => void handleThreadSandboxModeChange(mode)}
              branchMenuOpen={branchMenuOpen}
              onToggleBranchMenu={() => {
                setBranchMenuOpen((current) => !current);
                setSandboxMenuOpen(false);
              }}
              branchMenuRef={branchMenuRef}
              branchSummary={branchSummary}
              branchSearch={branchSearch}
              onBranchSearchChange={setBranchSearch}
              filteredBranches={filteredBranches}
              onSelectBranch={(branch) => void handleSwitchBranch(branch)}
              onCreateBranch={() => void handleCreateBranch()}
              contextSummary={contextSummary}
              loading={currentThreadBusy}
              canInterrupt={canInterrupt}
            />
          </>
        ) : activeView === "skills" ? (
          <SkillsPanel
            skills={skills}
            enabledSkills={enabledSkills}
            onToggleSkill={toggleSkill}
            onSelectSkill={setSkillDetailId}
          />
        ) : activeView === "plugins" ? (
          <RuntimePluginsPanel
            plugins={runtimePlugins}
            mcpMounts={runtimeMcpMounts}
            mcpSessions={runtimeMcpSessions}
            onRefreshMount={(mountId) =>
              window.myAgent.refreshMcpMount(mountId).then(() =>
                window.myAgent.listMcpSessions().then((result) => setRuntimeMcpSessions(result.sessions)),
              )
            }
          />
        ) : activeView === "automation" ? (
          <RuntimeAutomationPanel
            projectId={activeProjectId}
            workflows={runtimeWorkflows}
            runs={runtimeWorkflowRuns}
            onRunWorkflow={(workflowId) =>
              activeProjectId
                ? window.myAgent.runWorkflow({ workflowId, projectId: activeProjectId }).then(() =>
                    window.myAgent.listWorkflowRuns().then((result) => setRuntimeWorkflowRuns(result.runs)),
                  )
                : Promise.resolve(null)
            }
            onResumeWorkflow={(runId) =>
              window.myAgent.resumeWorkflow(runId).then(() =>
                window.myAgent.listWorkflowRuns().then((result) => setRuntimeWorkflowRuns(result.runs)),
              )
            }
          />
        ) : (
          <SettingsPanel
            project={activeProject}
            providerForm={providerForm}
            setProviderForm={setProviderForm}
            providerTestMessage={providerTestMessage}
            providerModels={availableModels}
            providerModelsLoading={providerModelsLoading}
            onTestProvider={testProvider}
            onRefreshProviderModels={refreshProviderModels}
            worktrees={runtimeWorktrees}
            environments={runtimeEnvironments}
            onSaveConfig={() =>
              void Promise.all([
                updateConfig({
                  provider: {
                    ...(config?.provider ?? {
                      id: "default-provider",
                      name: "Default Provider",
                      apiFlavor: "responses",
                    }),
                    baseUrl: providerForm.baseUrl,
                    apiKey: providerForm.apiKey,
                    model: providerForm.model,
                    reasoningEffort: providerForm.reasoningEffort,
                  },
                }),
                activeProject
                  ? updateProject(activeProject.id, {
                      rootPath: providerForm.rootPath,
                      approvalPolicy: providerForm.approvalPolicy,
                      sandboxMode: providerForm.sandboxMode,
                    })
                  : Promise.resolve(),
              ])
            }
            onPickWorkspace={async () => {
              const picked = await window.myAgent.pickWorkspace();
              if (picked) {
                setProviderForm((state) => ({ ...state, rootPath: picked }));
              }
            }}
          />
        )}
        </main>
      </div>

      {/* 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸婂爼鏌涢鐘插姎缁炬儳顭烽弻鐔煎礈瑜忕敮娑㈡煟閹捐泛鈻堥柡灞剧洴楠炲洭顢橀悩顔间沪闂備胶顭堥鍡涘箲閸ヮ剙绠栭柕鍫濇婵挳鏌涘☉姗堝姛闁哄缍婂濠氬磼濞嗘劗銈板銈嗘礃閻楃姴鐣风憴鍕嚤闁哄鍨归悿鍥煙閸忓吋鍎楅柣鎾崇墦瀵偆鈧綆鍋佹禍婊堟煛閸愩劌鈧憡绂嶆ィ鍐╁€垫慨姗嗗幘椤ｈ尙绱掔紒妯肩疄婵☆偄鍟埥澶娾枎閹存瑥浜归梻鍌欐祰閵嗏偓闁?*/}
      <Dialog.Root open={Boolean(currentSkillDetail)} onOpenChange={(open) => !open && setSkillDetailId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content skill-dialog">
            <div className="skill-dialog__layout">
              <Dialog.Close className="skill-dialog__close" aria-label="Close skill details">
                <X size={20} />
              </Dialog.Close>
              <div className="skill-dialog__header">
                <div className="skill-dialog__icon-container">
                  <div className="skill-dialog__icon">
                    <Zap size={32} />
                  </div>
                </div>
                <div className="skill-dialog__title-row">
                  <div className="skill-dialog__titles">
                    <Dialog.Title className="dialog-title skill-dialog__title">
                      {currentSkillDetail?.metadata.displayName ?? currentSkillDetail?.name} <span className="skill-dialog__badge">Skill</span>
                    </Dialog.Title>
                    <div className="skill-dialog__subtitle">
                      {currentSkillDetail?.metadata.shortDescription ?? "Enhance your agent's capabilities"}
                    </div>
                  </div>
                  <div className="skill-dialog__actions-top">
                    {currentSkillDetail && (
                      <button
                        type="button"
                        className={`skill-dialog__toggle ${currentSkillDetail.enabled ? "skill-dialog__toggle--on" : ""}`}
                        onClick={() => void toggleSkill(currentSkillDetail.id)}
                      >
                        {currentSkillDetail.enabled ? "ON" : "OFF"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="skill-dialog__folder"
                      aria-label="Open skill folder"
                      title="Open skill folder"
                      onClick={() =>
                        currentSkillDetail
                          ? window.myAgent.revealSkillPath(currentSkillDetail.path).catch(() => null)
                          : Promise.resolve(undefined)
                      }
                    >
                      <FolderOpen size={18} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="skill-dialog__body">
                <div className="skill-dialog__reader" role="document" aria-label="SKILL.md document">
                  <div className="skill-dialog__reader-bar">
                    <span>SKILL.md</span>
                    <code>{currentSkillDetail?.path}</code>
                  </div>
                  <div className="skill-dialog__reader-body">
                    {skillDocumentLoading ? (
                      <div className="skill-dialog__reader-state">Loading `SKILL.md`...</div>
                    ) : skillDocumentError ? (
                      <div className="skill-dialog__reader-state skill-dialog__reader-state--error">
                        {skillDocumentError}
                      </div>
                    ) : (
                      <pre className="skill-dialog__document">{skillDocument}</pre>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`nav-button ${active ? "nav-button--active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <span className="nav-button__icon">{icon}</span>
      <span className="nav-button__label">{label}</span>
    </button>
  );
}

function ThreadsPanel({
  projects,
  activeProjectId,
  threads,
  activeThreadId,
  workingThreadIds,
  search,
  onSearchChange,
  onSelectThread,
  onCreateThread,
  onCreateProject,
  onRevealProject,
}: {
  projects: ProjectRecord[];
  activeProjectId?: string;
  threads: import("@my-agent/protocol").ThreadRecord[];
  activeThreadId?: string;
  workingThreadIds: Set<string>;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onCreateThread: (projectId?: string) => Promise<void>;
  onCreateProject: () => Promise<void>;
  onRevealProject: (projectPath: string) => Promise<void>;
}) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    activeProjectId ? [activeProjectId] : projects[0] ? [projects[0].id] : [],
  );
  const [searchExpanded, setSearchExpanded] = useState(Boolean(search.trim()));
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setExpandedProjectIds((current) => (current.includes(activeProjectId) ? current : [...current, activeProjectId]));
  }, [activeProjectId]);

  useEffect(() => {
    if (projects.length === 0) {
      setExpandedProjectIds([]);
      return;
    }

    setExpandedProjectIds((current) => current.filter((projectId) => projects.some((projectEntry) => projectEntry.id === projectId)));
  }, [projects]);

  useEffect(() => {
    if (!searchExpanded) {
      return;
    }

    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [searchExpanded]);

  useEffect(() => {
    if (!searchExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        onSearchChange("");
        setSearchExpanded(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [searchExpanded, onSearchChange]);

  useEffect(() => {
    if (!openProjectMenuId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (projectMenuRef.current && !projectMenuRef.current.contains(target)) {
        setOpenProjectMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [openProjectMenuId]);

  const searchTerm = search.trim().toLowerCase();
  const projectGroups = projects.map((entry) => {
    const projectThreads = threads.filter((thread) => thread.projectId === entry.id);
    const visibleThreads = searchTerm
      ? projectThreads.filter((thread) => thread.title.toLowerCase().includes(searchTerm))
      : projectThreads;

    return {
      project: entry,
      totalCount: projectThreads.length,
      visibleThreads,
    };
  });

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((entry) => entry !== projectId)
        : [...current, projectId],
    );
  };

  const closeSearch = () => {
    onSearchChange("");
    setSearchExpanded(false);
  };

  return (
    <div className="sidebar-secondary__content thread-sidebar" ref={searchContainerRef}>
      <div className="thread-sidebar__header">
        <div className="thread-sidebar__title-row">
          <span className="thread-sidebar__title">Projects</span>
          <div className="thread-sidebar__actions">
            <button
              className={`thread-sidebar__action ${searchExpanded ? "thread-sidebar__action--active" : ""}`}
              onClick={() => {
                if (searchExpanded) {
                  closeSearch();
                  return;
                }

                setSearchExpanded(true);
              }}
              aria-label="Search threads"
              title="Search threads"
            >
              <Search size={14} />
            </button>
            <button
              className="thread-sidebar__action"
              onClick={() => void onCreateProject()}
              aria-label="Create project"
              title="Create project"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className={`thread-sidebar__search-shell ${searchExpanded ? "thread-sidebar__search-shell--open" : ""}`}>
          <div className="thread-sidebar__search">
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search threads"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                }
              }}
            />
          </div>
        </div>
      </div>

      <div className="thread-sidebar__list">
        {projects.length > 0 ? (
          <div className="project-tree">
            {projectGroups.map(({ project: entry, visibleThreads }) => {
              const expanded = expandedProjectIds.includes(entry.id);
              const isActiveProject = entry.id === activeProjectId;
              const emptyLabel = searchTerm
                ? "No matching threads"
                : "No threads yet";

              return (
                <section
                  key={entry.id}
                  className={`project-tree__group ${isActiveProject ? "project-tree__group--active" : ""}`}
                >
                  <div className="project-tree__project">
                    <button
                      className={`project-tree__toggle ${expanded ? "project-tree__toggle--open" : ""}`}
                      onClick={() => toggleProject(entry.id)}
                      aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                    >
                      <ChevronRight size={14} />
                    </button>
                    <button
                      className={`project-item ${isActiveProject ? "project-item--active" : ""}`}
                      onClick={() => toggleProject(entry.id)}
                    >
                      <div className="project-item__name">{entry.name}</div>
                    </button>

                    {expanded && (
                      <div className="project-tree__controls">
                        <div
                          className="project-tree__menu-anchor"
                          ref={openProjectMenuId === entry.id ? projectMenuRef : null}
                        >
                          <button
                            className={`project-tree__control ${openProjectMenuId === entry.id ? "project-tree__control--active" : ""}`}
                            onClick={() =>
                              setOpenProjectMenuId((current) => (current === entry.id ? null : entry.id))
                            }
                            aria-label={`Open ${entry.name} options`}
                            title="Project options"
                          >
                            <MoreHorizontal size={14} />
                          </button>

                          {openProjectMenuId === entry.id && (
                            <div className="project-tree__menu">
                              <button
                                className="project-tree__menu-item"
                                onClick={() => {
                                  setOpenProjectMenuId(null);
                                  void onRevealProject(entry.rootPath);
                                }}
                              >
                                <span className="project-tree__menu-icon">
                                  <FolderOpen size={14} />
                                </span>
                                <span>Open in Explorer</span>
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          className="project-tree__control"
                          onClick={() => void onCreateThread(entry.id)}
                          aria-label={`Create a new thread in ${entry.name}`}
                          title="New thread"
                        >
                          <MessageSquarePlus size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {expanded && (
                    <div className="project-tree__threads">
                      {visibleThreads.length > 0 ? (
                        visibleThreads.map((thread) => (
                          <button
                            key={thread.id}
                            className={`thread-item thread-item--nested ${thread.id === activeThreadId ? "thread-item--active" : ""}`}
                            onClick={() => void onSelectThread(thread.id)}
                          >
                            <div className="thread-item__content thread-item__content--compact">
                              <div className="thread-item__title">
                                {workingThreadIds.has(thread.id) && <span className="thread-item__spinner" aria-hidden="true" />}
                                <span>{thread.title}</span>
                              </div>
                              <div className="thread-item__age">{formatRelativeTime(thread.updatedAt)}</div>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="project-tree__empty">{emptyLabel}</div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="sidebar-secondary__empty">
            <MessageSquarePlus size={24} />
            <p>No projects yet</p>
            <span>Create a project to get started</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillsPanel({
  skills,
  enabledSkills,
  onToggleSkill,
  onSelectSkill,
}: {
  skills: SkillDescriptor[];
  enabledSkills: SkillDescriptor[];
  onToggleSkill: (skillId: string) => Promise<void>;
  onSelectSkill: (skillId: string) => void;
}) {
  return (
    <div className="skills-page">
      <div className="skills-page__header">
        <h2 className="skills-page__title">Skills</h2>
        <span className="skills-page__count">{enabledSkills.length} enabled</span>
      </div>

      <div className="skills-grid">
        {skills.map((skill) => (
          <div 
            key={skill.id} 
            className={`skill-card ${skill.enabled ? "" : "skill-card--disabled"}`}
            onClick={() => onSelectSkill(skill.id)}
          >
            <div className="skill-card__header">
              <div className="skill-card__title">
                <h3>{skill.metadata.displayName ?? skill.name}</h3>
              </div>
              <button
                className={`skill-card__toggle ${skill.enabled ? "skill-card__toggle--on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void onToggleSkill(skill.id);
                }}
              >
                {skill.enabled ? "ON" : "OFF"}
              </button>
            </div>
            <div className="skill-card__desc">{skill.metadata.shortDescription ?? skill.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuntimePluginsPanel({
  plugins,
  mcpMounts,
  mcpSessions,
  onRefreshMount,
}: {
  plugins: PluginRecord[];
  mcpMounts: McpMountRecord[];
  mcpSessions: McpSessionRecord[];
  onRefreshMount: (mountId: string) => Promise<unknown>;
}) {
  return (
    <div className="skills-page">
      <div className="skills-page__header">
        <h2 className="skills-page__title">Runtime Surfaces</h2>
        <span className="skills-page__count">{plugins.length} plugins · {mcpMounts.length} MCP mounts</span>
      </div>
      <div className="skills-grid">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="skill-card">
            <div className="skill-card__header">
              <div>
                <h3>{plugin.name}</h3>
                <span>{plugin.version}</span>
              </div>
              <span className={`skill-card__status ${plugin.enabled ? "skill-card__status--enabled" : ""}`}>{plugin.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <p>{plugin.path}</p>
            <pre>{plugin.capabilities.join(", ") || "No declared capabilities"}</pre>
          </div>
        ))}
        {mcpMounts.map((mount) => (
          <div key={mount.id} className="skill-card">
            <div className="skill-card__header">
              <div>
                <h3>{mount.name}</h3>
                <span>{mount.transport.toUpperCase()}</span>
              </div>
              <span className={`skill-card__status ${mount.enabled ? "skill-card__status--enabled" : ""}`}>{mount.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <p>{mount.url ?? mount.command ?? "No target configured"}</p>
            <pre>
              Session: {mcpSessions.find((session) => session.mountId === mount.id)?.status ?? "not connected"}
            </pre>
            <button className="button" onClick={() => void onRefreshMount(mount.id)}>
              Refresh Mount
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuntimeAutomationPanel({
  projectId,
  workflows,
  runs,
  onRunWorkflow,
  onResumeWorkflow,
}: {
  projectId?: string;
  workflows: WorkflowRecord[];
  runs: WorkflowRunRecord[];
  onRunWorkflow: (workflowId: string) => Promise<unknown>;
  onResumeWorkflow: (runId: string) => Promise<unknown>;
}) {
  return (
    <div className="skills-page">
      <div className="skills-page__header">
        <h2 className="skills-page__title">Workflows</h2>
        <span className="skills-page__count">{workflows.length} available</span>
      </div>
      <div className="skills-grid">
        {workflows.map((workflow) => (
          <div key={workflow.id} className="skill-card">
            <div className="skill-card__header">
              <div>
                <h3>{workflow.name}</h3>
                <span>{workflow.source}</span>
              </div>
            </div>
            <p>{workflow.description}</p>
            <pre>{workflow.steps.map((step) => `${step.id}: ${step.type}`).join("\n")}</pre>
            <button className="button" disabled={!projectId} onClick={() => void onRunWorkflow(workflow.id)}>
              Run Workflow
            </button>
            <div className="settings-panel__message">
              Recent runs: {runs.filter((run) => run.workflowId === workflow.id).length}
            </div>
            {runs
              .filter((run) => run.workflowId === workflow.id)
              .slice(0, 2)
              .map((run) => (
                <div key={run.id} className="settings-panel__message">
                  {run.status} · {run.id}
                  {run.status === "running" || run.status === "failed" ? (
                    <button className="button button--small" onClick={() => void onResumeWorkflow(run.id)}>
                      Resume
                    </button>
                  ) : null}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsPanel({
  project,
  providerForm,
  setProviderForm,
  providerTestMessage,
  providerModels,
  providerModelsLoading,
  worktrees,
  environments,
  onTestProvider,
  onRefreshProviderModels,
  onSaveConfig,
  onPickWorkspace,
}: {
  project?: ProjectRecord;
  providerForm: ProviderFormState;
  setProviderForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  providerTestMessage?: string;
  providerModels: ProviderModelRecord[];
  providerModelsLoading: boolean;
  worktrees: WorktreeRecord[];
  environments: EnvironmentRecord[];
  onTestProvider: () => Promise<void>;
  onRefreshProviderModels: () => Promise<void>;
  onSaveConfig: () => void;
  onPickWorkspace: () => Promise<void>;
}) {
  return (
    <div className="sidebar-secondary__content settings-panel">
      <div className="sidebar-secondary__header">
        <h2>Settings</h2>
      </div>

      <div className="settings-panel__content">
        <div className="settings-panel__section">
          <h3>Provider</h3>
          <label className="settings-field">
            <span>Base URL</span>
            <input
              value={providerForm.baseUrl}
              onChange={(e) => setProviderForm((s) => ({ ...s, baseUrl: e.target.value }))}
              placeholder="https://api.example.com"
            />
          </label>
          <label className="settings-field">
            <span>Model</span>
            {providerModels.length > 0 ? (
              <select
                value={providerForm.model}
                onChange={(e) => setProviderForm((s) => ({ ...s, model: e.target.value }))}
              >
                {!providerForm.model && <option value="">Select a model</option>}
                {providerModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={providerForm.model}
                onChange={(e) => setProviderForm((s) => ({ ...s, model: e.target.value }))}
                placeholder="gpt-5.4"
              />
            )}
          </label>
          <label className="settings-field">
            <span>Reasoning Effort</span>
            <select
              value={providerForm.reasoningEffort}
              onChange={(e) =>
                setProviderForm((s) => ({ ...s, reasoningEffort: e.target.value as ModelReasoningEffort }))
              }
            >
              {REASONING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>API Key</span>
            <input
              value={providerForm.apiKey}
              onChange={(e) => setProviderForm((s) => ({ ...s, apiKey: e.target.value }))}
              type="password"
              placeholder="sk-..."
            />
          </label>
        </div>

        <div className="settings-panel__section">
          <h3>{project ? `Project: ${project.name}` : "Project"}</h3>
          <label className="settings-field">
            <span>Root Path</span>
            <div className="settings-field__row">
              <input
                value={providerForm.rootPath}
                onChange={(e) => setProviderForm((s) => ({ ...s, rootPath: e.target.value }))}
                placeholder="/path/to/workspace"
              />
              <button className="button--small" onClick={() => void onPickWorkspace()}>
                <FolderOpen size={14} />
              </button>
            </div>
          </label>
        </div>

        <div className="settings-panel__section">
          <h3>Policy</h3>
          <label className="settings-field">
            <span>Approval Policy</span>
            <select
              value={providerForm.approvalPolicy}
              onChange={(e) => setProviderForm((s) => ({ ...s, approvalPolicy: e.target.value as typeof s.approvalPolicy }))}
            >
              <option value="on-request">on-request</option>
              <option value="on-failure">on-failure</option>
              <option value="never">never</option>
            </select>
          </label>
        </div>

        <div className="settings-panel__actions">
          <button className="button" onClick={() => void onRefreshProviderModels()}>
            {providerModelsLoading ? "Loading Models..." : "Refresh Models"}
          </button>
          <button className="button" onClick={() => void onTestProvider()}>
            Test Provider
          </button>
          <button className="button button--primary" onClick={onSaveConfig}>
            Save Settings
          </button>
        </div>

        {providerTestMessage && (
          <div className="settings-panel__message">{providerTestMessage}</div>
        )}

        <div className="settings-panel__section">
          <h3>Runtime Diagnostics</h3>
          <div className="settings-panel__message">Worktrees: {worktrees.length}</div>
          <div className="settings-panel__message">Environments: {environments.length}</div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="sidebar-secondary__content">
      <div className="sidebar-secondary__header">
        <h2>{title}</h2>
      </div>
      <div className="sidebar-secondary__empty">
        <p>{description}</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <MessageSquarePlus size={48} />
      </div>
      <h2>Start a conversation</h2>
      <p>Ask anything to begin exploring your workspace</p>
    </div>
  );
}

function ConversationFeed({ entries, threadId }: { entries: ConversationEntry[]; threadId?: string }) {
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [attachmentPreview, setAttachmentPreview] = useState<UserAttachmentSummary | null>(null);

  useEffect(() => {
    const hasIncompleteThought = entries.some((entry) => entry.kind === "thought" && !entry.completed);

    if (!hasIncompleteThought) {
      return;
    }

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [entries]);

  useEffect(() => {
    setExpandedThoughts((current) => {
      let changed = false;
      const next = { ...current };

      for (const entry of entries) {
        if (entry.kind !== "thought" || entry.id in next) {
          continue;
        }

        next[entry.id] = !entry.completed;
        changed = true;
      }

      return changed ? next : current;
    });
  }, [entries]);

  return (
    <>
      <div className="conversation-feed">
        {entries.map((entry) => {
        if (entry.kind === "user") {
          const userText = getUserDisplayText(entry.item);
          const attachments = getUserAttachmentSummaries(entry.item);

          return (
            <div key={entry.id} className="conversation-entry conversation-entry--user">
              <div className={`user-bubble ${!userText && attachments.length > 0 ? "user-bubble--attachments-only" : ""}`}>
                {userText ? <pre className="user-bubble__text">{userText}</pre> : null}
                {attachments.length > 0 ? (
                  <div className="user-bubble__attachments">
                    {attachments.map((attachment) => {
                      const canPreviewImage = attachment.kind === "image" && Boolean(attachment.previewSrc);

                      if (canPreviewImage) {
                        return (
                          <button
                            key={`${entry.id}-${attachment.path ?? attachment.name}`}
                            type="button"
                            className="user-attachment-card user-attachment-card--interactive"
                            onClick={() => setAttachmentPreview(attachment)}
                            aria-label={`Preview ${attachment.name}`}
                            title={attachment.path ?? attachment.name}
                          >
                            <img
                              className="user-attachment-card__thumb"
                              src={attachment.previewSrc}
                              alt={attachment.name}
                              loading="lazy"
                            />
                            <span className="user-attachment-card__body">
                              <span className="user-attachment-card__name">{attachment.name}</span>
                              <span className="user-attachment-card__meta">
                                {formatAttachmentKindLabel(attachment.kind)}
                                {attachment.mediaType ? ` · ${attachment.mediaType}` : ""}
                                {attachment.truncated ? " · Truncated" : ""}
                              </span>
                            </span>
                          </button>
                        );
                      }

                      return (
                        <div
                          key={`${entry.id}-${attachment.path ?? attachment.name}`}
                          className="user-attachment-card"
                          title={attachment.path ?? attachment.name}
                        >
                          <span className="user-attachment-card__icon" aria-hidden="true">
                            {attachment.kind === "image" ? <ImagePlus size={14} /> : attachment.kind === "text" ? <FileText size={14} /> : <Box size={14} />}
                          </span>
                          <span className="user-attachment-card__body">
                            <span className="user-attachment-card__name">{attachment.name}</span>
                            <span className="user-attachment-card__meta">
                              {formatAttachmentKindLabel(attachment.kind)}
                              {attachment.mediaType ? ` · ${attachment.mediaType}` : ""}
                              {attachment.truncated ? " · Truncated" : ""}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        }

        if (entry.kind === "thought") {
          const expanded = expandedThoughts[entry.id] ?? !entry.completed;
          const elapsedMs = entry.completed ? entry.durationMs : Math.max(0, nowMs - entry.startedAtMs);

          return (
            <section key={entry.id} className={`thought-group ${expanded ? "thought-group--expanded" : ""}`}>
              <button
                className="thought-group__toggle"
                onClick={() =>
                  setExpandedThoughts((current) => ({
                    ...current,
                    [entry.id]: !expanded,
                  }))
                }
                aria-expanded={expanded}
              >
                <span className="thought-group__rule" />
                <span className="thought-group__summary">{`Processed ${formatElapsedTime(elapsedMs)}`}</span>
                <ChevronRight className={`thought-group__chevron ${expanded ? "thought-group__chevron--open" : ""}`} size={16} />
                <span className="thought-group__rule" />
              </button>

              {expanded && (
                <div className="thought-group__content">
                  {entry.items.map((item) => (
                    <div
                      key={item.id}
                      className={`thought-group__item ${item.kind === "reasoning" ? "" : "thought-group__item--meta"}`}
                    >
                      <pre className="thought-group__text">{formatThoughtItemText(item)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        }

        if (entry.kind === "changes") {
          return <ChangedFilesCard key={entry.id} items={entry.items} threadId={threadId} />;
        }

        if (entry.kind === "answer") {
          return (
            <section key={entry.id} className="answer-group">
              <div className="answer-group__header">
                <span className="answer-group__rule" />
                <span className="answer-group__summary">Final answer</span>
                <span className="answer-group__rule" />
              </div>
              <div className="answer-group__content">
                <pre className="answer-group__text">{getItemDisplayText(entry.item)}</pre>
              </div>
            </section>
          );
        }

        return (
          <section key={entry.id} className="system-note">
            <pre className="system-note__text">{getItemDisplayText(entry.item)}</pre>
          </section>
        );
        })}
      </div>
      <Dialog.Root open={Boolean(attachmentPreview)} onOpenChange={(open) => !open && setAttachmentPreview(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content image-preview-dialog">
            <div className="image-preview-dialog__header">
              <div className="image-preview-dialog__meta">
                <Dialog.Title className="dialog-title image-preview-dialog__title">
                  {attachmentPreview?.name ?? "Image preview"}
                </Dialog.Title>
                {attachmentPreview?.mediaType ? (
                  <Dialog.Description className="dialog-description image-preview-dialog__description">
                    {attachmentPreview.mediaType}
                  </Dialog.Description>
                ) : null}
              </div>
              <Dialog.Close className="image-preview-dialog__close" aria-label="Close image preview">
                <X size={18} />
              </Dialog.Close>
            </div>
            <div className="image-preview-dialog__viewport">
              {attachmentPreview?.previewSrc ? (
                <img
                  className="image-preview-dialog__image"
                  src={attachmentPreview.previewSrc}
                  alt={attachmentPreview.name}
                />
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ChangedFilesCard({ items, threadId }: { items: ItemRecord[]; threadId?: string }) {
  const files = useMemo(
    () =>
      items
        .map((item) => ({
          itemId: item.id,
          path: getChangedFilePath(item),
        }))
        .filter((entry): entry is { itemId: string; path: string } => Boolean(entry.path))
        .filter((entry, index, all) => all.findIndex((candidate) => candidate.path === entry.path) === index),
    [items],
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reviews, setReviews] = useState<Record<string, ChangedFileReview>>(() =>
    Object.fromEntries(files.map((file) => [file.path, { path: file.path, status: "idle" as const }])),
  );

  useEffect(() => {
    setReviews((current) => {
      const next: Record<string, ChangedFileReview> = {};

      for (const file of files) {
        next[file.path] = current[file.path] ?? { path: file.path, status: "idle" };
      }

      return next;
    });
  }, [files]);

  useEffect(() => {
    if (!threadId || files.length === 0) {
      return;
    }

    void loadChangedFileSummaries(threadId, files.map((file) => file.path))
      .then((summary) => {
        setReviews((current) => {
          const next = { ...current };

          for (const file of files) {
            next[file.path] = {
              ...next[file.path],
              path: file.path,
              additions: summary[file.path]?.additions,
              deletions: summary[file.path]?.deletions,
              status: next[file.path]?.diff ? "ready" : "idle",
            };
          }

          return next;
        });
      })
      .catch(() => undefined);
  }, [files, threadId]);

  const toggleFile = (path: string) => {
    const nextExpanded = !(expanded[path] ?? false);

    setExpanded((current) => ({
      ...current,
      [path]: nextExpanded,
    }));

    if (!nextExpanded || !threadId) {
      return;
    }

    const existing = reviews[path];

    if (existing?.status === "loading" || existing?.status === "ready") {
      return;
    }

    setReviews((current) => ({
      ...current,
      [path]: {
        ...current[path],
        path,
        status: "loading",
      },
    }));

    void loadChangedFileDiff(threadId, path)
      .then((diff) => {
        setReviews((current) => ({
          ...current,
          [path]: {
            ...current[path],
            path,
            diff,
            status: "ready",
          },
        }));
      })
      .catch((error) => {
        setReviews((current) => ({
          ...current,
          [path]: {
            ...current[path],
            path,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      });
  };

  if (files.length === 0) {
    return null;
  }

  return (
    <section className="changed-files-card">
      <div className="changed-files-card__header">
        <span className="changed-files-card__title">{files.length} changed file{files.length === 1 ? "" : "s"}</span>
      </div>

      <div className="changed-files-card__list">
        {files.map((file) => {
          const review = reviews[file.path];
          const isExpanded = expanded[file.path] ?? false;

          return (
            <div key={file.path} className={`changed-file ${isExpanded ? "changed-file--expanded" : ""}`}>
              <button className="changed-file__summary" onClick={() => toggleFile(file.path)} type="button">
                <span className="changed-file__path">{file.path}</span>
                <span className="changed-file__stats">
                  {typeof review?.additions === "number" && (
                    <span className="changed-file__stat changed-file__stat--add">+{review.additions}</span>
                  )}
                  {typeof review?.deletions === "number" && (
                    <span className="changed-file__stat changed-file__stat--del">-{review.deletions}</span>
                  )}
                </span>
                <ChevronDown className={`changed-file__chevron ${isExpanded ? "changed-file__chevron--open" : ""}`} size={16} />
              </button>

              {isExpanded && (
                <div className="changed-file__diff">
                  {review?.status === "loading" && <div className="changed-file__empty">Loading diff...</div>}
                  {review?.status === "error" && (
                    <div className="changed-file__empty">
                      {review.error ?? "Unable to read this file diff."}
                    </div>
                  )}
                  {review?.status === "ready" && review.diff ? (
                    <div className="changed-file__diff-lines">
                      {renderDiffLines(review.diff)}
                    </div>
                  ) : null}
                  {review?.status === "ready" && !review.diff && (
                    <div className="changed-file__empty">No git diff is available for this file yet.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ApprovalRequest({
  approval,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  onApprove: (scope: "once" | "session") => void;
  onReject: () => void;
}) {
  return (
    <div className="approval-request">
      <div className="approval-request__header">
        <AlertTriangle size={18} />
        <h3>Approval Required</h3>
      </div>
      <div className="approval-request__content">
        <p><strong>{approval.toolName}</strong></p>
        <p>{approval.reason}</p>
        <pre>{JSON.stringify(approval.args, null, 2)}</pre>
      </div>
      <div className="approval-request__actions">
        <button className="button button--danger" onClick={onReject}>
          <XCircle size={14} />
          Reject
        </button>
        <button className="button" onClick={() => onApprove("once")}>
          <CheckCircle size={14} />
          Approve Once
        </button>
        <button className="button button--primary" onClick={() => onApprove("session")}>
          Allow Session
        </button>
      </div>
    </div>
  );
}

function ComposerBar({
  input,
  onChange,
  onSubmit,
  onInterrupt,
  onKeyDown,
  onPaste,
  attachments,
  skills,
  onAddFiles,
  onRemoveAttachment,
  composerMenuOpen,
  onToggleComposerMenu,
  composerMenuRef,
  includeIdeContext,
  onToggleIdeContext,
  planMode,
  onTogglePlanMode,
  modelMenuOpen,
  onToggleModelMenu,
  modelMenuRef,
  availableModels,
  providerModelsLoading,
  providerModelsError,
  selectedModel,
  onSelectModel,
  reasoningMenuOpen,
  onToggleReasoningMenu,
  reasoningMenuRef,
  selectedReasoningEffort,
  onSelectReasoningEffort,
  currentSandboxMode,
  sandboxMenuOpen,
  onToggleSandboxMenu,
  sandboxMenuRef,
  onSelectSandboxMode,
  branchMenuOpen,
  onToggleBranchMenu,
  branchMenuRef,
  branchSummary,
  branchSearch,
  onBranchSearchChange,
  filteredBranches,
  onSelectBranch,
  onCreateBranch,
  contextSummary,
  loading,
  canInterrupt,
}: {
  input: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onInterrupt: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  attachments: ComposerAttachment[];
  skills: SkillDescriptor[];
  onAddFiles: () => void;
  onRemoveAttachment: (path: string) => void;
  composerMenuOpen: boolean;
  onToggleComposerMenu: () => void;
  composerMenuRef: React.RefObject<HTMLDivElement | null>;
  includeIdeContext: boolean;
  onToggleIdeContext: () => void;
  planMode: boolean;
  onTogglePlanMode: () => void;
  modelMenuOpen: boolean;
  onToggleModelMenu: () => void;
  modelMenuRef: React.RefObject<HTMLDivElement | null>;
  availableModels: ProviderModelRecord[];
  providerModelsLoading: boolean;
  providerModelsError?: string;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  reasoningMenuOpen: boolean;
  onToggleReasoningMenu: () => void;
  reasoningMenuRef: React.RefObject<HTMLDivElement | null>;
  selectedReasoningEffort: ModelReasoningEffort;
  onSelectReasoningEffort: (effort: ModelReasoningEffort) => void;
  currentSandboxMode: SandboxMode;
  sandboxMenuOpen: boolean;
  onToggleSandboxMenu: () => void;
  sandboxMenuRef: React.RefObject<HTMLDivElement | null>;
  onSelectSandboxMode: (mode: SandboxMode) => void;
  branchMenuOpen: boolean;
  onToggleBranchMenu: () => void;
  branchMenuRef: React.RefObject<HTMLDivElement | null>;
  branchSummary: BranchSummary;
  branchSearch: string;
  onBranchSearchChange: (value: string) => void;
  filteredBranches: string[];
  onSelectBranch: (branchName: string) => void;
  onCreateBranch: () => void;
  contextSummary: ContextSummary;
  loading: boolean;
  canInterrupt: boolean;
}) {
  const isSendDisabled = loading || (!input.trim() && attachments.length === 0);
  const selectedReasoning = REASONING_OPTIONS.find((option) => option.value === selectedReasoningEffort) ?? REASONING_OPTIONS[3]!;
  const [closingPill, setClosingPill] = useState<"ide" | "plan" | null>(null);
  const [caretPosition, setCaretPosition] = useState(0);
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0);
  const dismissTimersRef = useRef<Partial<Record<"ide" | "plan", number>>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerMinHeight = 56;
  const composerMaxHeight = 132;
  const skillMention = useMemo(() => detectSkillMention(input, caretPosition), [input, caretPosition]);
  const filteredSkillOptions = useMemo(() => {
    if (!skillMention) {
      return [];
    }

    const query = skillMention.query.toLowerCase();
    return skills.filter((skill) => {
      const name = skill.name.toLowerCase();
      const displayName = (skill.metadata.displayName ?? "").toLowerCase();
      return !query || name.includes(query) || displayName.includes(query);
    });
  }, [skillMention, skills]);
  const skillPickerOpen = Boolean(skillMention) && filteredSkillOptions.length > 0;

  useEffect(() => {
    return () => {
      for (const timer of Object.values(dismissTimersRef.current)) {
        if (timer) {
          window.clearTimeout(timer);
        }
      }
    };
  }, []);

  useEffect(() => {
    if ((!includeIdeContext && closingPill === "ide") || (!planMode && closingPill === "plan")) {
      setClosingPill((current) => {
        if ((current === "ide" && !includeIdeContext) || (current === "plan" && !planMode)) {
          return null;
        }

        return current;
      });
    }
  }, [closingPill, includeIdeContext, planMode]);

  useEffect(() => {
    setHighlightedSkillIndex(0);
  }, [skillMention?.query]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, composerMinHeight), composerMaxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > composerMaxHeight ? "auto" : "hidden";
  }, [composerMaxHeight, composerMinHeight, input]);

  const handleDismissPill = (kind: "ide" | "plan") => {
    if (loading || closingPill) {
      return;
    }

    setClosingPill(kind);
    dismissTimersRef.current[kind] = window.setTimeout(() => {
      if (kind === "ide") {
        onToggleIdeContext();
      } else {
        onTogglePlanMode();
      }

      setClosingPill((current) => (current === kind ? null : current));
      delete dismissTimersRef.current[kind];
    }, 140);
  };

  const insertSkillMention = (skill: SkillDescriptor) => {
    if (!skillMention) {
      return;
    }

    const nextValue = `${input.slice(0, skillMention.start)}$${skill.name} ${input.slice(skillMention.end)}`;
    const nextCaret = skillMention.start + skill.name.length + 2;

    onChange(nextValue);
    setCaretPosition(nextCaret);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleInputChange = (value: string, selectionStart: number | null) => {
    onChange(value);
    setCaretPosition(selectionStart ?? value.length);
  };

  const handleTextareaInteraction = (selectionStart: number | null) => {
    setCaretPosition(selectionStart ?? input.length);
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (skillPickerOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedSkillIndex((current) => (current + 1) % filteredSkillOptions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedSkillIndex((current) => (current - 1 + filteredSkillOptions.length) % filteredSkillOptions.length);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selectedSkill = filteredSkillOptions[highlightedSkillIndex];

        if (selectedSkill) {
          insertSkillMention(selectedSkill);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setCaretPosition(-1);
        return;
      }
    }

    onKeyDown(event);
  };

  return (
    <div className="composer-bar">
      <div className="composer-shell">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <div key={attachment.path} className="composer-attachment">
                <span className="composer-attachment__icon" aria-hidden="true">
                  {attachment.kind === "image" ? <ImagePlus size={14} /> : <FileText size={14} />}
                </span>
                <span className="composer-attachment__name" title={attachment.path}>
                  {attachment.name}
                </span>
                <button
                  className="composer-attachment__remove"
                  onClick={() => onRemoveAttachment(attachment.path)}
                  aria-label={`Remove ${attachment.name}`}
                  title={`Remove ${attachment.name}`}
                  disabled={loading}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer-main">
          {skillPickerOpen && (
            <div className="composer-skill-picker" role="listbox" aria-label="Available skills">
              {filteredSkillOptions.map((skill, index) => (
                <button
                  key={skill.id}
                  type="button"
                  className={`composer-skill-picker__item ${index === highlightedSkillIndex ? "composer-skill-picker__item--active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertSkillMention(skill);
                  }}
                >
                  <span className="composer-skill-picker__icon" aria-hidden="true">
                    <Box size={14} />
                  </span>
                  <span className="composer-skill-picker__body">
                    <strong>{skill.metadata.displayName ?? skill.name}</strong>
                    <small>{skill.metadata.shortDescription ?? skill.description}</small>
                  </span>
                  <span className="composer-skill-picker__scope">{formatSkillScopeLabel(skill.scope)}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder="Ask my-agent anything, or paste an image or file"
            value={input}
            onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart)}
            onKeyDown={handleTextareaKeyDown}
            onClick={(e) => handleTextareaInteraction(e.currentTarget.selectionStart)}
            onKeyUp={(e) => handleTextareaInteraction(e.currentTarget.selectionStart)}
            onFocus={(e) => handleTextareaInteraction(e.currentTarget.selectionStart)}
            onPaste={onPaste}
            rows={1}
            disabled={canInterrupt}
          />
          <div className="composer-toolbar">
            <div className="composer-toolbar__left">
              <div className="composer-popover-anchor" ref={composerMenuRef}>
                <button
                  className="composer-tool-button composer-tool-button--icon"
                  onClick={onToggleComposerMenu}
                  aria-label="Open composer menu"
                  title="Open composer menu"
                  disabled={loading}
                >
                  <Plus size={16} />
                </button>

                {composerMenuOpen && (
                  <div className="composer-popover composer-popover--menu">
                    <button className="composer-popover__action" onClick={onAddFiles}>
                      <span className="composer-popover__icon">
                        <ImagePlus size={16} />
                      </span>
                      <span className="composer-popover__copy">
                        <strong>Add files</strong>
                        <small>Attach local files or paste an image directly into the composer.</small>
                      </span>
                    </button>

                    <button className="composer-popover__toggle-row" onClick={onToggleIdeContext}>
                      <span className="composer-popover__icon">
                        <Cpu size={16} />
                      </span>
                      <span className="composer-popover__copy">
                        <strong>IDE context</strong>
                        <small>Include IDE context so the agent can understand the current work faster.</small>
                      </span>
                      <span className={`composer-switch ${includeIdeContext ? "composer-switch--on" : ""}`}>
                        <span className="composer-switch__thumb" />
                      </span>
                    </button>

                    <button className="composer-popover__toggle-row" onClick={onTogglePlanMode}>
                      <span className="composer-popover__icon">
                        <CheckCircle size={16} />
                      </span>
                      <span className="composer-popover__copy">
                        <strong>Plan mode</strong>
                        <small>Ask the agent to outline steps before it starts executing changes.</small>
                      </span>
                      <span className={`composer-switch ${planMode ? "composer-switch--on" : ""}`}>
                        <span className="composer-switch__thumb" />
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <div className="composer-popover-anchor" ref={modelMenuRef}>
                <button
                  className="composer-tool-button composer-tool-button--select"
                  onClick={onToggleModelMenu}
                  disabled={loading}
                >
                  <span className="composer-tool-button__label">{selectedModel || "Select model"}</span>
                  <ChevronDown size={14} />
                </button>

                {modelMenuOpen && (
                  <div className="composer-popover composer-popover--select">
                    <div className="composer-popover__header">
                      <span>Select a model</span>
                      {providerModelsLoading && <small>Loading available models...</small>}
                    </div>

                    {availableModels.length > 0 ? (
                      <div className="composer-option-list">
                        {availableModels.map((model) => (
                          <button
                            key={model.id}
                            className={`composer-option ${model.id === selectedModel ? "composer-option--active" : ""}`}
                            onClick={() => onSelectModel(model.id)}
                          >
                            <span>{model.id}</span>
                            {model.id === selectedModel && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="composer-popover__empty">
                        {providerModelsError ? providerModelsError : "No models available yet. Check your provider settings and refresh."}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="composer-popover-anchor" ref={reasoningMenuRef}>
                <button
                  className="composer-tool-button composer-tool-button--select"
                  onClick={onToggleReasoningMenu}
                  disabled={loading}
                >
                  <span className="composer-tool-button__label">{selectedReasoning.label}</span>
                  <ChevronDown size={14} />
                </button>

                {reasoningMenuOpen && (
                  <div className="composer-popover composer-popover--select">
                    <div className="composer-popover__header">
                      <span>Reasoning level</span>
                      <small>Choose how much thinking time the model should use before responding.</small>
                    </div>
                    <div className="composer-option-list">
                      {REASONING_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={`composer-option ${option.value === selectedReasoningEffort ? "composer-option--active" : ""}`}
                          onClick={() => onSelectReasoningEffort(option.value)}
                        >
                          <span className="composer-option__body">
                            <strong>{option.label}</strong>
                            <small>{option.hint}</small>
                          </span>
                          {option.value === selectedReasoningEffort && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {includeIdeContext && (
                <button
                  type="button"
                  className={`composer-pill composer-pill--dismissible ${closingPill === "ide" ? "composer-pill--closing" : ""}`}
                  onClick={() => handleDismissPill("ide")}
                  disabled={loading}
                  aria-label="Disable IDE context"
                  title="Disable IDE context"
                >
                  <span className="composer-pill__dismiss" aria-hidden="true">
                    <X size={12} />
                  </span>
                  <span>IDE context</span>
                </button>
              )}
              {planMode && (
                <button
                  type="button"
                  className={`composer-pill composer-pill--accent composer-pill--dismissible ${closingPill === "plan" ? "composer-pill--closing" : ""}`}
                  onClick={() => handleDismissPill("plan")}
                  disabled={loading}
                  aria-label="Disable plan mode"
                  title="Disable plan mode"
                >
                  <span className="composer-pill__dismiss" aria-hidden="true">
                    <X size={12} />
                  </span>
                  <span>Plan mode</span>
                </button>
              )}
            </div>

            <button
              className={`composer-bar__submit ${canInterrupt ? "composer-bar__submit--interrupt" : ""}`}
              onClick={canInterrupt ? onInterrupt : () => void onSubmit()}
              disabled={canInterrupt ? false : isSendDisabled}
              aria-label={canInterrupt ? "Interrupt run" : "Send message"}
              title={canInterrupt ? "Interrupt run" : "Send message"}
            >
              {canInterrupt ? <span className="composer-bar__stop-icon" aria-hidden="true" /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>

        <div className="composer-footer">
          <div className="composer-footer__left">
            <div className="composer-popover-anchor" ref={sandboxMenuRef}>
              <button
                type="button"
                className="composer-status-button composer-status-button--sandbox"
                onClick={onToggleSandboxMenu}
                disabled={!currentSandboxMode || loading}
              >
                <span className="composer-status-button__dot" aria-hidden="true" />
                <span>{SANDBOX_MODE_OPTIONS.find((option) => option.value === currentSandboxMode)?.label ?? currentSandboxMode}</span>
                <ChevronDown size={12} />
              </button>

              {sandboxMenuOpen && (
                <div className="composer-popover composer-popover--status">
                  <div className="composer-popover__header">
                    <span>Sandbox Mode</span>
                    <small>Applies to the current thread</small>
                  </div>
                  <div className="composer-option-list">
                    {SANDBOX_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        className={`composer-option ${option.value === currentSandboxMode ? "composer-option--active" : ""}`}
                        onClick={() => onSelectSandboxMode(option.value)}
                      >
                        <span className="composer-option__body">
                          <strong>{option.label}</strong>
                          <small>{option.hint}</small>
                        </span>
                        {option.value === currentSandboxMode && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="composer-popover-anchor" ref={branchMenuRef}>
              <button
                type="button"
                className="composer-status-button composer-status-button--branch"
                onClick={onToggleBranchMenu}
                disabled={branchSummary.loading || loading}
              >
                <GitBranch size={13} />
                <span>{branchSummary.currentBranch ?? "New branch"}</span>
                <ChevronDown size={12} />
              </button>

              {branchMenuOpen && (
                <div className="composer-popover composer-popover--branch">
                  <div className="composer-branch-search">
                    <Search size={13} />
                    <input
                      type="text"
                      value={branchSearch}
                      onChange={(event) => onBranchSearchChange(event.target.value)}
                      placeholder="Search branches"
                    />
                  </div>

                  <div className="composer-popover__header">
                    <span>Branches</span>
                    <small>{branchSummary.loading ? "Loading..." : `${branchSummary.branches.length} local branches`}</small>
                  </div>

                  {branchSummary.error ? (
                    <div className="composer-popover__empty">{branchSummary.error}</div>
                  ) : filteredBranches.length > 0 ? (
                    <div className="composer-option-list composer-option-list--branch">
                      {filteredBranches.map((branch) => (
                        <button
                          key={branch}
                          className={`composer-option ${branch === branchSummary.currentBranch ? "composer-option--active" : ""}`}
                          onClick={() => onSelectBranch(branch)}
                        >
                          <span className="composer-option__body composer-option__body--branch">
                            <strong>{branch}</strong>
                            {branch === branchSummary.currentBranch && <small>Current branch</small>}
                          </span>
                          {branch === branchSummary.currentBranch && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="composer-popover__empty">
                      {branchSummary.isGitRepo ? "No matching local branches." : "The current project is not a Git repository yet."}
                    </div>
                  )}

                  <button className="composer-branch-create" onClick={onCreateBranch}>
                    <Plus size={14} />
                    <span>Create and switch to a new branch...</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="composer-context-card">
            <button
              type="button"
              className="composer-context-card__pie"
              style={
                {
                  "--context-angle": `${Math.max(8, Math.round(contextSummary.usedRatio * 360))}deg`,
                } as CSSProperties
              }
              aria-label="Show context usage details"
              title="Show context usage details"
            />
            <div className="composer-context-card__tooltip" role="status">
              <strong>Context window</strong>
              <span>
                {Math.round(contextSummary.usedRatio * 100)}% used ({Math.round((1 - contextSummary.usedRatio) * 100)}% remaining)
              </span>
              <span>
                {formatCompactTokens(contextSummary.usedTokens)} used out of {formatCompactTokens(contextSummary.totalTokens)} total
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="app-shell app-shell--loading">
      <header className="app-toolbar" />
      <div className="app-container app-container--loading">
        <aside className="sidebar sidebar--loading" />
        <main className="main-content main-content--loading" />
      </div>
      <div className="startup-state">
        <div className="startup-state__title">Starting my-agent</div>
        <div className="startup-state__body">Loading the desktop shell and connecting to the local harness...</div>
      </div>
    </div>
  );
}

function StartupErrorShell({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="app-shell app-shell--loading">
      <header className="app-toolbar" />
      <div className="startup-state startup-state--error">
        <div className="startup-state__title">Unable to start my-agent</div>
        <div className="startup-state__body">{message}</div>
        <button type="button" className="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

function buildConversationEntries(items: ItemRecord[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  let pendingThoughtItems: ItemRecord[] = [];

  const flushThoughts = (completed: boolean): ItemRecord[] => {
    if (pendingThoughtItems.length === 0) {
      return [];
    }

    const changeItems = pendingThoughtItems.filter((item) => item.kind === "fileChange");
    const thoughtItems = pendingThoughtItems.filter((item) => item.kind !== "fileChange");

    if (thoughtItems.length > 0) {
      const first = thoughtItems[0]!;
      const last = thoughtItems[thoughtItems.length - 1]!;

      entries.push({
        id: `thought-${first.id}`,
        kind: "thought",
        items: thoughtItems,
        completed,
        durationMs: Math.max(0, new Date(last.updatedAt).getTime() - new Date(first.createdAt).getTime()),
        startedAtMs: new Date(first.createdAt).getTime(),
      });
    }

    pendingThoughtItems = [];
    return changeItems;
  };

  for (const item of items) {
    if (item.kind === "userMessage") {
      const pendingChanges = flushThoughts(true);

      if (pendingChanges.length > 0) {
        entries.push({
          id: `changes-${pendingChanges[0]!.id}`,
          kind: "changes",
          items: pendingChanges,
        });
      }

      entries.push({ id: item.id, kind: "user", item });
      continue;
    }

    if (THOUGHT_ITEM_KINDS.includes(item.kind) || item.kind === "fileChange") {
      pendingThoughtItems.push(item);
      continue;
    }

    if (item.kind === "agentMessage") {
      const pendingChanges = flushThoughts(true);
      entries.push({ id: item.id, kind: "answer", item });

      if (pendingChanges.length > 0) {
        entries.push({
          id: `changes-${item.id}`,
          kind: "changes",
          items: pendingChanges,
        });
      }

      continue;
    }

    const pendingChanges = flushThoughts(true);

    if (pendingChanges.length > 0) {
      entries.push({
        id: `changes-${pendingChanges[0]!.id}`,
        kind: "changes",
        items: pendingChanges,
      });
    }

    entries.push({ id: item.id, kind: "system", item });
  }

  const trailingChanges = flushThoughts(false);

  if (trailingChanges.length > 0) {
    entries.push({
      id: `changes-${trailingChanges[0]!.id}`,
      kind: "changes",
      items: trailingChanges,
    });
  }

  return entries;
}

function getItemDisplayText(item: ItemRecord) {
  return [item.title, item.body].filter(Boolean).join("\n\n");
}

function getUserDisplayText(item: ItemRecord) {
  return item.body?.trim() || item.title?.trim() || "";
}

function getUserAttachmentSummaries(item: ItemRecord): UserAttachmentSummary[] {
  const rawAttachments = item.metadata?.attachments;

  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  return rawAttachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return [];
    }

    const record = attachment as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    const kind = record.kind;

    if (!name || (kind !== "image" && kind !== "text" && kind !== "binary")) {
      return [];
    }

    return [
      {
        name,
        kind,
        path: typeof record.path === "string" ? record.path : undefined,
        mediaType: typeof record.mediaType === "string" ? record.mediaType : undefined,
        truncated: record.truncated === true,
        previewSrc: resolveAttachmentPreviewSrc(
          kind,
          typeof record.path === "string" ? record.path : undefined,
          typeof record.imageDataUrl === "string" ? record.imageDataUrl : undefined,
        ),
      },
    ];
  });
}

function resolveAttachmentPreviewSrc(
  kind: "image" | "text" | "binary",
  path?: string,
  imageDataUrl?: string,
) {
  if (kind !== "image") {
    return undefined;
  }

  if (imageDataUrl) {
    return imageDataUrl;
  }

  if (!path || path.startsWith("clipboard://")) {
    return undefined;
  }

  return toFileUrl(path);
}

function toFileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/");

  if (/^[a-zA-Z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }

  if (normalized.startsWith("//")) {
    return encodeURI(`file:${normalized}`);
  }

  return encodeURI(`file://${normalized}`);
}

function formatAttachmentKindLabel(kind: "image" | "text" | "binary") {
  switch (kind) {
    case "image":
      return "Image";
    case "text":
      return "Text file";
    case "binary":
      return "File";
    default:
      return "Attachment";
  }
}

function formatThoughtItemText(item: ItemRecord) {
  const content = getItemDisplayText(item);

  if (item.kind === "reasoning") {
    return content;
  }

  return `${ITEM_LABELS[item.kind]}: ${content}`;
}

function formatElapsedTime(durationMs: number) {
  const totalSeconds = Math.max(1, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function detectSkillMention(input: string, caretPosition: number) {
  if (caretPosition < 0) {
    return null;
  }

  const beforeCaret = input.slice(0, caretPosition);
  const match = beforeCaret.match(/(?:^|\s)\$([^\s$]*)$/);

  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index + match[0].lastIndexOf("$");

  return {
    query: match[1] ?? "",
    start,
    end: caretPosition,
  };
}

function formatSkillScopeLabel(scope: SkillDescriptor["scope"]) {
  switch (scope) {
    case "SYSTEM":
      return "绯荤粺";
    case "USER":
      return "鐢ㄦ埛";
    case "REPO":
      return "浠撳簱";
    case "ADMIN":
      return "绠＄悊";
    default:
      return scope;
  }
}

function formatRelativeTime(value: string) {
  const target = new Date(value).getTime();
  const deltaMs = Date.now() - target;
  const deltaMinutes = Math.max(0, Math.floor(deltaMs / 60000));

  if (deltaMinutes < 1) {
    return "now";
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);

  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }

  const deltaDays = Math.floor(deltaHours / 24);

  if (deltaDays < 7) {
    return `${deltaDays}d`;
  }

  const deltaWeeks = Math.floor(deltaDays / 7);

  if (deltaWeeks < 5) {
    return `${deltaWeeks}w`;
  }

  const deltaMonths = Math.floor(deltaDays / 30);

  if (deltaMonths < 12) {
    return `${Math.max(1, deltaMonths)}mo`;
  }

  return `${Math.floor(deltaDays / 365)}y`;
}

function getComposerDraft(drafts: Record<string, ComposerDraftState>, threadId?: string | null): ComposerDraftState {
  return drafts[threadId ?? "__draft__"] ?? createDefaultComposerDraft();
}

function createDefaultComposerDraft(): ComposerDraftState {
  return {
    input: "",
    attachments: [],
    includeIdeContext: true,
    planMode: false,
  };
}

function createEmptyThreadSessionView() {
  return {
    turns: [] as TurnRecord[],
    items: [] as ItemRecord[],
    pendingApproval: null as PendingApproval | null,
    submitting: false,
  };
}

function estimateContextUsage(params: {
  modelId?: string;
  items: ItemRecord[];
  turns: TurnRecord[];
  input: string;
  attachments: ComposerAttachment[];
}): ContextSummary {
  const totalTokens = inferContextLimit(params.modelId);
  const itemTokens = params.items.reduce((sum, item) => sum + estimateTokenCount([item.title, item.body, JSON.stringify(item.metadata ?? {})].join(" ")), 0);
  const turnTokens = params.turns.reduce((sum, turn) => sum + estimateTokenCount(turn.input), 0);
  const attachmentTokens = params.attachments.reduce(
    (sum, attachment) => sum + estimateTokenCount([attachment.name, attachment.path, attachment.mediaType ?? ""].join(" ")),
    0,
  );
  const draftTokens = estimateTokenCount(params.input);
  const usedTokens = Math.max(0, itemTokens + turnTokens + attachmentTokens + draftTokens);
  const remainingTokens = Math.max(totalTokens - usedTokens, 0);
  const usedRatio = totalTokens > 0 ? Math.min(usedTokens / totalTokens, 1) : 0;

  return {
    usedTokens,
    totalTokens,
    remainingTokens,
    usedRatio,
  };
}

function inferContextLimit(modelId?: string) {
  const value = modelId?.toLowerCase() ?? "";

  if (!value) {
    return 950_000;
  }

  if (value.includes("mini") || value.includes("haiku") || value.includes("flash")) {
    return 200_000;
  }

  if (value.includes("32k")) {
    return 32_000;
  }

  if (value.includes("128k")) {
    return 128_000;
  }

  return 950_000;
}

function estimateTokenCount(content: string) {
  const normalized = content.trim();

  if (!normalized) {
    return 0;
  }

  return Math.ceil(normalized.length / 4);
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return `${value}`;
}

function buildComposerInput(params: {
  message: string;
  planMode: boolean;
}) {
  const sections: string[] = [];

  if (params.planMode) {
    sections.push(
      [
        "[Plan mode]",
        "Plan mode is enabled for this turn.",
        "Do not make changes yet unless I explicitly ask you to execute after the plan.",
        "First provide a concise implementation plan, key risks, and the smallest safe next step.",
      ].join("\n"),
    );
  }

  if (params.message) {
    sections.push(params.message);
  }

  return sections.join("\n\n");
}

function getChangedFilePath(item: ItemRecord): string | null {
  const metadataPath = typeof item.metadata?.path === "string" ? item.metadata.path : null;

  if (metadataPath) {
    return metadataPath;
  }

  const match = item.title.match(/^File change:\s+(.+)$/);
  return match?.[1] ?? null;
}

async function loadChangedFileSummaries(
  threadId: string,
  paths: string[],
): Promise<Record<string, { additions?: number; deletions?: number }>> {
  if (paths.length === 0) {
    return {};
  }

  const command = `git -c core.quotepath=false diff --numstat --no-ext-diff -- ${paths.map(quoteGitPath).join(" ")}`;
  const result = await window.myAgent.execCommand({ threadId, command });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  if (result.code !== 0 && !output) {
    throw new Error(`git diff summary failed with exit code ${result.code}.`);
  }

  return parseNumstatOutput(result.stdout);
}

async function loadChangedFileDiff(threadId: string, path: string): Promise<string> {
  const command = `git -c core.quotepath=false diff --no-ext-diff --unified=3 -- ${quoteGitPath(path)}`;
  const result = await window.myAgent.execCommand({ threadId, command });

  if (result.code !== 0 && !result.stdout.trim()) {
    const message = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(message || `git diff failed with exit code ${result.code}.`);
  }

  return stripUnifiedDiffPreamble(result.stdout);
}

function parseNumstatOutput(output: string): Record<string, { additions?: number; deletions?: number }> {
  const summary: Record<string, { additions?: number; deletions?: number }> = {};

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const [additions, deletions, ...rest] = rawLine.split("\t");
    const path = rest.join("\t").trim();

    if (!path) {
      continue;
    }

    summary[path] = {
      additions: parseNumstatValue(additions),
      deletions: parseNumstatValue(deletions),
    };
  }

  return summary;
}

function parseNumstatValue(value: string | undefined): number | undefined {
  if (!value || value === "-") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripUnifiedDiffPreamble(diff: string): string {
  return diff
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("diff --git ") && !line.startsWith("index "))
    .join("\n")
    .trim();
}

function renderDiffLines(diff: string) {
  return diff.split(/\r?\n/).map((line, index) => {
    let className = "changed-file__diff-line";

    if (line.startsWith("@@")) {
      className += " changed-file__diff-line--hunk";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className += " changed-file__diff-line--add";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className += " changed-file__diff-line--del";
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      className += " changed-file__diff-line--file";
    }

    return (
      <div key={`${index}:${line}`} className={className}>
        <span className="changed-file__diff-gutter">{index + 1}</span>
        <code>{line || " "}</code>
      </div>
    );
  });
}

function quoteGitPath(path: string): string {
  return `"${path.replace(/(["`$\\])/g, "`$1")}"`;
}

function mergeComposerAttachments(
  current: ComposerAttachment[],
  incoming: ComposerAttachment[],
): ComposerAttachment[] {
  const next = new Map(current.map((attachment) => [attachment.path, attachment]));

  for (const attachment of incoming) {
    next.set(attachment.path, attachment);
  }

  return [...next.values()];
}

async function createPastedImageAttachment(file: File, index: number): Promise<ComposerAttachment> {
  const timestamp = Date.now();
  const extension = inferImageExtension(file.type);
  const name = `pasted-image-${timestamp}-${index + 1}.${extension}`;

  return {
    path: `clipboard://${name}`,
    name,
    kind: "image",
    mediaType: file.type || `image/${extension}`,
    sizeBytes: file.size,
    imageDataUrl: await readFileAsDataUrl(file),
  };
}

function inferImageExtension(mediaType: string): string {
  if (!mediaType.startsWith("image/")) {
    return "png";
  }

  const subtype = mediaType.slice("image/".length).toLowerCase();

  if (!subtype || subtype.includes("svg")) {
    return "png";
  }

  return subtype.replace(/[^a-z0-9]+/g, "-");
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolvePromise(reader.result);
        return;
      }

      rejectPromise(new Error("Failed to read pasted image."));
    };

    reader.onerror = () => {
      rejectPromise(reader.error ?? new Error("Failed to read pasted image."));
    };

    reader.readAsDataURL(file);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isImagePath(path: string) {
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(path);
}
