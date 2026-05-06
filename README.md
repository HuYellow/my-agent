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

## Extension Distribution

P2-M3 adds a first-class extension packaging layer:

- scaffoldable templates for skills, workflows, and plugins
- compatibility metadata for workflow and plugin manifests
- catalog roots under `~/.my-agent/catalogs/*` for shareable local distributions

See [docs/distribution-and-templates.md](docs/distribution-and-templates.md) for the authoring and packaging guide.
