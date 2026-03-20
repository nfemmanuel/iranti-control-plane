# Iranti Control Plane — v0.2.0 Success Criteria (User Perspective)

**Author:** product_manager
**Date:** 2026-03-20
**Phase:** Phase 2 planning
**Source:** Phase 1 retrospective, persona Phase 2 evolution, JTBD Phase 2 addendum, user signal

---

## Purpose

This document defines what "good enough for design partner handoff" means for v0.2.0 from the user perspective. It is the Phase 2 equivalent of `v010-success-criteria.md`.

v0.1.0 established that the control plane could make Iranti memory legible. v0.2.0 must establish that the control plane makes Iranti *reasoning* legible — the full arc from "what does Iranti know" to "how did it know it, who decided it, when did it change, and what is the system doing right now."

---

## The Single Most Important Thing for v0.2.0

**"Watch Iranti work."**

If a user can open the control plane, start an agent session, watch Iranti process agent operations in real time — writes appearing in the stream within 1 second, temporal history navigable from any fact, entity relationships visible without SQL — and do all of this without Adminer, without a terminal, without SQL — then v0.2.0 is ready for design partners.

The v0.1.0 bar was "legible memory state." The v0.2.0 bar is "legible, live, complete reasoning." Dev (Power User) is the test persona. If Dev can replace his weekly Adminer session and his saved SQL queries with the control plane, v0.2.0 is ready.

---

## Must Be True Before Design Partner Handoff

### Criterion 1: Entity Detail and Temporal History Are Real Views

**Statement:** Navigating from Memory Explorer to an entity detail page renders a real, data-filled page. Clicking a fact key renders a real temporal history timeline with intervals in correct chronological order.

**Verification method:**
- Open Memory Explorer. Find a fact for any entity with at least one archived interval.
- Click through to entity detail.
- Click the fact key to open temporal history.

**Pass conditions:**
- Entity detail shows: entity header (entityType, entityId, fact count, last updated), current facts table (sortable), archived facts section (collapsible), relationships list.
- Temporal history shows: timeline newest-first, CURRENT badge on live fact, expand-to-raw-JSON per interval, human-readable archivedReason labels.
- Breadcrumb navigates back correctly.
- Both views handle loading, error, and empty states correctly.

**Fail conditions:**
- Either view renders a placeholder or "coming soon" message.
- Temporal history shows only the current fact with no archive intervals (when archive intervals exist for the key).
- `archivedReason` shows raw codes ("superseded") instead of human-readable labels ("Superseded by newer write").
- Back breadcrumb does not work.

**Ticket:** CP-T036 (Phase 2 P0)

---

### Criterion 2: Staff Activity Stream Feels Live During Agent Operations

**Statement:** When a user is actively running an agent (iranti_handshake, iranti_write, iranti_attend), Staff events from the relevant components appear in the stream within 1 second of the operation completing.

**Verification method:**
- Open Staff Activity Stream.
- In a separate terminal, run iranti_handshake. Observe the stream.
- Then run iranti write with a new fact. Observe.

**Pass conditions:**
- Attendant handshake event appears within 1 second of iranti_handshake completing. (Requires CP-T025.)
- Librarian write event appears within 1 second of iranti write completing.
- The pulse dot in the stream header animates actively during the event burst.
- Auto-scroll tracks the new events.
- Hovering over the stream shows "N new events" banner instead of auto-injecting events.

**Acceptable Phase 2 fallback (if CP-T025 upstream is blocked):**
- Librarian events still appear within 2 seconds (polling fallback active).
- Attendant events absent but explicitly labeled: "Attendant events require native emitter injection (upstream PR pending)."
- Stream does NOT claim full 4-component coverage if CP-T025 is not merged.

**Fail conditions:**
- Events take more than 5 seconds to appear.
- Stream must be manually refreshed to see new events.
- Stream claims "All Staff" coverage when Attendant/Resolutionist are not emitting.

**Tickets:** CP-T025 (data feed), CP-T037 (live mode UX)

---

### Criterion 3: New User Can Orient Without Instructions

**Statement:** A user who has just installed Iranti and opened the control plane for the first time can understand what to do next without reading docs, asking for help, or hitting confusing health warnings.

**Verification method:**
- Set up a fresh Iranti instance where at least one setup step (provider, project binding, or Claude integration) is incomplete.
- Give a new user access to the control plane with no instructions.
- Ask: "What should you do first to get Iranti fully working?"

**Pass conditions:**
- Getting Started screen appears automatically on first load.
- The first incomplete step is expanded and shows a plain-English action description.
- User correctly identifies what is incomplete and what to do, without asking for help.
- Shell header shows a setup badge when any step is incomplete.

**Fail conditions:**
- User lands on Health dashboard with a Critical error and no guidance.
- User does not know what the Critical error means or how to fix it.
- Getting Started screen does not appear on first load.
- Setup steps are listed but none have actionable instructions.

**Ticket:** CP-T035 (Phase 2 P0)

---

### Criterion 4: Entity Relationships Are Navigable

**Statement:** For an entity with relationships (entries in entity_relationships), the entity detail page shows those relationships with working navigation to related entity detail pages.

**Verification method:**
- Navigate to an entity with at least 3 relationships.
- Open the entity relationships view.

**Pass conditions (graph shipped):** Graph renders showing entity and related entities as nodes with edges. Clicking a node navigates to that entity detail. Relationship types labeled on edges.

**Pass conditions (graph not yet shipped):** Flat list with working links to each related entity detail page — clicking navigates correctly.

**Fail conditions:** Relationships show only as a list with no navigation to related entities.

**Ticket:** CP-T032 (depends on CP-T036 completing first), or CP-T036 relationships section as fallback

---

### Criterion 5: Dev (Power User) Can Replace His Weekly Adminer Session

**Statement:** Dev can answer all 5 of the following questions using only the control plane — no Adminer, no SQL, no terminal:

1. "What does Iranti currently believe about entity X?" — Memory Explorer, entity detail
2. "When did this fact change, and why?" — Temporal history timeline
3. "What entities are related to X?" — Relationships view
4. "What did the Librarian do with my last write?" — Staff Activity Stream
5. "Is my Iranti instance healthy right now?" — Health dashboard

**Verification method:**
- Give Dev (or a Dev-equivalent user) access to a control plane connected to their actual instance.
- Ask them to answer each of the 5 questions without opening Adminer or a terminal.
- Measure: time per question, number of times they say "I would normally use SQL for this."

**Pass conditions:**
- Dev answers all 5 questions without SQL or Adminer.
- Time-to-answer per question is under 60 seconds.
- Dev says (unprompted) something equivalent to "this is better than what I had."
- Dev does not open Adminer during the session.

**Fail conditions:**
- Dev cannot answer any of the 5 questions without SQL.
- Dev finds a data discrepancy between the control plane and Adminer (accuracy failure).
- Dev opens Adminer to double-check anything the control plane showed.

This criterion is the v0.2.0 definition of done from a user research perspective. If Dev passes this test, Phase 2 has achieved its core product goal.

---

## Acceptable Phase 2 Gaps — Communicate to Design Partners

| Gap | User impact | Communication approach |
|-----|-------------|----------------------|
| Resolutionist events in stream | Cannot watch Resolutionist activity live | Labeled: "Resolutionist events: upstream PR pending" |
| No write operations from UI | Cannot correct a stale fact from control plane | Read-only label; "Write via CLI or iranti chat" |
| No multi-instance data isolation | All views bound to single running backend | Architecture note: "Multi-instance data scoping is Phase 3" |
| No diff view between history intervals | Must read two raw values side by side | "Value diff view is Phase 3" |
| No full-text search in fact values | Search is entity/key only | "Value content search is Phase 3" |
| Conflict review UI (if CP-T021 not shipped) | Cannot resolve escalations from control plane | "Escalation review UI in Phase 3" |

---

## Phase 2 Design Partner Release Notes Template

**What you can do today (v0.2.0):**
- Inspect current memory with full entity detail: facts, archive history, relationships
- Navigate temporal history for any fact — every interval, archive reason, supersession chain
- Watch Staff work live: Librarian and Archivist events with <2s polling; Attendant and Resolutionist <200ms if CP-T025 upstream merged
- Orient as a new user with the Getting Started guided flow
- Repair broken integrations from the UI (mcp-json, claude-md, run doctor)
- See entity relationships as a navigable graph

**What is coming in Phase 3:**
- Multi-instance data isolation and side-by-side comparison
- Full-text search across fact values
- Value diff view between adjacent history intervals
- Persistent embedded chat history
- Signed macOS installer / Homebrew formula

---

*This document is the PM acceptance bar for Phase 2. QA should treat each criterion as an explicit acceptance test before v0.2.0 design partner handoff.*
