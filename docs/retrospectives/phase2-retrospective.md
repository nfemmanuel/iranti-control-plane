# Phase 2 Retrospective — Interactive Management

**Written by**: product_manager
**Date**: 2026-03-20
**Milestone**: v0.2.0-beta declared

---

## Overview

Phase 2 added the write surfaces, interactive panels, and onboarding MVP to the Iranti Control Plane. Eighteen tickets shipped across five delivery waves. The phase ran longer than the original estimate due to scope growth, upstream complexity, and the need for multiple bug-fix waves — but the output quality is high and every ticket cleared explicit PM acceptance criteria.

---

## What Shipped (All Tickets, In Order)

| ID | Title | Wave | Status |
|----|-------|------|--------|
| CP-T036 | Entity Detail and Temporal History Views | Wave 1 | PM-ACCEPTED |
| CP-T039 | staff_events migration | Wave 1 | PM-ACCEPTED |
| CP-T021 | Conflict and Escalation Review UI | Wave 1 | PM-ACCEPTED |
| CP-T022 | Provider and Model Manager (read-only) | Wave 1 | PM-ACCEPTED |
| CP-T024 | Command Palette (Cmd+K) | Wave 1 | PM-ACCEPTED |
| CP-T025 | Native Staff Emitter Injection (spec + upstream PR) | Wave 1 | PM-ACCEPTED |
| CP-T032 | Entity Relationship Graph View | Wave 2 | PM-ACCEPTED |
| CP-T033 | Integration Repair Actions UI | Wave 2 | PM-ACCEPTED |
| CP-T034 | Provider Credit and Quota Visibility | Wave 2 | PM-ACCEPTED |
| CP-T035 | Getting Started Screen and First-Run Onboarding | Wave 2 | PM-ACCEPTED |
| CP-T037 | Staff Activity Stream Live Mode UX | Wave 2 | PM-ACCEPTED |
| CP-T040 | v0.1.0 Release Notes + Known Issues | Wave 2 | PM-ACCEPTED |
| CP-T041 | memory-explorer.md review | Wave 2 | PM-ACCEPTED |
| CP-T042 | Command Palette — Inline Help and Command Documentation | Wave 3 | PM-ACCEPTED |
| CP-T046 | Provider Manager: Standalone View, Warning Thresholds, Health Banner | Wave 3 | PM-ACCEPTED |
| CP-T047 | Documentation Round 5: Getting Started Guide Polish | Wave 3 | PM-ACCEPTED |
| CP-T020 | Embedded Chat Panel | Wave 4 | PM-ACCEPTED 2026-03-20 |
| CP-T023 | CLI Setup Wizard (`iranti setup`) | Wave 4 | PM-ACCEPTED 2026-03-20 |

**Total: 18 tickets accepted.**

---

## What Took Longer Than Expected and Why

### CP-T020 — Embedded Chat Panel

The chat panel required more back-end plumbing than initially scoped. The Iranti `/chat/completions` proxy was not documented as a guaranteed stable API surface, so the implementation required exploratory spike work to confirm it was usable. The two-call pattern (attend + completions) was not obvious upfront and required architectural investigation. Additionally, the `env-defaults` endpoint was discovered to be a necessary companion API only after the initial implementation was in place. Multiple Wave 3/4 fix rounds were needed before end-to-end TypeScript cleanliness and live round-trip behavior were confirmed.

### CP-T023 — CLI Setup Wizard

The wizard's scope was refined significantly during implementation. The original plan assumed the wizard could hook into the Iranti CLI package; it was scoped down to a standalone `scripts/setup-wizard.js` with a `fresh-install-only` constraint after discovering the upstream CLI integration path required maintainer coordination. Warning filter behavior in the Node.js subprocess output handler was a late-breaking bug that took an additional fix wave. The macOS timing test (AC3) was accepted via user manual run rather than an automated benchmark, which was the right call but took coordination to confirm.

### Wave 4 and Wave 5 Fix Rounds

Phase 2 generated more post-implementation fix work than Phase 1. This was expected given the higher complexity of write surfaces and external system integrations, but the volume of small fix commits across Wave 4 and Wave 5 extended the phase by approximately two sessions. The quality bar was maintained — no fix was accepted without re-running TypeScript and existing test coverage.

### CP-T047 Documentation

Documentation consistently ran behind implementation. The Getting Started Guide required a full polish pass after the wizard and onboarding screen both shipped, and coordinating the technical writer pass with live feature state was non-trivial.

---

## What Went Well

**Delivery structure held.** All 18 tickets had explicit acceptance criteria before implementation started. No ticket was accepted without the PM checking each criterion. This prevented scope ambiguity from becoming integration debt.

**Parallel delivery.** Wave 2 and Wave 3 ran multiple frontend, backend, and documentation tickets in parallel without merge conflicts or cross-dependency failures. The workstream isolation from Phase 1 carried forward effectively.

**CP-T032 entity graph.** The pure SVG radial BFS graph was a clean implementation with no third-party graph library dependency. Delivered on first pass, all ACs met.

**CP-T033 integration repair.** The repair actions UI (mcp-json, claude-md, run doctor) shipped cleanly with a full audit trail. One of the higher-risk tickets in Phase 2 due to subprocess invocation; it landed without major rework.

**CP-T021 conflict review.** Resolutionist integration was the most uncertain ticket entering Phase 2 (the risk of a CLI-only resolution path was called out in the roadmap). The CP-D003 fix enabled routing and the ticket closed cleanly.

**CP-T046 provider manager.** The Together AI and Groq integrations, localStorage-based thresholds, and two-pane layout all shipped in a single implementation pass and were accepted on first review.

**Visual quality.** The Terminals palette held throughout Phase 2. No new views drifted to generic admin dashboard aesthetics.

---

## Key Technical Decisions Made

### Iranti /chat/completions Proxy Pattern

Rather than implementing a separate LLM call stack in the control plane backend, the chat panel routes through Iranti's own `/chat/completions` endpoint. This keeps the control plane's dependency surface minimal and ensures the chat panel benefits from Iranti's provider routing and credential management. The tradeoff is that the chat panel inherits any latency or availability issues from the Iranti instance itself — acceptable given the local-first deployment model.

### Two-Call Attend + Completions Pattern for Chat

The chat backend calls `attend` first to establish working memory context before each completions call. This was chosen over a stateless completions-only call because it makes Iranti's memory layer available to the conversation without requiring the control plane to manage context injection. The attend call adds a small latency overhead (~100–200ms) but produces meaningfully more contextually-aware responses.

### CP-T023 Fresh-Install-Only Scope

The CLI wizard was scoped to fresh installs only after confirming that retrofitting configuration to an existing installation introduced non-trivial risk of data loss or config corruption. The `setup-wizard.js` script detects existing installations and exits gracefully with instructions. This is the right call for v0.2.0-beta — a more sophisticated migration-aware wizard can be tackled in Phase 3 alongside proper packaging (CP-T048).

### Phase 3 Packaging Decision

Platform installer packages (MSI, DMG, DEB) were explicitly deferred to Phase 3 as CP-T048. The Phase 2 wizard validates demand signal; Phase 3 invests in distributable packaging only after user demand is confirmed through the wizard's real-world usage. This avoids investing in code signing, notarization infrastructure, and multi-platform CI before the wizard's value is proven.

### CP-T022 Write Path Deferral

The provider manager write path (mutating active provider/model configuration at runtime) was scoped to read-only for Phase 2. The Iranti configuration layer does not yet expose a stable programmatic write API for provider config. A runtime mutation approach without that API would require direct env file editing — which is fragile and not appropriate for a production operator surface. Phase 3 will revisit once either the upstream API surface stabilizes or a safe local config mutation path is designed.

---

## Known Carryover Items

### CP-T025 — Upstream PR External

The native Staff emitter injection PR is written and PM-approved for submission, but it is an upstream PR to the Iranti core package and is not within this project's control to merge. The polling fallback at 500ms interval is active and confirmed feasible. Phase 2 exit criteria counted this as "partially met" with explicit documentation of the external dependency. Carryover: system_architect should submit the upstream PR in Phase 3 and track its status. If rejected, the polling-only fallback becomes permanent until an alternative injection point is identified.

### CP-T023 — AC2 and AC3 Manual Verification Accepted by User

AC2 (step-by-step confirmation that wizard completes end-to-end on a clean machine) and AC3 (timing test: wizard under 3 minutes) were both verified through user-conducted manual macOS runs rather than automated QA benchmarks. This was explicitly accepted by the user as the verification method for v0.2.0-beta. For a future v0.3.0 or GA milestone, automated CI-driven wizard smoke tests on a clean environment image would be the appropriate upgrade.

---

## Phase 3 Readiness — What's On Deck

Phase 3 is formally unblocked as of Phase 2 completion. Three tickets are identified as the opening priorities:

**CP-T048 — Platform Installer Packages (MSI, .dmg, .deb)**
Delivers signed, distributable platform installer packages for Windows, macOS, and Linux. Includes a Homebrew Cask stretch goal for macOS. Assigned to devops_engineer. Blocked on Phase 2 wizard completion (now met). Non-trivial CI pipeline and code signing investment required.

**CP-T049 — Archivist Transparency**
Surface Archivist decisions, archive reasons, and conflict patterns in a dedicated transparency view. Operators currently have to spelunk archive tables to understand why facts were archived. This ticket makes archival reasoning first-class in the operator surface. Scope to be defined by PM before pickup.

**CP-T050 — Staff Logs View**
A dedicated view for raw Staff operational logs, filterable by component and severity. Supplements the live activity stream with a persistent, scrollable log history. Scope to be defined by PM before pickup.

---

## v0.2.0-beta Declaration

**v0.2.0-beta is declared as of 2026-03-20.**

All 18 Phase 2 tickets are PM-accepted. All Phase 2 exit criteria are either met or have documented, accepted carryover status. The control plane now supports:

- Full read surface across memory, archive, entities, relationships, health, instances, providers
- Interactive write surfaces: conflict review, integration repair, provider configuration (read-only)
- Embedded chat panel with two-call attend+completions pattern
- CLI setup wizard for fresh installs
- Command palette (Cmd+K) navigation
- Getting Started first-run screen
- Entity relationship graph
- Staff activity stream with live mode, pulse indicator, and velocity counter
- Phase 2 documentation complete

Phase 3 is the next phase. PM will define scope, sequence tickets, and issue assignments before any Phase 3 implementation begins.
