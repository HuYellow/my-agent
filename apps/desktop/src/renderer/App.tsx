import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  MessageSquarePlus,
  Zap,
  Grid3X3,
  GitBranch,
  Settings,
  Send,
  Plus,
  Search,
  FolderOpen,
  Bot,
  User,
  AlertTriangle,
  Wrench,
  FileEdit,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  type ApprovalPolicy,
  type ItemKind,
  type ItemRecord,
  type PendingApproval,
  type SandboxMode,
  type SkillDescriptor,
} from "@my-agent/protocol";
import { useAppStore } from "./store";

interface ProviderFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
  rootPath: string;
  approvalPolicy: ApprovalPolicy;
  sandboxMode: SandboxMode;
}

type NavView = "threads" | "skills" | "plugins" | "automation" | "settings";

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

export function App() {
  const {
    bootstrapped,
    loading,
    threads,
    turns,
    items,
    skills,
    activeThreadId,
    pendingApproval,
    config,
    providerTestMessage,
    bootstrap,
    createThread,
    selectThread,
    sendTurn,
    respondApproval,
    toggleSkill,
    updateConfig,
    testProvider,
  } = useAppStore();

  const [activeView, setActiveView] = useState<NavView>("threads");
  const [input, setInput] = useState("");
  const [skillDetail, setSkillDetail] = useState<SkillDescriptor | null>(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderFormState>({
    baseUrl: "",
    apiKey: "",
    model: "",
    rootPath: "",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!config) {
      return;
    }

    setProviderForm({
      baseUrl: config.provider.baseUrl,
      apiKey: config.provider.apiKey,
      model: config.provider.model,
      rootPath: config.workspace.rootPath,
      approvalPolicy: config.workspace.approvalPolicy,
      sandboxMode: config.workspace.sandboxMode,
    });
  }, [config]);

  const orderedThreads = useMemo(
    () => [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [threads],
  );
  const orderedItems = useMemo(
    () => [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [items],
  );
  const activeThread = useMemo(
    () => orderedThreads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, orderedThreads],
  );
  const activeTurn = useMemo(
    () => [...turns].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1),
    [turns],
  );
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);

  const filteredThreads = useMemo(() => {
    if (!threadSearch.trim()) return orderedThreads;
    const search = threadSearch.toLowerCase();
    return orderedThreads.filter(
      (thread) =>
        thread.title.toLowerCase().includes(search) ||
        thread.workspaceId.toLowerCase().includes(search)
    );
  }, [orderedThreads, threadSearch]);

  const handleCreateThread = async () => {
    await createThread();
    setActiveView("threads");
  };

  const submitTurn = async () => {
    const message = input.trim();

    if (!message) {
      return;
    }

    setInput("");
    await sendTurn(message, []);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submitTurn();
    }
  };

  if (!bootstrapped) {
    return <LoadingShell />;
  }

  return (
    <div className="app-container">
      {/* 左侧导航栏 */}
      <aside className="sidebar-nav">
        <div className="sidebar-nav__brand">
          <div className="sidebar-nav__logo">MA</div>
        </div>

        <nav className="sidebar-nav__items">
          <NavButton
            icon={<MessageSquarePlus size={20} />}
            label="New Thread"
            active={activeView === "threads"}
            onClick={() => setActiveView("threads")}
          />
          <NavButton
            icon={<Zap size={20} />}
            label="Skills"
            active={activeView === "skills"}
            onClick={() => setActiveView("skills")}
          />
          <NavButton
            icon={<Grid3X3 size={20} />}
            label="Plugins"
            active={activeView === "plugins"}
            onClick={() => setActiveView("plugins")}
          />
          <NavButton
            icon={<GitBranch size={20} />}
            label="Automation"
            active={activeView === "automation"}
            onClick={() => setActiveView("automation")}
          />
        </nav>

        <div className="sidebar-nav__footer">
          <NavButton
            icon={<Settings size={20} />}
            label="Settings"
            active={activeView === "settings"}
            onClick={() => setActiveView("settings")}
          />
        </div>
      </aside>

      {/* 次级侧栏 */}
      <aside className="sidebar-secondary">
        {activeView === "threads" && (
          <ThreadsPanel
            threads={filteredThreads}
            activeThreadId={activeThreadId}
            workspaceName={config?.workspace.name}
            search={threadSearch}
            onSearchChange={setThreadSearch}
            onSelectThread={selectThread}
            onCreateThread={handleCreateThread}
          />
        )}
        {activeView === "skills" && (
          <SkillsPanel
            skills={skills}
            enabledSkills={enabledSkills}
            onToggleSkill={toggleSkill}
          />
        )}
        {activeView === "plugins" && <PlaceholderPanel title="Plugins" description="Plugin management coming soon." />}
        {activeView === "automation" && <PlaceholderPanel title="Automation" description="Automation workflows coming soon." />}
        {activeView === "settings" && (
          <SettingsPanel
            providerForm={providerForm}
            setProviderForm={setProviderForm}
            providerTestMessage={providerTestMessage}
            onTestProvider={testProvider}
            onSaveConfig={() =>
              void updateConfig({
                provider: {
                  ...(config?.provider ?? {
                    id: "default-provider",
                    name: "Default Provider",
                    apiFlavor: "chat_completions",
                  }),
                  baseUrl: providerForm.baseUrl,
                  apiKey: providerForm.apiKey,
                  model: providerForm.model,
                },
                workspace: {
                  ...(config?.workspace ?? {
                    id: "default-workspace",
                    name: "Current Workspace",
                    shell: "powershell",
                  }),
                  rootPath: providerForm.rootPath,
                  approvalPolicy: providerForm.approvalPolicy,
                  sandboxMode: providerForm.sandboxMode,
                },
              })
            }
            onPickWorkspace={async () => {
              const picked = await window.myAgent.pickWorkspace();
              if (picked) {
                setProviderForm((state) => ({ ...state, rootPath: picked }));
              }
            }}
          />
        )}
      </aside>

      {/* 主内容区 */}
      <main className="main-content">
        {activeView === "threads" || activeView === "skills" ? (
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
                <div className="message-list">
                  {orderedItems.map((item) => (
                    <MessageItem key={item.id} item={item} />
                  ))}
                </div>
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
              onKeyDown={handleComposerKeyDown}
              loading={loading}
            />
          </>
        ) : (
          <div className="main-content__placeholder">
            <p>Select a feature from the sidebar</p>
          </div>
        )}
      </main>

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
      {icon}
    </button>
  );
}

function ThreadsPanel({
  threads,
  activeThreadId,
  workspaceName,
  search,
  onSearchChange,
  onSelectThread,
  onCreateThread,
}: {
  threads: import("@my-agent/protocol").ThreadRecord[];
  activeThreadId?: string;
  workspaceName?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onCreateThread: () => Promise<void>;
}) {
  return (
    <div className="sidebar-secondary__content">
      <div className="sidebar-secondary__header">
        <div className="sidebar-secondary__workspace">
          <FolderOpen size={14} />
          <span>{workspaceName ?? "No workspace"}</span>
        </div>
        <div className="sidebar-secondary__search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search threads..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-secondary__list">
        {threads.length > 0 ? (
          threads.map((thread) => (
            <button
              key={thread.id}
              className={`thread-item ${thread.id === activeThreadId ? "thread-item--active" : ""}`}
              onClick={() => void onSelectThread(thread.id)}
            >
              <div className="thread-item__content">
                <div className="thread-item__title">{thread.title}</div>
                <div className="thread-item__meta">
                  <Clock size={12} />
                  <span>{formatDateTime(thread.updatedAt)}</span>
                </div>
              </div>
              {thread.id === activeThreadId && <div className="thread-item__indicator" />}
            </button>
          ))
        ) : (
          <div className="sidebar-secondary__empty">
            <MessageSquarePlus size={24} />
            <p>No threads yet</p>
            <span>Start a new conversation</span>
          </div>
        )}
      </div>

      <div className="sidebar-secondary__footer">
        <button className="sidebar-secondary__new-thread" onClick={() => void onCreateThread()}>
          <Plus size={16} />
          <span>New Thread</span>
        </button>
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
  providerForm,
  setProviderForm,
  providerTestMessage,
  onTestProvider,
  onSaveConfig,
  onPickWorkspace,
}: {
  providerForm: ProviderFormState;
  setProviderForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  providerTestMessage?: string;
  onTestProvider: () => Promise<void>;
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
            <input
              value={providerForm.model}
              onChange={(e) => setProviderForm((s) => ({ ...s, model: e.target.value }))}
              placeholder="gpt-4"
            />
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
          <h3>Workspace</h3>
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

function MessageItem({ item }: { item: ItemRecord }) {
  const isUser = item.kind === "userMessage";
  const isAgent = item.kind === "agentMessage" || item.kind === "reasoning";
  const isTool = ["toolCall", "toolResult", "commandExecution"].includes(item.kind);

  return (
    <div className={`message-item ${isUser ? "message-item--user" : "message-item--agent"} message-item--${item.kind}`}>
      <div className="message-item__icon">
        {isUser && <User size={16} />}
        {isAgent && <Bot size={16} />}
        {isTool && <Wrench size={16} />}
        {item.kind === "fileChange" && <FileEdit size={16} />}
        {item.kind === "approvalRequest" && <AlertTriangle size={16} />}
        {item.kind === "error" && <XCircle size={16} />}
      </div>
      <div className="message-item__content">
        <div className="message-item__header">
          <span className="message-item__label">{ITEM_LABELS[item.kind]}</span>
          <span className="message-item__time">{formatTime(item.updatedAt)}</span>
        </div>
        <div className="message-item__title">{item.title}</div>
        {item.body && <pre className="message-item__body">{item.body}</pre>}
      </div>
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
  onKeyDown,
  loading,
}: {
  input: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  loading: boolean;
}) {
  return (
    <div className="composer-bar">
      <div className="composer-bar__input-wrapper">
        <textarea
          className="composer-input"
          placeholder="Type a message... (Ctrl+Enter to send)"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <button
          className="composer-bar__send"
          onClick={() => void onSubmit()}
          disabled={loading || !input.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="app-container app-container--loading">
      <aside className="sidebar-nav sidebar-nav--loading" />
      <aside className="sidebar-secondary sidebar-secondary--loading" />
      <main className="main-content main-content--loading" />
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
