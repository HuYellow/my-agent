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
  type PendingApproval,
  type ProjectRecord,
  type ProviderModelRecord,
  type SandboxMode,
  type SkillDescriptor,
  type TurnInputAttachment,
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
  { value: "read-only", label: "只读", hint: "仅允许读取项目内容" },
  { value: "workspace-write", label: "工作区写入", hint: "允许在项目内修改文件" },
  { value: "danger-full-access", label: "完全访问权限", hint: "允许不受限访问与网络操作" },
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

const EMPTY_PROMPTS = [
  {
    label: "Read the structure",
    prompt:
      "Read this repository carefully and tell me what problem it is truly trying to solve, plus the most disciplined part of the architecture.",
  },
  {
    label: "Break the habit",
    prompt:
      "Point out one habit this project needs to break next, from both the product and engineering perspectives, and give me a concrete next step.",
  },
  {
    label: "Name the next act",
    prompt:
      "Based on the current code, sketch an ambitious but still shippable next milestone for this project.",
  },
];

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
  | { id: string; kind: "thought"; items: ItemRecord[]; completed: boolean; durationMs: number }
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

export function App() {
  const {
    bootstrapped,
    loading,
    projects,
    threads,
    turns,
    items,
    skills,
    activeProjectId,
    activeThreadId,
    pendingApproval,
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
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [includeIdeContext, setIncludeIdeContext] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const [skillDetailId, setSkillDetailId] = useState<string | null>(null);
  const [skillDocument, setSkillDocument] = useState("");
  const [skillDocumentLoading, setSkillDocumentLoading] = useState(false);
  const [skillDocumentError, setSkillDocumentError] = useState<string | null>(null);
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
  const sidebarResizeStateRef = useRef<{ pointerId: number; startX: number; startRatio: number } | null>(null);

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
    // hiddenInset 闂傚倸鍊风粈渚€骞栭銈囩煋闁圭虎鍠栨惔濠囨煠绾板崬澧い顐ｆ礋閺屽秹鍩℃担鍛婃濡炪倖娲濇ご鎼佸箞閵娿儙鐔煎传閸曨剚鐦ｆ繝鐢靛仜閻楀懘宕￠幎钘夎摕婵炴垯鍨瑰Λ姗€鎮归崶銊ョ祷妞ゎ偄娲娲焻閻愯尪瀚板褜鍣ｉ弻娑欑節閸屾稑浠撮悗瑙勬磸閸ㄨ姤淇婇懜闈涚窞閻庯綆鍋呴悵顐︽⒑鐠囪尙绠抽柛瀣枛瀹曟垿骞樼紒妯绘闂侀潧顦弲婊堝煕閹烘鐓曢柕澶樺灣閸掓澘霉濠婂牏鐣烘慨濠囩細閵囨劙骞掗幘鎾暘婵＄偑鍊栭崹鐢稿箠韫囨稑绠為柕濞炬櫅閻撴盯鏌涢幇銊︽珔妞ゅ孩鐩娲川婵犲啫鐦烽梺鍛婁緱閸犳岸鍩€椤掑寮慨濠冩そ瀹曨偊宕熼澶堝灪缁绘稑顔忛鐓庣睄闂侀潧妫楅崐鍦矉閹烘柡鍋撻敐搴濈盎闁哥偑鍔戝Λ鍛搭敃閵忊剝鎮欐俊銈囧У閹倿骞嗘担鍓茬叆闁割偆鍠撻崣?    // void window.myAgent.setTitleBarTheme("dark");
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
  const orderedItems = useMemo(
    () => [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [items],
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
    () => [...turns].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1),
    [turns],
  );
  const interruptibleTurnId = useMemo(() => {
    const candidate = [...turns]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .reverse()
      .find((turn) => turn.status === "running");

    return candidate?.id;
  }, [turns]);
  const canInterrupt = loading && Boolean(interruptibleTurnId);
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
  const contextSummary = useMemo(
    () =>
      estimateContextUsage({
        modelId: config?.provider.model,
        items: orderedItems,
        turns,
        input,
        attachments,
      }),
    [attachments, config?.provider.model, input, orderedItems, turns],
  );

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

    setAttachments((current) => mergeComposerAttachments(current, pickedFiles));
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

    const branchName = window.prompt("新建分支名称", "");

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
      attachments,
      includeIdeContext,
      planMode,
      project: activeProject,
      thread: activeThread,
      enabledSkills,
      config,
    });

    setInput("");
    setAttachments([]);
    setComposerMenuOpen(false);
    await sendTurn(composedMessage, [], attachments);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (loading) {
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

    setAttachments((current) => mergeComposerAttachments(current, pastedAttachments));
  };

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
      {/* 闂備浇顕ф鍝ョ礊婵犲偆鐒介柤濮愬€楃壕鑺ユ叏濡寧纭鹃柣銈夌畺閺屻倗绮欑捄銊ょ驳缂傚倸绉村ú顓㈠箖瀹勬壋鏋庨煫鍥ㄦ惄娴尖偓闂備胶纭堕弲娑⑺囬悽绋胯摕闁靛鍎Σ鍫熺箾閸℃ê鐏╅柛娆愮箘缁辨挻鎷呴獮澶告勃闂佺厧鐤囬崺鏍矉閹烘鏅濋柛灞炬皑閿涙粌鈹戦悩璇у伐闁瑰啿绻掓禍绋库攽鐎ｎ偀鎷?*/}
      <aside className="sidebar">
        {/* 缂傚倸鍊搁崐鐑芥倿閿曞倶鈧啳绠涘☉妯碱槯濠电偞鍨跺銊╁础濮樿埖鍊甸柣銏犳啞濞呮粍绻涘畝濠侀偗闁哄本绋戦悾婵堚偓锝庝憾濞差厾绱撴担鐟板妞ゃ劌锕璇测槈閵忕姷鐫勯梺绋挎湰绾板秹鎮橀崱娑欌拺缂佸娉曠粻鏌ユ煏閸垽鍏榖 */}
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

        {/* 缂傚倸鍊搁崐鐑芥倿閿曞倶鈧啳绠涘☉妯碱槯濠电偞鍨舵穱鐑樻叏閹惰姤鐓冮柛婵嗗閺嗘洘绻涘畝濠侀偗闁哄本绋戦悾婵堚偓锝庝憾濞差厾绱撴担鐟板闁靛棗绐巓ject闂備浇顕у锕傦綖婢舵劕绠栭柛顐ｆ礀绾惧潡鏌熷▓鍨灓缂佲偓婵犲洦鐓涢柛鎰╁妿婢ф盯鏌?*/}
        <div className="sidebar__section sidebar__section--projects">
          <ThreadsPanel
            projects={projects}
            activeProjectId={activeProjectId}
            threads={orderedThreads}
            activeThreadId={activeThreadId}
            workingThreadId={canInterrupt ? activeThreadId : undefined}
            search={threadSearch}
            onSearchChange={setThreadSearch}
            onSelectThread={handleSelectThread}
            onCreateThread={handleCreateThread}
            onCreateProject={handleCreateProject}
            onRevealProject={(projectPath) => window.myAgent.revealProjectPath(projectPath).catch(() => null)}
          />
        </div>

        {/* 缂傚倸鍊搁崐鐑芥倿閿曞倶鈧啳绠涘☉妯碱槯濠电偞鍨跺銊х不閺傛５褰掓晲閸喆鈧啯绻涘畝濠侀偗闁哄本绋戦悾婵堚偓锝庝憾濞差厾绱撴担鐟板妞ゃ劌锕獮鍐喆閸曨剙顎撶紓浣割儏缁ㄩ亶骞愰崘顔解拺?*/}
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

      {/* 濠电姷鏁搁崑鐐哄垂閸洖绠插〒姘ｅ亾妞ゃ垺淇洪ˇ鍦偓瑙勬处閸撴盯鍩€椤掑倹鏆╃痪顓炵埣瀹曟垿骞樼拠鍙夊祶濡炪倖鎸鹃崰搴♀枔瀹€鍕厽?*/}
      <main className="main-content">
        {activeView === "threads" ? (
          <>
            {/* 濠电姷顣槐鏇㈠磻閹达箑纾归柡鍥ュ灪閸嬪鈹戦崒婊庣劸缁炬儳娼￠弻鐔虹磼閵忕姵鐏堥梺鍛婂姀閸嬫捇姊绘担瑙勫仩闁稿孩妞藉畷婊堟晝閸屾碍杈堝銈嗙墱閸嬬偤鎮?*/}
            <header className="main-header">
              <div className="main-header__title">
                <h1>{activeThread?.title ?? "New Thread"}</h1>
                <span className="main-header__project">{activeProject?.name ?? "Current Project"}</span>
                <span className="main-header__meta-dot" aria-hidden="true">•••</span>
              </div>
            </header>

            {/* 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柣銏犳啞閸嬪鈹戦悩鎻掓殭妞ゆ洟浜堕弻娑樷槈濞嗘劗绋囩紓浣插亾闁糕剝眉缁诲棝鏌曢崼婵囧櫣妞ゅ繈鍎甸弻?*/}
            <div className="message-area">
              {orderedItems.length === 0 ? (
                <EmptyState onStartConversation={() => {
                  const el = document.querySelector<HTMLTextAreaElement>(".composer-input");
                  el?.focus();
                }} />
              ) : (
                <ConversationFeed entries={conversationEntries} threadId={activeThreadId} />
              )}

              {/* 闂傚倷娴囬褎顨ラ幖浣稿偍婵犲﹤鐗嗙粈鍫熺節闂堟稒宸濋柣婵嗙埣閺岀喖鎮滃Ο鐑╂嫻闁诲孩纰嶅畝绋款潖濞差亜鍨傛い鏇炴噹閸撳啿鈹戦悩顐壕?*/}
              {pendingApproval && (
                <ApprovalRequest
                  approval={pendingApproval}
                  onApprove={(scope) => void respondApproval(pendingApproval.id, "approve", scope)}
                  onReject={() => void respondApproval(pendingApproval.id, "reject")}
                />
              )}
            </div>

            {/* 闂傚倷绀佸﹢閬嶅储瑜旈幃娲Ω閵夊啯妞介幃銏ゆ偂鎼达綇绱甸梺璇插缁嬫帟鎽紓鍌氱Т濞差參寮婚悢鐓庣畾鐟滃秹寮虫潏鈹惧亾濞堝灝鏋熷┑鐐诧躬瀵?*/}
            <ComposerBar
              input={input}
              onChange={setInput}
              onSubmit={submitTurn}
              onInterrupt={() => interruptibleTurnId && void interruptTurn(interruptibleTurnId)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              attachments={attachments}
              skills={enabledSkills}
              onAddFiles={() => void handlePickFiles()}
              onRemoveAttachment={(path) =>
                setAttachments((current) => current.filter((attachment) => attachment.path !== path))
              }
              composerMenuOpen={composerMenuOpen}
              onToggleComposerMenu={() => {
                setComposerMenuOpen((current) => !current);
                setModelMenuOpen(false);
                setReasoningMenuOpen(false);
              }}
              composerMenuRef={composerMenuRef}
              includeIdeContext={includeIdeContext}
              onToggleIdeContext={() => setIncludeIdeContext((current) => !current)}
              planMode={planMode}
              onTogglePlanMode={() => setPlanMode((current) => !current)}
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
              loading={loading}
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
          <PlaceholderPanel title="Plugins" description="Plugin management coming soon." />
        ) : activeView === "automation" ? (
          <PlaceholderPanel title="Automation" description="Automation workflows coming soon." />
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

      {/* 闂傚倸鍊烽懗鍫曞箠閹剧粯鍊堕柛顐犲劚绾惧鏌熼崜褏甯涢柣鎾跺█閺屾盯骞囬鐘仦闂佺顑嗛幑鍥箖閵堝棙濯撮柛娑橈功閺夊綊姊婚崒娆愮グ妞ゆ洘鐗犲畷瑙勫閺夋垹鐤囬柟鍏兼儗閻撳牓寮€ｎ偁浜滈柡鍐ㄥ€告禍楣冩倵濮橆厾顣茬紒缁樼箞濡啫鈽夊▎鎴欏亹闂備浇銆€閸?*/}
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
                          : Promise.resolve(null)
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
  workingThreadId,
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
  workingThreadId?: string;
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
    if (search.trim()) {
      setSearchExpanded(true);
    }
  }, [search]);

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

  return (
    <div className="sidebar-secondary__content thread-sidebar">
      <div className="thread-sidebar__header">
        <div className="thread-sidebar__title-row">
          <span className="thread-sidebar__title">Projects</span>
          <div className="thread-sidebar__actions">
            <button
              className={`thread-sidebar__action ${searchExpanded ? "thread-sidebar__action--active" : ""}`}
              onClick={() => {
                if (searchExpanded && !search.trim()) {
                  setSearchExpanded(false);
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
              onBlur={() => {
                if (!search.trim()) {
                  setSearchExpanded(false);
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
                                {thread.id === workingThreadId && <span className="thread-item__spinner" aria-hidden="true" />}
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

function SettingsPanel({
  project,
  providerForm,
  setProviderForm,
  providerTestMessage,
  providerModels,
  providerModelsLoading,
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

function EmptyState({ onStartConversation }: { onStartConversation: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <MessageSquarePlus size={48} />
      </div>
      <h2>Start a conversation</h2>
      <p>Ask anything to begin exploring your workspace</p>
      <div className="empty-state__prompts">
        {EMPTY_PROMPTS.map((entry) => (
          <button key={entry.label} className="prompt-card" onClick={onStartConversation}>
            <span>{entry.label}</span>
            <small>{entry.prompt}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversationFeed({ entries, threadId }: { entries: ConversationEntry[]; threadId?: string }) {
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

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
    <div className="conversation-feed">
      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <div key={entry.id} className="conversation-entry conversation-entry--user">
              <div className="user-bubble">
                <pre className="user-bubble__text">{getUserDisplayText(entry.item)}</pre>
              </div>
            </div>
          );
        }

        if (entry.kind === "thought") {
          const expanded = expandedThoughts[entry.id] ?? !entry.completed;

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
                <span className="thought-group__summary">
                  {entry.completed ? `Processed ${formatElapsedTime(entry.durationMs)}` : "Thinking"}
                </span>
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
                    <small>按当前 thread 生效</small>
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
                <span>{branchSummary.currentBranch ?? "新建分支"}</span>
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
                      placeholder="搜索分支"
                    />
                  </div>

                  <div className="composer-popover__header">
                    <span>分支</span>
                    <small>{branchSummary.loading ? "读取中..." : `${branchSummary.branches.length} 个本地分支`}</small>
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
                            {branch === branchSummary.currentBranch && <small>当前分支</small>}
                          </span>
                          {branch === branchSummary.currentBranch && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="composer-popover__empty">
                      {branchSummary.isGitRepo ? "没有匹配的本地分支。" : "当前项目还不是一个 Git 仓库。"}
                    </div>
                  )}

                  <button className="composer-branch-create" onClick={onCreateBranch}>
                    <Plus size={14} />
                    <span>创建并检出新分支...</span>
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
              aria-label="显示上下文使用详情"
              title="显示上下文使用详情"
            />
            <div className="composer-context-card__tooltip" role="status">
              <strong>背景信息窗口</strong>
              <span>{Math.round(contextSummary.usedRatio * 100)}% 已用（剩余 {Math.round((1 - contextSummary.usedRatio) * 100)}%）</span>
              <span>
                已用 {formatCompactTokens(contextSummary.usedTokens)} 标记，共 {formatCompactTokens(contextSummary.totalTokens)}
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

function formatThoughtItemText(item: ItemRecord) {
  const content = getItemDisplayText(item);

  if (item.kind === "reasoning") {
    return content;
  }

  return `${ITEM_LABELS[item.kind]}: ${content}`;
}

function formatElapsedTime(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
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
      return "系统";
    case "USER":
      return "用户";
    case "REPO":
      return "仓库";
    case "ADMIN":
      return "管理";
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
  attachments: ComposerAttachment[];
  includeIdeContext: boolean;
  planMode: boolean;
  project?: ProjectRecord;
  thread?: import("@my-agent/protocol").ThreadRecord;
  enabledSkills: SkillDescriptor[];
  config?: import("@my-agent/protocol").AppConfig;
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

  if (params.attachments.length > 0) {
    sections.push(
      [
        "[Attached files]",
        ...params.attachments.map((attachment) => `- ${attachment.name} (${attachment.kind}): ${attachment.path}`),
      ].join("\n"),
    );
  }

  if (params.includeIdeContext) {
    sections.push(
      [
        "[IDE context]",
        `Project: ${params.project?.name ?? "Unknown"}`,
        `Workspace root: ${params.project?.rootPath ?? params.config?.workspace.rootPath ?? "Unknown"}`,
        `Thread: ${params.thread?.title ?? "New Thread"}`,
        `Model: ${params.config?.provider.model ?? "Not selected"}`,
        `Reasoning effort: ${params.config?.provider.reasoningEffort ?? "high"}`,
        `Enabled skills: ${params.enabledSkills.length > 0 ? params.enabledSkills.map((skill) => skill.metadata.displayName ?? skill.name).join(", ") : "None"}`,
      ].join("\n"),
    );
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
