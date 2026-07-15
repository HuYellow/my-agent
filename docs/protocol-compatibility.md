# Protocol Compatibility

This document defines the minimum compatibility rules for the `my-agent` runtime protocol.

## Stability Rules

- `protocolVersion` is currently `0.2.0`.
- Changes within the same protocol version must be additive.
- Existing event names, RPC method names, and enum literals must remain stable.
- New payload fields may be added, but existing required fields must not be removed or renamed without a protocol version change.

## Tool Source Governance

All runtime tools must resolve to one of these stable source kinds:

- `local`
- `plugin`
- `mcp`
- `internal`

Each tool exposed to the runtime must publish:

- `source`
- `capability`
- `description`
- a stable runtime `name`

The desktop UI and downstream services must consume the structured source kind instead of inferring origin from naming conventions.

## Structured Runtime Events

The following runtime event families are first-class and should not require parsing free-form item bodies:

- `turn/planUpdated`
- `turn/diffUpdated`
- `review/started`
- `review/status`
- `review/result`
- `tools/catalogUpdated`
- `run/updated`

Runtime events include optional `meta` in the shared in-process contract. Desktop and app-server transports serialize this as `__eventMeta` alongside the existing payload so 0.1 consumers remain compatible. The metadata contains a stable event id, monotonic journal sequence, aggregate id, timestamp, and protocol version.

Clients that reconnect should call `event/listSince` with their last applied sequence, apply events in sequence order, and ignore events whose sequence is already applied. `runtime/snapshot` provides a consistent recovery baseline.

## Error Compatibility

Structured tool failures should use `ToolErrorRecord` when surfaced through RPC or item metadata.

Supported tool error codes:

- `timeout`
- `approval_required`
- `blocked`
- `validation_error`
- `execution_failed`
- `aborted`

## Consumer Expectations

- Desktop, app-server, and other clients should tolerate unknown additive fields.
- Clients should ignore unknown event types they do not yet understand.
- Clients should prefer structured `tool`, `artifact`, `plan`, and `diff` payloads over parsing message text.
- Clients should tolerate new catalog-scoped assets and new template descriptors without assuming fixed source roots.
- Clients should treat `runId` on turns/items as optional and fall back to `turnId` for 0.1 data.
- A thread accepts only one active turn. Other work can run in separate threads or delegated agents.

## Distribution Templates

- `template/list` enumerates built-in scaffold kits.
- `template/scaffold` creates local skill, workflow, and plugin starter assets.
- Template descriptors are additive metadata and may gain new optional fields over time.
