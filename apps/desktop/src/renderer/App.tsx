import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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

const REASONING_OPTIONS: Array<{ value: ModelReasoningEffort; label: string; hint: string }> = [
  { value: "minimal", label: "极低", hint: "更快，更省 token" },
  { value: "low", label: "低", hint: "轻量分析" },
  { value: "medium", label: "中", hint: "平衡速度和深度" },
  { value: "high", label: "高", hint: "适合复杂任务" },
  { value: "xhigh", label: "极高", hint: "最强推理，最慢" },
];

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
  | { id: string; kind: "system"; item: ItemRecord };

const THOUGHT_ITEM_KINDS: ItemKind[] = [
  "reasoning",
  "toolCall",
  "toolResult",
  "commandExecution",
  "fileChange",
];

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
  const [includeIdeContext, setIncludeIdeContext] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const [skillDetail, setSkillDetail] = useState<SkillDescriptor | null>(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    // hiddenInset 样式会自动适配，无需手动设置标题栏主题
    // void window.myAgent.setTitleBarTheme("dark");
  }, []);

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
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
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

  const handleCreateThread = async () => {
    await createThread(undefined, activeProjectId);
    setActiveView("threads");
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
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}>
      <header className="app-toolbar">
        <div className="app-toolbar__menus">
          <button
            className="app-toolbar__brand"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <div className="app-toolbar__logo" aria-hidden="true">
              <span className="app-toolbar__logo-core" />
            </div>
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
      <div className="app-container">
      {/* 左侧边栏：三层结构 */}
      <aside className="sidebar">
        {/* 第一层：功能Tab */}
        <div className="sidebar__section sidebar__section--tabs">
          <nav className="sidebar__nav">
            <NavButton
              icon={<MessageSquarePlus size={18} />}
              label="New Thread"
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

        {/* 第二层：Project工作区 */}
        <div className="sidebar__section sidebar__section--projects">
          <ThreadsPanel
            projects={projects}
            activeProjectId={activeProjectId}
            threads={orderedThreads}
            activeThreadId={activeThreadId}
            search={threadSearch}
            onSearchChange={setThreadSearch}
            onSelectThread={handleSelectThread}
            onCreateProject={handleCreateProject}
            onCreateThread={handleCreateThread}
          />
        </div>

        {/* 第三层：设置 */}
        <div className="sidebar__section sidebar__section--footer">
          <NavButton
            icon={<Settings size={18} />}
            label="Settings"
            active={activeView === "settings"}
            onClick={() => setActiveView("settings")}
          />
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="main-content">
        {activeView === "threads" ? (
          <>
            {/* 顶部标题栏 */}
            <header className="main-header">
              <div className="main-header__title">
                <h1>{activeThread?.title ?? "New Thread"}</h1>
                {loading && <span className="main-header__status loading">Working...</span>}
                {pendingApproval && <span className="main-header__status pending">Approval Required</span>}
                {!loading && !pendingApproval && activeTurn?.status === "completed" && (
                  <span className="main-header__status completed">Completed</span>
                )}
              </div>
            </header>

            {/* 消息列表 */}
            <div className="message-area">
              {orderedItems.length === 0 ? (
                <EmptyState onStartConversation={() => {
                  const el = document.querySelector<HTMLTextAreaElement>(".composer-input");
                  el?.focus();
                }} />
              ) : (
                <ConversationFeed entries={conversationEntries} />
              )}

              {/* 审批请求 */}
              {pendingApproval && (
                <ApprovalRequest
                  approval={pendingApproval}
                  onApprove={(scope) => void respondApproval(pendingApproval.id, "approve", scope)}
                  onReject={() => void respondApproval(pendingApproval.id, "reject")}
                />
              )}
            </div>

            {/* 底部输入框 */}
            <ComposerBar
              input={input}
              onChange={setInput}
              onSubmit={submitTurn}
              onInterrupt={() => interruptibleTurnId && void interruptTurn(interruptibleTurnId)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              attachments={attachments}
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
              loading={loading}
              canInterrupt={canInterrupt}
            />
          </>
        ) : activeView === "skills" ? (
          <SkillsPanel
            skills={skills}
            enabledSkills={enabledSkills}
            onToggleSkill={toggleSkill}
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

      {/* 技能详情对话框 */}
      <Dialog.Root open={Boolean(skillDetail)} onOpenChange={(open) => !open && setSkillDetail(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <div className="dialog-content__header">
              <div>
                <Dialog.Title className="dialog-title">{skillDetail?.metadata.displayName ?? skillDetail?.name}</Dialog.Title>
                <Dialog.Description className="dialog-description">{skillDetail?.description}</Dialog.Description>
              </div>
              <Dialog.Close className="button button--ghost">Close</Dialog.Close>
            </div>

            <div className="dialog-grid">
              <div className="dialog-stat">
                <span>Scope</span>
                <strong>{skillDetail?.scope}</strong>
              </div>
              <div className="dialog-stat">
                <span>Invocation</span>
                <strong>{skillDetail?.metadata.allowImplicitInvocation ? "Implicit allowed" : "Explicit only"}</strong>
              </div>
            </div>

            <div className="dialog-detail">
              <span>Path</span>
              <code>{skillDetail?.path}</code>
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
  search,
  onSearchChange,
  onSelectThread,
  onCreateProject,
  onCreateThread,
}: {
  projects: ProjectRecord[];
  activeProjectId?: string;
  threads: import("@my-agent/protocol").ThreadRecord[];
  activeThreadId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onCreateProject: () => Promise<void>;
  onCreateThread: () => Promise<void>;
}) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    activeProjectId ? [activeProjectId] : projects[0] ? [projects[0].id] : [],
  );

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
          <span className="thread-sidebar__title">Threads</span>
          <div className="thread-sidebar__actions">
            <button
              className="thread-sidebar__action"
              onClick={() => void onCreateThread()}
              aria-label="Create thread"
              title="Create thread"
            >
              <MessageSquarePlus size={14} />
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
        <div className="thread-sidebar__search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search threads"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="thread-sidebar__list">
        {projects.length > 0 ? (
          <div className="project-tree">
            {projectGroups.map(({ project: entry, totalCount, visibleThreads }) => {
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
                      <div className="project-item__count">
                        {searchTerm && visibleThreads.length !== totalCount ? `${visibleThreads.length}/${totalCount}` : totalCount}
                      </div>
                    </button>
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
                              <div className="thread-item__title">{thread.title}</div>
                              <div className="thread-item__age">{formatRelativeTime(thread.updatedAt)}</div>
                            </div>
                            {thread.id === activeThreadId && <div className="thread-item__indicator" />}
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
            <p>No threads yet</p>
            <span>Create a project or start a new thread</span>
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
}: {
  skills: SkillDescriptor[];
  enabledSkills: SkillDescriptor[];
  onToggleSkill: (skillId: string) => Promise<void>;
}) {
  return (
    <div className="sidebar-secondary__content">
      <div className="sidebar-secondary__header">
        <h2>Skills</h2>
        <span className="sidebar-secondary__count">{enabledSkills.length} enabled</span>
      </div>

      <div className="sidebar-secondary__list">
        {skills.map((skill) => (
          <div key={skill.id} className={`skill-item ${skill.enabled ? "" : "skill-item--disabled"}`}>
            <div className="skill-item__content">
              <div className="skill-item__name">{skill.metadata.displayName ?? skill.name}</div>
              <div className="skill-item__desc">{skill.metadata.shortDescription ?? skill.description}</div>
            </div>
            <button
              className={`skill-item__toggle ${skill.enabled ? "skill-item__toggle--on" : ""}`}
              onClick={() => void onToggleSkill(skill.id)}
            >
              {skill.enabled ? "On" : "Off"}
            </button>
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
          <label className="settings-field">
            <span>Sandbox Mode</span>
            <select
              value={providerForm.sandboxMode}
              onChange={(e) => setProviderForm((s) => ({ ...s, sandboxMode: e.target.value as typeof s.sandboxMode }))}
            >
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="danger-full-access">danger-full-access</option>
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

function ConversationFeed({ entries }: { entries: ConversationEntry[] }) {
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
  loading: boolean;
  canInterrupt: boolean;
}) {
  const isSendDisabled = loading || (!input.trim() && attachments.length === 0);
  const selectedReasoning = REASONING_OPTIONS.find((option) => option.value === selectedReasoningEffort) ?? REASONING_OPTIONS[3]!;

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
          <textarea
            className="composer-input"
            placeholder="给 my-agent 发消息"
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={canInterrupt}
          />
        </div>

        <div className="composer-toolbar">
          <div className="composer-toolbar__left">
            <div className="composer-popover-anchor" ref={composerMenuRef}>
              <button
                className="composer-tool-button composer-tool-button--icon"
                onClick={onToggleComposerMenu}
                aria-label="打开附加功能"
                title="打开附加功能"
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
                      <strong>添加照片和文件</strong>
                      <small>支持图片、文档和代码文件</small>
                    </span>
                  </button>

                  <button className="composer-popover__toggle-row" onClick={onToggleIdeContext}>
                    <span className="composer-popover__icon">
                      <Cpu size={16} />
                    </span>
                    <span className="composer-popover__copy">
                      <strong>包含 IDE 背景信息</strong>
                      <small>附带项目、线程和技能上下文</small>
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
                      <strong>计划模式</strong>
                      <small>先规划，再决定是否执行修改</small>
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
                <span className="composer-tool-button__label">{selectedModel || "选择模型"}</span>
                <ChevronDown size={14} />
              </button>

              {modelMenuOpen && (
                <div className="composer-popover composer-popover--select">
                  <div className="composer-popover__header">
                    <span>模型</span>
                    {providerModelsLoading && <small>加载中...</small>}
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
                      {providerModelsError ? providerModelsError : "当前 provider 还没有返回模型列表"}
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
                    <span>推理强度</span>
                    <small>仅对支持的模型生效</small>
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

            {includeIdeContext && <span className="composer-pill">IDE 背景</span>}
            {planMode && <span className="composer-pill composer-pill--accent">计划模式</span>}
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

  const flushThoughts = (completed: boolean) => {
    if (pendingThoughtItems.length === 0) {
      return;
    }

    const first = pendingThoughtItems[0]!;
    const last = pendingThoughtItems[pendingThoughtItems.length - 1]!;

    entries.push({
      id: `thought-${first.id}`,
      kind: "thought",
      items: pendingThoughtItems,
      completed,
      durationMs: Math.max(0, new Date(last.updatedAt).getTime() - new Date(first.createdAt).getTime()),
    });

    pendingThoughtItems = [];
  };

  for (const item of items) {
    if (item.kind === "userMessage") {
      flushThoughts(true);
      entries.push({ id: item.id, kind: "user", item });
      continue;
    }

    if (THOUGHT_ITEM_KINDS.includes(item.kind)) {
      pendingThoughtItems.push(item);
      continue;
    }

    if (item.kind === "agentMessage") {
      flushThoughts(true);
      entries.push({ id: item.id, kind: "answer", item });
      continue;
    }

    flushThoughts(true);
    entries.push({ id: item.id, kind: "system", item });
  }

  flushThoughts(false);
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

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function isImagePath(path: string) {
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(path);
}
