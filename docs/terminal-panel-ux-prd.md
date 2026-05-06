# Terminal Panel UX / PRD

## Background

Current desktop UI keeps a bottom terminal panel visible as a persistent layout region. In the current experience, this panel often behaves more like a passive output container for LLM-triggered shell commands than a user-controlled terminal workspace.

This creates a mismatch:

- The UI permanently reserves space for a surface that is not always needed.
- Most command runs are short-lived and could be represented as transient task output instead of a full terminal region.
- The main interface competes with a panel that may have low interaction value during normal chat and coding flows.

The concern is not whether terminal output is useful. It is useful. The issue is whether a persistent bottom panel is the right default presentation for that output.

## Problem Statement

The product currently conflates two separate needs:

1. Short-lived command execution feedback for LLM tool calls
2. A persistent, user-operable terminal session

When both needs are forced into the same always-visible bottom panel, the result is a UI that feels heavier than necessary and reduces the space available for the primary surfaces: conversation, code, diff, and review.

## Goals

- Reduce persistent UI occupation caused by terminal output.
- Preserve visibility into command execution initiated by the LLM.
- Keep support for long-running and user-driven terminal workflows.
- Make the distinction between "command run history" and "live terminal session" explicit.
- Improve focus on the primary coding workflow without removing terminal power-user capability.

## Non-Goals

- Removing terminal functionality entirely
- Hiding all shell activity from the user
- Replacing detailed logs with only high-level status toasts
- Redesigning unrelated layout areas outside the terminal/output experience

## Users

### Primary Users

- Users interacting mainly through chat and code views
- Users who want to observe command execution without manually using a shell

### Secondary Users

- Users who rely on a real terminal for debugging, running watch tasks, or manual intervention
- Power users who want a persistent shell session with state continuity

## Key Insight

The product should treat these as two distinct UI primitives:

### 1. Command Output Surface

Used for LLM-triggered shell/tool calls.

Characteristics:

- Ephemeral by default
- Focused on status, logs, duration, and rerun/copy affordances
- Attached to the relevant agent/task context

### 2. Persistent Terminal Surface

Used when the user wants an actual terminal workspace.

Characteristics:

- Stateful session
- Manually opened or pinned
- Appropriate for servers, watch mode, and direct user command entry

## Proposed UX Direction

### Default Behavior

The bottom terminal panel should not be permanently visible by default.

Instead:

- LLM shell/tool invocations render as inline or overlay command execution cards
- The command UI expands automatically while a command is active
- On success, the UI collapses into a compact history row
- On failure, the UI remains expanded and visually prominent until dismissed or reviewed

### Persistent Terminal

Provide a separate explicit entry point for opening a real terminal session:

- "Open Terminal"
- "Pin as Terminal"
- "Open in Bottom Panel"

This makes the persistent terminal an intentional mode, not a default tax on layout space.

## Recommended Interaction Model

### Command Run Lifecycle

#### Idle

- No bottom terminal panel is shown by default
- Past command runs are accessible from task history, activity feed, or expandable command cards

#### Command Starts

- Show a lightweight command execution surface
- Recommended placements:
  - Inline in the conversation/task transcript
  - Docked transient panel above the bottom edge
  - Side activity drawer if consistent with the existing information architecture

Displayed information:

- Command summary
- Running state
- Elapsed time
- Optional live logs
- Expand/collapse control

#### Command Succeeds

- Auto-collapse after a short delay
- Replace with a compact success summary
- Preserve access to full output via expand action

#### Command Fails

- Keep expanded by default
- Highlight stderr/error summary
- Offer actions such as retry, copy output, open full logs, and open in terminal

#### Long-Running Process

If the command is still active after a threshold, for example 5-10 seconds:

- Offer "Keep visible"
- Offer "Promote to Terminal"
- Indicate that the process is long-running and may continue streaming

## UX Variants Considered

### Option A: Always-Visible Bottom Terminal

Pros:

- Maximum visibility
- Familiar to developer tools

Cons:

- High persistent space cost
- Over-serves infrequent needs
- Blurs command output and live shell usage

Recommendation: not preferred as default

### Option B: Auto-Show, Auto-Hide Output Panel

Pros:

- Preserves visibility during execution
- Minimizes idle footprint
- Simple mental model

Cons:

- Can feel jumpy if motion is not handled carefully
- May be less suitable for multi-command concurrent runs

Recommendation: strong baseline option

### Option C: Inline Command Cards + Optional Terminal

Pros:

- Best contextual alignment with agent/task actions
- Lowest permanent layout cost
- Clear separation between output history and shell workspace

Cons:

- Requires stronger transcript/activity design
- Large logs may need dedicated expansion affordances

Recommendation: best long-term model

## Preferred Solution

Adopt a hybrid of Option B and Option C:

- Use inline or transient command output for LLM-triggered shell activity
- Keep a dedicated persistent terminal available only when explicitly opened or pinned
- Reserve the bottom panel primarily for pinned/live terminal sessions, not routine command output

## Detailed Product Requirements

### Functional Requirements

1. LLM-triggered shell commands must remain visible to the user while running.
2. Completed command output must remain inspectable after collapse.
3. Failed commands must remain more prominent than successful commands.
4. Users must be able to manually open a persistent terminal session.
5. Users must be able to promote a running command output view into a persistent terminal view when appropriate.
6. Users must be able to reopen recent command output without rerunning the command.
7. Multiple command executions should be representable without requiring multiple stacked persistent bottom panels.

### Configuration Requirements

Expose a user preference for terminal visibility behavior:

- Auto
- Always show terminal panel
- Always keep terminal panel collapsed unless manually opened

Recommended default: `Auto`

`Auto` should mean:

- Short tasks use transient/inline output UI
- Long-running or pinned tasks can claim persistent space

### Accessibility Requirements

- Command state must be readable via screen reader labels
- Motion for auto-expand/collapse should respect reduced motion settings
- Keyboard navigation must support expand/collapse, focus into logs, and opening terminal mode
- Success/error states must not rely only on color

## Information Architecture

### Separate Labels and Concepts

Avoid using one label for both use cases.

Recommended naming:

- `Command Output` for LLM-triggered runs
- `Terminal` for a persistent shell session

This distinction helps users understand whether they are looking at:

- historical execution output
- a live process stream
- or an interactive shell

## Suggested UI Behaviors

### Compact Command Card

Fields:

- Command title or command preview
- Status: running / succeeded / failed / canceled
- Duration
- Timestamp
- Expand action
- Copy action
- Rerun action if supported

### Expanded Command View

Fields:

- Full command
- Scrollable output
- Exit code
- Environment/workspace context if relevant
- Actions:
  - Copy command
  - Copy output
  - Retry
  - Open as Terminal

### Persistent Terminal Panel

Should include:

- Session title
- Running indicator if background processes exist
- Close/unpin behavior
- Clear differentiation from one-shot task output

## Edge Cases

### Multiple Concurrent Commands

- Show each as a separate card or grouped task list
- Do not force one shared bottom pane to rapidly switch context

### Watchers / Dev Servers

- Detect long-running behavior and suggest promotion to persistent terminal mode

### Large Output

- Truncate initial preview
- Provide explicit expand/fullscreen/full-log access

### Background Runs

- Allow command to continue without forcing the user to keep the bottom panel open

## Success Metrics

### Quantitative

- Reduction in average persistent bottom panel open time during normal chat/coding flows
- Increased available vertical space for primary content
- Reduced manual panel close actions after successful command runs
- Improved interaction rate with command output history versus pinned terminal

### Qualitative

- Users report that the UI feels less crowded
- Users understand the difference between command output and terminal session
- Users can still find and inspect shell activity without confusion

## Rollout Plan

### Phase 1

- Introduce auto-collapse behavior for successful commands
- Keep failures expanded
- Add manual "Open Terminal" action

### Phase 2

- Split command output cards from persistent terminal panel conceptually and visually
- Add "Promote to Terminal" for long-running commands

### Phase 3

- Add user preference for visibility mode
- Refine multi-command activity/history UX

## Open Questions

- Should command output live primarily in the transcript, activity feed, or a transient dock?
- What duration threshold should trigger "long-running process" treatment?
- Should command history be global, per thread, or per task?
- Does the existing architecture already distinguish PTY-backed sessions from one-shot shell tool calls?

## Acceptance Criteria

- When no command is running and no terminal is pinned, the bottom terminal region does not occupy persistent layout space.
- When an LLM-triggered shell command starts, the user can see that command's status and output.
- When a short command succeeds, its expanded output does not continue occupying large layout space by default.
- When a command fails, the failure remains visible and easy to inspect.
- A user can explicitly open a persistent terminal session at any time.
- A long-running command can be converted into or continued within a persistent terminal surface.
- Users can inspect previous command output after completion without needing a permanently open bottom terminal.

## Recommendation Summary

The product should keep terminal capability, but stop treating the terminal panel as the default container for every shell event. Routine LLM shell activity should use transient or inline command output UI, while a persistent bottom terminal should become an explicit, user-controlled mode for cases that genuinely benefit from it.
