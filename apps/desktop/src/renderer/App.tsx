import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  type ApprovalPolicy,
  type ItemKind,
  type ItemRecord,
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

type InspectorTab = "skills" | "settings";

const EMPTY_PROMPTS = [
  {
    label: "Map runtime",
    prompt: "Inspect this repo and explain how the desktop app, harness runtime, and shared protocol fit together.",
  },
  {
    label: "Review skills",
    prompt: "Use $repo-qa to summarize the current skills discovery flow and suggest the next improvements for skills and harness integration.",
  },
  {
    label: "Next milestone",
    prompt: "Based on the current codebase, propose the next milestone after the desktop shell for making the runtime feel more like Codex Desktop.",
  },
];

const ITEM_LABELS: Record<ItemKind, string> = {
  userMessage: "User",
  agentMessage: "Agent",
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

  const [input, setInput] = useState("");
  const [skillDetail, setSkillDetail] = useState<SkillDescriptor | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("skills");
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
  const activeThread = useMemo(
    () => orderedThreads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, orderedThreads],
  );
  const activeTurn = useMemo(
    () => [...turns].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1),
    [turns],
  );
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);
  const implicitSkillsCount = useMemo(
    () => skills.filter((skill) => skill.metadata.allowImplicitInvocation).length,
    [skills],
  );
  const activeSkills = useMemo(() => {
    const matches = [...input.matchAll(/(?:^|\s)\$([a-z0-9][a-z0-9-]*)/gi)].map((match) => match[1]!.toLowerCase());
    return enabledSkills.filter((skill) => matches.includes(skill.name.toLowerCase()));
  }, [enabledSkills, input]);

  const submitTurn = async () => {
    const message = input.trim();

    if (!message) {
      return;
    }

    setInput("");
    await sendTurn(
      message,
      activeSkills.map((skill) => skill.id),
    );
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
    <div className="app-root">
      <div className="app-grid">
        <aside className="app-rail">
          <div className="app-rail__brand">MA</div>

          <div className="app-rail__group">
            <button className="app-rail__button app-rail__button--accent" onClick={() => void createThread()} title="New thread">
              +
            </button>
            <button className="app-rail__button app-rail__button--active" title="Threads">
              TH
            </button>
            <button className="app-rail__button" onClick={() => setInspectorTab("skills")} title="Skills">
              SK
            </button>
            <button className="app-rail__button" onClick={() => setInspectorTab("settings")} title="Settings">
              RT
            </button>
          </div>

          <div className="app-rail__footer">
            <div className={`status-dot ${loading ? "status-dot--live" : "status-dot--idle"}`} />
            <span>{loading ? "running" : "ready"}</span>
          </div>
        </aside>

        <aside className="thread-pane">
          <div className="thread-pane__hero">
            <div>
              <p className="eyebrow">Workspace</p>
              <h1 className="thread-pane__title">{config?.workspace.name ?? "my-agent"}</h1>
            </div>
            <p className="thread-pane__subtitle">
              {config?.workspace.rootPath
                ? `Local harness attached to ${getLastSegment(config.workspace.rootPath)}`
                : "Attach a workspace root to start a local agent session."}
            </p>
          </div>

          <div className="thread-pane__stats">
            <MetricCard label="Threads" value={String(orderedThreads.length)} detail="Persistent session containers" />
            <MetricCard label="Skills" value={`${enabledSkills.length}/${skills.length}`} detail="Enabled workflow packs" />
            <MetricCard label="Mode" value={config?.workspace.sandboxMode ?? "workspace-write"} detail="Current sandbox policy" />
          </div>

          <div className="thread-pane__section thread-pane__section--threads">
            <div className="section-header">
              <div>
                <p className="eyebrow">Threads</p>
                <h2>Session timeline</h2>
              </div>
              <button className="button button--ghost" onClick={() => void createThread()}>
                New thread
              </button>
            </div>

            <div className="thread-list">
              {orderedThreads.length > 0 ? (
                orderedThreads.map((thread) => (
                  <button
                    key={thread.id}
                    className={`thread-card ${thread.id === activeThreadId ? "thread-card--active" : ""}`}
                    onClick={() => void selectThread(thread.id)}
                  >
                    <div className="thread-card__title-row">
                      <span className="thread-card__title">{thread.title}</span>
                      {thread.id === activeThreadId ? <span className="thread-card__badge">Live</span> : null}
                    </div>
                    <div className="thread-card__meta">
                      <span>{formatDateTime(thread.updatedAt)}</span>
                      <span>{thread.workspaceId}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="thread-empty">
                  <p>No threads yet.</p>
                  <span>Create one from the rail or send your first message from the composer.</span>
                </div>
              )}
            </div>
          </div>

          <div className="thread-pane__section thread-pane__section--skills">
            <div className="section-header">
              <div>
                <p className="eyebrow">Quick skills</p>
                <h2>Fast launch</h2>
              </div>
              <span className="section-meta">{implicitSkillsCount} implicit</span>
            </div>

            <div className="quick-skills">
              {enabledSkills.slice(0, 6).map((skill) => (
                <button
                  key={skill.id}
                  className="quick-skill"
                  onClick={() => setInput((value) => `${value}${value ? " " : ""}$${skill.name} `)}
                  style={buildSkillStyle(skill)}
                >
                  <span className="quick-skill__name">{skill.metadata.displayName ?? skill.name}</span>
                  <span className="quick-skill__hint">{skill.metadata.shortDescription ?? skill.description}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="workspace-pane">
          <header className="workspace-pane__header">
            <div>
              <p className="eyebrow">Thread</p>
              <h2 className="workspace-pane__title">{activeThread?.title ?? "Design your local agent workspace"}</h2>
              <p className="workspace-pane__subtitle">
                {activeThread
                  ? `Thread ${activeThread.id.slice(0, 8)} running inside ${getLastSegment(config?.workspace.rootPath)}`
                  : "Start with a repo walkthrough, a harness task, or an internal workflow skill."}
              </p>
            </div>

            <div className="workspace-pane__badges">
              <span className="meta-pill">{config?.provider.model || "No model"}</span>
              <span className="meta-pill">{config?.workspace.approvalPolicy ?? "on-request"}</span>
              <span className="meta-pill">{getLastSegment(config?.workspace.rootPath)}</span>
              <span className={`meta-pill meta-pill--status meta-pill--status-${normalizeTurnStatus(activeTurn?.status)}`}>
                {activeTurn?.status ?? "idle"}
              </span>
            </div>
          </header>

          {activeSkills.length > 0 ? (
            <div className="active-skill-bar">
              <span className="active-skill-bar__label">Activated this turn</span>
              <div className="active-skill-bar__list">
                {activeSkills.map((skill) => (
                  <button
                    key={skill.id}
                    className="active-skill-chip"
                    onClick={() => setSkillDetail(skill)}
                    style={buildSkillStyle(skill)}
                  >
                    <span className="active-skill-chip__dot" />
                    {skill.metadata.displayName ?? skill.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="transcript-pane">
            {items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__eyebrow">Codex-like local workflow shell</div>
                <h3>Thread, turn, and item events will stream here.</h3>
                <p>
                  This workspace is ready for multi-turn agent runs, approvals, command traces, file patches, and
                  skill-driven flows. Pick a prompt to seed the first run or type your own in the composer below.
                </p>
                <div className="empty-state__actions">
                  {EMPTY_PROMPTS.map((entry) => (
                    <button key={entry.label} className="prompt-card" onClick={() => setInput(entry.prompt)}>
                      <span className="prompt-card__label">{entry.label}</span>
                      <span className="prompt-card__body">{entry.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="stream-list">
                {items.map((item) => (
                  <StreamCard key={item.id} item={item} onInspectSkills={() => setInspectorTab("skills")} />
                ))}
              </div>
            )}
          </div>

          {pendingApproval ? (
            <section className="approval-dock">
              <div className="approval-dock__header">
                <div>
                  <p className="eyebrow">Approval required</p>
                  <h3>{pendingApproval.toolName}</h3>
                </div>
                <span className="meta-pill meta-pill--warning">{pendingApproval.scope === "session" ? "session scope" : "one shot"}</span>
              </div>
              <p className="approval-dock__reason">{pendingApproval.reason}</p>
              <pre className="approval-dock__payload">{JSON.stringify(pendingApproval.args, null, 2)}</pre>
              <div className="approval-dock__actions">
                <button className="button button--ghost" onClick={() => void respondApproval(pendingApproval.id, "reject")}>
                  Reject
                </button>
                <button className="button" onClick={() => void respondApproval(pendingApproval.id, "approve", "once")}>
                  Approve once
                </button>
                <button className="button button--accent" onClick={() => void respondApproval(pendingApproval.id, "approve", "session")}>
                  Allow for session
                </button>
              </div>
            </section>
          ) : null}

          <footer className="composer-pane">
            <div className="composer-pane__meta">
              <span>{loading ? "Agent is running." : "Ready for the next turn."}</span>
              <span>
                {activeSkills.length > 0
                  ? `Explicit skills: ${activeSkills.map((skill) => skill.name).join(", ")}`
                  : "Explicit skills: none"}
              </span>
            </div>

            <div className="composer-shell">
              <textarea
                className="composer-input"
                placeholder="Ask the agent to inspect the repo, use a skill, review a diff, or run a safe workflow."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="composer-shell__footer">
                <div className="composer-shell__hint">
                  <span>Use $skill-name for explicit activation.</span>
                  <span>Press Ctrl/Cmd + Enter to send.</span>
                </div>
                <button className="button button--accent button--send" onClick={() => void submitTurn()}>
                  Send turn
                </button>
              </div>
            </div>
          </footer>
        </main>

        <aside className="utility-pane">
          <div className="utility-pane__switcher">
            <button
              className={`utility-pane__switch ${inspectorTab === "skills" ? "utility-pane__switch--active" : ""}`}
              onClick={() => setInspectorTab("skills")}
            >
              Skills
            </button>
            <button
              className={`utility-pane__switch ${inspectorTab === "settings" ? "utility-pane__switch--active" : ""}`}
              onClick={() => setInspectorTab("settings")}
            >
              Runtime
            </button>
          </div>

          <div className="utility-pane__content">
            {inspectorTab === "settings" ? (
              <section className="utility-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Provider</p>
                    <h2>Runtime configuration</h2>
                  </div>
                  <button className="button button--ghost" onClick={() => void testProvider()}>
                    Test provider
                  </button>
                </div>

                <div className="settings-grid">
                  <label className="field">
                    <span>Base URL</span>
                    <input
                      value={providerForm.baseUrl}
                      onChange={(event) => setProviderForm((state) => ({ ...state, baseUrl: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <input
                      value={providerForm.model}
                      onChange={(event) => setProviderForm((state) => ({ ...state, model: event.target.value }))}
                    />
                  </label>
                  <label className="field field--full">
                    <span>API key</span>
                    <input
                      value={providerForm.apiKey}
                      onChange={(event) => setProviderForm((state) => ({ ...state, apiKey: event.target.value }))}
                    />
                  </label>
                  <label className="field field--full">
                    <span>Workspace root</span>
                    <div className="field-row">
                      <input
                        value={providerForm.rootPath}
                        onChange={(event) => setProviderForm((state) => ({ ...state, rootPath: event.target.value }))}
                      />
                      <button
                        className="button button--ghost"
                        onClick={async () => {
                          const picked = await window.myAgent.pickWorkspace();

                          if (picked) {
                            setProviderForm((state) => ({ ...state, rootPath: picked }));
                          }
                        }}
                      >
                        Browse
                      </button>
                    </div>
                  </label>
                  <label className="field">
                    <span>Approval policy</span>
                    <select
                      value={providerForm.approvalPolicy}
                      onChange={(event) =>
                        setProviderForm((state) => ({
                          ...state,
                          approvalPolicy: event.target.value as typeof state.approvalPolicy,
                        }))
                      }
                    >
                      <option value="on-request">on-request</option>
                      <option value="on-failure">on-failure</option>
                      <option value="never">never</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Sandbox mode</span>
                    <select
                      value={providerForm.sandboxMode}
                      onChange={(event) =>
                        setProviderForm((state) => ({
                          ...state,
                          sandboxMode: event.target.value as typeof state.sandboxMode,
                        }))
                      }
                    >
                      <option value="read-only">read-only</option>
                      <option value="workspace-write">workspace-write</option>
                      <option value="danger-full-access">danger-full-access</option>
                    </select>
                  </label>
                </div>

                <div className="utility-card__footer">
                  <p className="provider-note">{providerTestMessage ?? "OpenAI-compatible providers can be tested from here."}</p>
                  <button
                    className="button button--accent"
                    onClick={() =>
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
                  >
                    Save changes
                  </button>
                </div>
              </section>
            ) : (
              <section className="utility-card utility-card--skills">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Skills</p>
                    <h2>Discovery and control</h2>
                  </div>
                  <span className="section-meta">{enabledSkills.length} enabled</span>
                </div>

                <div className="skills-summary">
                  <div className="skills-summary__card">
                    <span>Implicit invocation</span>
                    <strong>{implicitSkillsCount}</strong>
                  </div>
                  <div className="skills-summary__card">
                    <span>Repo and user scopes</span>
                    <strong>{skills.filter((skill) => skill.scope !== "SYSTEM").length}</strong>
                  </div>
                </div>

                <div className="skill-list">
                  {skills.map((skill) => (
                    <article
                      key={skill.id}
                      className={`skill-card ${skill.enabled ? "" : "skill-card--disabled"}`}
                      style={buildSkillStyle(skill)}
                    >
                      <div className="skill-card__header">
                        <div>
                          <div className="skill-card__title-row">
                            <h3>{skill.metadata.displayName ?? skill.name}</h3>
                            <span className="skill-card__scope">{skill.scope}</span>
                          </div>
                          <p>{skill.metadata.shortDescription ?? skill.description}</p>
                        </div>
                        <button className={`button ${skill.enabled ? "" : "button--ghost"}`} onClick={() => void toggleSkill(skill.id)}>
                          {skill.enabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>

                      <div className="skill-card__footer">
                        <div className="skill-card__meta">
                          <span>{skill.metadata.allowImplicitInvocation ? "Implicit allowed" : "Explicit only"}</span>
                          <span>{skill.path}</span>
                        </div>
                        <div className="skill-card__actions">
                          <button
                            className="button button--ghost"
                            onClick={() => setInput((value) => `${value}${value ? " " : ""}$${skill.name} `)}
                          >
                            Insert
                          </button>
                          <button className="button button--ghost" onClick={() => setSkillDetail(skill)}>
                            Details
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>
      </div>

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

            <div className="dialog-detail">
              <span>Summary</span>
              <p>{skillDetail?.metadata.shortDescription ?? skillDetail?.description}</p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="app-root">
      <div className="loading-grid">
        <div className="loading-rail" />
        <div className="loading-panel" />
        <div className="loading-panel loading-panel--wide" />
        <div className="loading-panel" />
      </div>
    </div>
  );
}

function MetricCard(props: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  );
}

function StreamCard(props: { item: ItemRecord; onInspectSkills: () => void }) {
  return (
    <article className={`stream-card stream-card--${props.item.kind} stream-card--${props.item.status}`}>
      <div className="stream-card__header">
        <div className="stream-card__eyebrow">
          <span>{ITEM_LABELS[props.item.kind]}</span>
          <span>{formatTime(props.item.updatedAt)}</span>
        </div>
        <div className="stream-card__title-row">
          <h3>{props.item.title}</h3>
          {props.item.kind === "toolCall" || props.item.kind === "toolResult" ? (
            <button className="stream-card__link" onClick={props.onInspectSkills}>
              Inspect skills
            </button>
          ) : null}
        </div>
      </div>
      <pre className="stream-card__body">{props.item.body || " "}</pre>
    </article>
  );
}

function buildSkillStyle(skill: SkillDescriptor): CSSProperties {
  return {
    "--skill-color": skill.metadata.brandColor ?? "#6ad7ff",
  } as CSSProperties;
}

function getLastSegment(path?: string) {
  if (!path) {
    return "No workspace";
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
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

function normalizeTurnStatus(value?: string) {
  if (!value) {
    return "idle";
  }

  return value.replace(/[^a-z_]/gi, "_");
}
