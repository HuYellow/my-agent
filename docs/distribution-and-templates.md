# Distribution And Templates

This guide covers the P2-M3 extension surface for Yellow Flow: how templates are scaffolded, how runtime discovery works, and how compatibility is expressed for workflows and plugins.

## Discovery Roots

Yellow Flow now discovers extension assets from four stable locations:

- System assets:
  - `packages/core/system-skills`
  - `packages/core/system-workflows`
- User assets:
  - `~/.yellow-flow/skills`
  - `~/.yellow-flow/workflows`
  - `~/.yellow-flow/plugins`
- Repo assets:
  - `.agents/skills`
  - `.agents/workflows`
  - `.agents/plugins`
  - `.codex/workflows`
  - `.codex/plugins`
- Catalog assets:
  - `~/.yellow-flow/catalogs/skills`
  - `~/.yellow-flow/catalogs/workflows`
  - `~/.yellow-flow/catalogs/plugins`

The new `catalogs/*` roots are the reserved distribution entrypoint for sharing installable assets outside a repo checkout while still keeping them local and auditable.

## Built-In Template Kits

The runtime exposes three scaffoldable templates through `template/list` and `template/scaffold`:

- `skill-basic`
  - Creates `SKILL.md` plus `agents/openai.yaml`
- `workflow-review`
  - Creates a review-oriented workflow manifest with compatibility metadata
- `plugin-tool`
  - Creates a runnable Node-based plugin with `.codex-plugin/plugin.json`

Desktop surfaces these templates under `Settings -> Templates & Distribution`.

## Compatibility Strategy

Compatibility is intentionally explicit for distributable artifacts:

- Workflows may declare:
  - `apiVersion`
  - `templateVersion`
  - `compatibility.protocolVersion`
  - `compatibility.serverVersion`
- Plugins may declare:
  - `schemaVersion`
  - `compatibility.protocolVersion`
  - `compatibility.serverVersion`

Current expectations:

- Workflow scaffold emits `apiVersion: "yellow-flow/v1alpha1"`
- Plugin scaffold emits `schemaVersion: "1.0"`
- Runtime protocol compatibility remains `0.1.0`

For now, unsupported plugin schema major versions are surfaced as validation errors instead of being loaded silently.

## Packaging Guidance

### Skills

Keep the root folder self-contained:

- `SKILL.md`
- `agents/openai.yaml`
- optional `references/`, `scripts/`, and assets

### Workflows

Prefer a single `.yaml` entrypoint that can be copied into repo, user, or catalog roots. Keep compatibility metadata near the top of the file so reviewers can validate it quickly.

### Plugins

The recommended minimum layout is:

- `.codex-plugin/plugin.json`
- runnable entrypoint such as `src/index.js`
- `README.md`

Plugin commands should:

- read JSON from stdin
- emit useful stdout on success
- exit non-zero with a concise stderr message on failure

## Example Assets

Reference examples live in:

- `examples/distribution/skills/release-notes`
- `examples/distribution/workflows/release-review.yaml`
- `examples/distribution/plugins/changelog-helper`

These examples are intentionally small and are meant to be copied, renamed, and adapted rather than used as-is.
