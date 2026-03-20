# Architecture Overview

This document describes the structure and design principles of the Iranti Control Plane. It is intended for developers who want to understand how the pieces fit together before contributing, extending, or debugging the system.

---

## System Diagram

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  Local Machine                                                  │
  │                                                                 │
  │  ┌──────────────────┐       ┌───────────────────────────────┐  │
  │  │  Iranti Runtime  │       │  Control Plane Server         │  │
  │  │  (port 3001)     │       │  (port 4000)                  │  │
  │  │                  │       │                               │  │
  │  │  Librarian       │       │  Express API server           │  │
  │  │  Attendant       │       │  /api/control-plane/*         │  │
  │  │  Archivist       │       │                               │  │
  │  │  Resolutionist   │       │  KB / Archive reader          │  │
  │  │                  │       │  Staff event adapter          │  │
  │  └────────┬─────────┘       │  Instance aggregator          │  │
  │           │                 │  Health aggregator            │  │
  │           │ reads/writes    │  SSE stream handler           │  │
  │           ▼                 └──────────────┬────────────────┘  │
  │  ┌──────────────────┐                      │                   │
  │  │  PostgreSQL       │◄─────────────────────┘ read-only SQL    │
  │  │  (port 5432)      │                                         │
  │  │                   │       ┌───────────────────────────────┐  │
  │  │  knowledge_base   │       │  Control Plane Frontend       │  │
  │  │  archive          │       │  (served from port 4000)      │  │
  │  │  entity_          │       │                               │  │
  │  │    relationships  │       │  React SPA                    │  │
  │  │  staff_events     │       │  Memory Explorer              │  │
  │  │                   │       │  Staff Activity Stream        │  │
  │  └───────────────────┘       │  Instance Manager             │  │
  │           ▲                  │  Health Dashboard             │  │
  │           │                  └──────────────┬────────────────┘  │
  │           │                                 │                   │
  │           └─────────── REST + SSE ──────────┘                   │
  │                                             │                   │
  │                                             ▼                   │
  │                                        Browser                  │
  │                                   http://localhost:4000         │
  └─────────────────────────────────────────────────────────────────┘
```

The control plane is entirely local. Nothing leaves the machine. There is no cloud service, no telemetry, and no authentication requirement in v1 — port binding on localhost is the sole access control mechanism.

---

## The Standalone Server

The control plane runs as a **separate process** from Iranti itself. This is an intentional design choice.

Iranti's runtime is already responsible for MCP serving, the Librarian, the Attendant, the Archivist, and the Resolutionist. Adding control plane responsibilities to the same process would increase its blast radius for bugs, slow its startup time, and create coupling between operational observability tooling and core memory infrastructure.

Instead, the control plane server is a lightweight Express application that connects to Iranti's existing PostgreSQL database as a read-only client. It:

- runs on port `4000` by default (configurable via `PORT` in `.env`)
- connects to PostgreSQL using the `DATABASE_URL` in its own `.env` file (typically the same value as Iranti's `.env.iranti`)
- serves both the REST API (`/api/control-plane/`) and the compiled React frontend from the same process
- requires no changes to the running Iranti runtime

The two processes are entirely decoupled at the process level. You can stop and restart the control plane without affecting Iranti, and vice versa. If Iranti is stopped while the control plane is running, the control plane shows `DB_UNAVAILABLE` errors on API calls and `"stopped"` on the health dashboard — it degrades gracefully.

---

## Read-Only by Design

The control plane **never writes to Iranti's core tables**.

This is not a convention or a code review guideline — it is an architectural invariant enforced by the API surface itself. Every endpoint in the control plane API is a `GET`. There are no `POST`, `PUT`, `PATCH`, or `DELETE` endpoints. The database user the control plane connects with should have `SELECT` permissions only.

The reason this invariant matters: Iranti's consistency model depends on all writes going through the Librarian. The Librarian handles conflict detection, confidence resolution, escalation, and Archivist coordination. Writing directly to `knowledge_base` or `archive` from an external process would bypass all of this and produce silently inconsistent state.

When Phase 2 adds write-capable features (for example, conflict resolution through the UI), those operations will call existing Iranti CLI/API/MCP pathways — they will never write to the database directly.

If you add a feature to the control plane backend, this is the check: does it write to any Iranti table? If yes, it must go through a supported operation, not a direct SQL write.

---

## The Staff Event Adapter

In Phase 1, the Staff Activity Stream is populated by a **Staff Event Adapter** — a component in the control plane backend that instruments the Librarian and Archivist by intercepting their operations and writing corresponding rows to the `staff_events` table.

This adapter exists because the upstream Iranti codebase does not yet have native event emission hooks. The proposed upstream changes (adding an `IStaffEventEmitter` interface to Librarian, Attendant, Archivist, and Resolutionist) are documented in `docs/specs/staff-event-model.md §6`, but they have not yet been implemented in the Iranti core.

**What the Phase 1 adapter covers:**

| Component | Events emitted |
|---|---|
| Librarian | `write_created`, `write_replaced`, `write_escalated`, `write_rejected` |
| Archivist | `entry_archived`, `entry_decayed`, `escalation_processed`, `resolution_consumed` |

**What the Phase 1 adapter does not cover:**

The Attendant and Resolutionist are not instrumented in Phase 1. Their event types (`handshake_completed`, `resolution_filed`, `resolution_applied`, etc.) will not appear in the stream until Phase 2.

**Phase 2 plan:** When Iranti adds native emitters to all four Staff components, the adapter layer becomes unnecessary. The control plane will receive events through the injected `IStaffEventEmitter` interface rather than by intercepting operations. The `staff_events` table and SSE stream infrastructure are unchanged — only the event production path changes.

The `staff_events` table schema (created by `npm run migrate`) is:

```sql
CREATE TABLE staff_events (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  staff_component TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  source          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  key             TEXT,
  reason          TEXT,
  level           TEXT NOT NULL,
  metadata        JSONB
);
```

---

## The Visual System — Option B Terminals

The frontend uses a deliberate token-based visual system called **Option B: Terminals**. It was selected over a generic dashboard approach specifically to avoid the flat, colorless look of most admin tools.

The token system is defined in `docs/specs/visual-tokens.md` and implemented in `src/client/src/styles/tokens.css`. All visual decisions — colors, spacing, typography, density — are expressed as CSS custom properties on `:root` (dark mode, the default) and overridden on `[data-theme="light"]`.

**Why a token system matters here:**

- Theme switching (light/dark) works automatically for any component that uses token variables. No JavaScript needed for theme application.
- Every component is written against semantic token names (`--color-bg-surface`, `--color-status-warning`, `--color-staff-librarian`), not hardcoded hex values. This means visual changes can be made by updating `tokens.css` without touching component code.
- The four Staff component colors (amber for Librarian, violet for Attendant, sky blue for Archivist, mint for Resolutionist) are tokens, making them globally consistent across the Memory Explorer, Activity Stream, and any future views.

**Key design decisions in the token system:**

- Dark mode is the default. The canvas is a near-black `#0D1117`; panels are `#161B22`. These are deliberately cool-tinted, not gray. They read well at data-table density.
- The accent color is emerald/mint (`#10B981`). Used sparingly — only for active/selected states and primary CTAs. Not decorative.
- Typography uses system fonts (SF Pro on macOS, Segoe UI on Windows). Zero network cost, excellent at 12–13px data density.
- Monospace font (`Cascadia Code` preferred) is used for entity IDs, key names, and raw JSON values. This preserves the technical character of the data without requiring a code editor.

**To extend the token system:**

Add new tokens to `src/client/src/styles/tokens.css` in both the `:root` block (dark values) and the `[data-theme="light"]` override block. Follow the naming convention (`--color-{category}-{role}`). Reference new tokens in component `.module.css` files, never hardcode hex.

---

## Phase 1 Known Limitations

The following are accepted Phase 1 limitations. They are not bugs — they are deliberate scope decisions that will be addressed in Phase 2 or later.

**1. No entity aliases.** The `entity_aliases` table does not exist in the current Iranti schema. The entity detail response always returns `entity: null`. Entity navigation requires knowing the exact `entityType/entityId`. Alias lookup and display names are deferred pending upstream schema additions.

**2. Project bindings are partially stubbed.** The instance metadata aggregation relies on Iranti maintaining a `~/.iranti/instances.json` registry. If the registry doesn't exist, the control plane falls back to scanning a narrow set of candidate paths. This may miss instances in non-standard locations. A reliable project binding registry is a proposed upstream change (see `docs/specs/instance-metadata-aggregation.md §7`).

**3. Attendant and Resolutionist events are absent.** The Staff Event Adapter in Phase 1 instruments only the Librarian and Archivist. Attendant session events and Resolutionist conflict resolution events will not appear in the Activity Stream until Phase 2.

**4. No authentication.** The API is served on localhost with no token-based auth. This is appropriate for a local-only tool. Before any non-local deployment, authentication must be added.

**5. Search uses substring matching.** The `search` parameter on `/kb` and `/archive` uses `ILIKE %term%`. This is not ranked search and will produce false positives for common substrings in long JSON values. Full-text search (tsvector) is Phase 2.

**6. Provider credit/quota visibility is absent.** FR8 from the PRD (displaying provider balance, credits, and quota) requires a per-provider capability matrix and upstream API calls. This is deferred — the health dashboard shows only key presence, not balance.

**7. Embedded chat is absent.** The embedded Iranti Chat panel (FR6) is a Phase 2 feature. The control plane does not include a chat interface in Phase 1.
