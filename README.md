# my-agent

Codex-like desktop agent scaffold built with Electron, React, TypeScript, and a local harness process.

## Workspace layout

- `apps/desktop`: Electron shell, React renderer, and preload bridge.
- `packages/core`: `my-agent-core` harness process that exposes JSON-RPC over stdio.
- `packages/protocol`: Shared protocol types used by the harness and desktop client.

## Quick start

```bash
npm install
npm run dev
```

## Current status

This repository contains a working foundation for:

- thread / turn / item primitives
- JSON-RPC over stdio between the desktop app and the harness
- SQLite-backed persistence with Node's built-in `node:sqlite`
- skills discovery with repo / user / system scopes
- approval requests and resumable pending actions
- a desktop UI for threads, event stream, approvals, provider settings, and skills

Future work is intentionally left open for richer terminal emulation, Monaco-based diffs, company tools, TUI, and more advanced model adapters.

## Agent Design Modules

`my-agent` should be treated as an engineering runtime for coding tasks, not only as a chat UI around an LLM. The main design areas are listed below as module boundaries that can be evolved independently.

### Runtime execution

The runtime owns the lifecycle of a coding task. A turn should be observable from start to completion, including streamed model output, tool calls, approval waits, resume, cancellation, failure, and final artifacts.

Key points:

- Model every task as a structured execution instead of a loose message exchange.
- Persist enough state for long-running or approval-blocked work to resume safely.
- Record what files changed, what commands ran, what tools were used, and what artifacts were produced.
- Prefer structured events over natural-language status text so the desktop UI, automation, and review flows can consume the same runtime state.

### Tools and capability governance

The agent's practical ability comes from tools: file reads, patch application, shell commands, MCP tools, plugin tools, internal tools, and future company integrations. All tool sources should converge on one capability and error model.

Key points:

- Describe every tool with capability metadata such as `writes`, `network`, `interactive`, `approval`, `timeout`, and `source`.
- Normalize tool errors into stable categories: validation error, timeout, approval required, blocked by policy, and execution failure.
- Treat shell execution as a governed tool, not as raw command passthrough.
- Prefer structured patch and file APIs over ad hoc shell-based editing when possible.
- Apply the same approval and audit rules to local, MCP, plugin, and internal tools.

### Security, sandbox, and approvals

Coding agents can write files, run commands, use credentials, and call networked systems, so safety must be part of the runtime contract instead of a UI-only confirmation.

Key points:

- Define workspace boundaries, protected paths, read-only modes, and generated-artifact locations.
- Classify commands by risk, including package installs, network calls, destructive git operations, and system-level commands.
- Support preflight approvals, deferred approvals, and session approvals with consistent semantics.
- Make approval waits resumable without restarting the whole model run.
- Keep an audit trail for what was requested, why it was requested, who approved it, and what happened.

### Context and memory

Agent quality depends heavily on context hygiene. The prompt builder should assemble the smallest useful context for the current run instead of concatenating every available instruction and history item.

Key points:

- Separate short-term turn context, stable project context, retrievable memory, execution context, and selected skills.
- Keep `AGENTS.md`, repository docs, skills, MCP context, and prior task memory as distinct sources.
- Summarize long sessions semantically while preserving key decisions and artifacts.
- Make sub-agent context inheritance explicit and minimal.
- Expose a context summary in events or UI so unexpected model behavior can be diagnosed.

### Sub-agents

Sub-agents should be real coding workers, not secondary chat completions. They need their own execution scope and a structured result contract.

Key points:

- Inherit only the necessary project, task, history, and skill context.
- Bind sub-agents to independent worktrees when they may edit code.
- Allow sub-agents to use the same tool and approval system as the parent agent.
- Support `spawn`, `wait`, `send_input`, `interrupt`, cancellation, failure handling, and cleanup.
- Return structured results: status, summary, changed files, artifacts, tool usage, and failure reason.

### Review mode

Review should be a first-class runtime mode with structured findings, not a normal chat prompt that happens to inspect code.

Key points:

- Support multiple review inputs: current workspace diff, staged diff, commit diff, and base-branch diff.
- Emit findings with file, line, severity, confidence, title, and body.
- Keep review state separate from normal coding turns.
- Render findings in a dedicated UI area instead of burying them in the message stream.
- Reuse the same review engine from desktop, GitHub Action, app-server, and MCP-server flows.

### Workflow orchestration

Real coding tasks are multi-step processes: inspect, plan, edit, test, fix, review, and summarize. Workflow support should reuse the same runtime primitives as normal turns.

Key points:

- Introduce a shared execution context for project, worktree, cwd, shell, environment snapshot, and detected tools.
- Treat command steps, agent steps, review steps, and approval steps as execution units with consistent status and artifacts.
- Support step-level retry, pause, resume, and failure recovery.
- Preserve artifacts from failed steps so users and later steps can inspect them.
- Avoid maintaining a separate simplified agent path just for workflows.

### Protocol and event model

The protocol package is the contract between desktop, core, app-server, MCP server, GitHub Action, and future extensions. It should describe product behavior, not only TypeScript shapes.

Key points:

- Version protocol changes and document compatibility expectations.
- Keep requests, responses, and events clearly separated.
- Add structured events for plans, diffs, reviews, approvals, terminal activity, tools, and sub-agents.
- Avoid making the UI infer runtime state from message text.
- Keep newly added fields backwards-compatible where possible.

### Desktop workbench

The desktop app should help the user understand and steer the agent, not just display a transcript.

Key points:

- Provide dedicated surfaces for messages, plan, terminal, diff, approvals, sub-agent tree, review findings, skills, plugins, provider settings, and execution context.
- Make running work steerable while preserving the task state.
- Show what the agent is doing, what it is waiting on, what changed, and what remains.
- Keep operational controls close to the runtime state they affect.

### Plugins, skills, and distribution

Extensions should be easy to author but governed like platform capabilities. Skills, workflows, and plugins have different responsibilities and should not collapse into one mechanism.

Key points:

- Use skills for task guidance and context, not arbitrary privileged execution.
- Use plugins for new tools or runtime capabilities with manifests, versions, compatibility metadata, and permission declarations.
- Use workflows for reusable task orchestration.
- Validate extension manifests at install and startup.
- Provide templates and catalog roots for shareable local distributions.
- Require explicit trust or enablement for capabilities that expand what the agent can do.

### Provider and model adapters

The runtime should not be tied to a single model vendor. Provider-specific behavior should be isolated behind adapters and capability descriptions.

Key points:

- Track provider capabilities such as streaming, tool calling, structured output, context length, and reasoning support.
- Normalize provider errors before they reach runtime services or UI.
- Keep prompt construction and tool schema generation compatible with provider differences.
- Log LLM requests in a way that supports debugging without leaking sensitive data unnecessarily.

### Testing and verification

Agent behavior spans protocol, persistence, tools, model adapters, UI, and automation. Tests should cover complete execution paths, not only small utility functions.

Key points:

- Cover happy paths for turns, tools, approvals, workflows, sub-agents, and reviews.
- Add regression tests for sandbox boundaries, protected paths, read-only writes, network restrictions, and destructive git commands.
- Test long-running commands, interactive terminal behavior, cancellation, exit codes, and resume.
- Verify protocol compatibility across desktop, core, app-server, MCP server, and GitHub Action.
- Keep end-to-end coding task fixtures that require inspection, edit, test, and final summary.

## Extension Distribution

P2-M3 adds a first-class extension packaging layer:

- scaffoldable templates for skills, workflows, and plugins
- compatibility metadata for workflow and plugin manifests
- catalog roots under `~/.my-agent/catalogs/*` for shareable local distributions

See [docs/distribution-and-templates.md](docs/distribution-and-templates.md) for the authoring and packaging guide.
