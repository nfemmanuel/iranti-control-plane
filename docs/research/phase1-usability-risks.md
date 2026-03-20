# Iranti Control Plane — Phase 1 Usability Risk Assessment

**Author:** user_researcher
**Date:** 2026-03-20
**Phase:** Phase 1 research
**Source:** PRD `docs/prd/control-plane.md`, persona profiles, JTBD analysis

---

## Overview

This document identifies the top usability risks in Phase 1 of the Iranti Control Plane — conditions that could make the product feel broken or misleading even when it is technically functioning correctly. These risks are grounded in the specific Phase 1 implementation scope and the three operator personas.

Each risk is assessed for severity using likelihood × user impact. Mitigations are actionable items for the team to address before v0.1.0 ships to design partners.

---

## Risk 1: Empty State Looks Like a Broken App

**Risk description**
A user opens the control plane with a freshly installed or empty Iranti instance and sees empty tables, blank timeline views, and a Staff Activity Stream with no events. Because there is no empty-state UI guidance, the user cannot distinguish between "Iranti has no memory yet" and "the control plane failed to connect to my instance" or "I configured something wrong."

**Affected personas**
- Marcus (Solo Dev) — high likelihood; he may have a sparsely populated instance
- Priya (Tech Founder) — medium likelihood; her test instances may have little data
- Dev (Power User) — low likelihood; he has substantial data

**Trigger scenario**
1. User opens control plane on a new or lightly-used Iranti instance.
2. Memory Explorer shows an empty table. No explanation. No call to action.
3. Staff Activity Stream shows "No events" with no indication of whether streaming is connected or whether the instance has never had a write event.
4. Health dashboard shows all green but the user doesn't know to look there first.

This is especially acute if the user opened the control plane specifically because something seemed wrong — an empty table confirms their anxiety without resolving it.

**Severity: High**
Likelihood: High (any new or test instance will trigger this). User impact: High (causes fundamental trust failure in the product). Empty states are one of the most common reasons first-time users abandon a tool after the first session.

**Mitigation**
- Design explicit empty states for Memory Explorer, Archive Explorer, and Staff Activity Stream that distinguish between: (a) "connected, no data yet," (b) "not connected — check Health," and (c) "filtered results returned nothing"
- Add a connection status indicator in the shell header: green dot if Iranti API is reachable, red dot with message if not
- On first load with no memory data, surface a contextual prompt: "No facts in memory yet. Write your first fact using `iranti write` or open Iranti Chat."
- The Health dashboard should be the first screen and should prominently confirm: "Connected to instance at [path] — [N] facts in memory"
- Add a "why is this empty?" affordance (expandable explanation, not a modal) to empty table states

---

## Risk 2: Staff Activity Stream Shows Only Librarian Events — User Expects Full Staff Visibility

**Risk description**
The PRD explicitly acknowledges that Phase 0 needs to deliver the structured Staff event bus before Phase 1 can stream full Staff activity. In practice, Phase 1 will likely have reliable Librarian write events but limited or no Attendant, Archivist, or Resolutionist events — depending on how much event adapter work gets done. A user who opens the Staff Activity Stream expecting to "watch the Librarian, Attendant, Archivist, and Resolutionist" (as described in the PRD Job 3 language) will see a partial stream and may assume the missing components are broken, not that they're not yet instrumented.

**Affected personas**
- Dev (Power User) — highest impact; he specifically wants Archivist observability and will notice gaps
- Marcus (Solo Dev) — medium impact; he wants passive reassurance that "something is happening"
- Priya (Tech Founder) — medium impact; she's evaluating product completeness

**Trigger scenario**
1. User opens Staff Activity Stream and sees Librarian write events.
2. User looks for Archivist events after running a retention scenario or waiting for the decay cycle.
3. No Archivist events appear. User assumes: (a) the Archivist is broken, (b) the stream is broken, or (c) their Iranti instance has a problem.
4. In reality, the Archivist adapter is not yet instrumented.

**Severity: High**
Likelihood: High (Phase 0 event bus is a known gap; Archivist/Resolutionist instrumentation is the hardest part). User impact: High (directly undermines the core promise of Staff observability; causes incorrect mental models about system health).

**Mitigation**
- In the Staff Activity Stream header or sidebar, display a clear "Event coverage" status: which Staff components are instrumented and streaming vs which are not yet connected
- Label the stream explicitly: e.g., "Showing events from: Librarian ✓ | Archivist (coming soon) | Attendant (coming soon) | Resolutionist (coming soon)"
- This framing transforms a gap into a roadmap signal rather than a failure signal
- Do not imply full Staff observability in any onboarding copy, health screen labels, or marketing text for Phase 1
- In the Staff Activity Stream, add a dismissible banner for v0.1.0: "Phase 1 streams Librarian events. Full Staff observability ships in Phase 2."
- Prioritize Archivist event instrumentation in Phase 0/early Phase 1 since it directly enables the temporal history use case Dev cares about most

---

## Risk 3: Instance Health Shows "Unknown" or Stale Status — User Cannot Trust the Display

**Risk description**
The Instance Manager performs health probes to determine whether each instance is running. If a probe times out, fails silently, or returns stale data, the control plane may display "running: unknown," "status: checking…" indefinitely, or an incorrect status. A user who opens the control plane specifically to verify that their instance is healthy cannot trust a display that shows uncertain or stale state.

This is distinct from the instance actually being unhealthy — it's the control plane failing to accurately report a state it should know.

**Affected personas**
- Priya (Tech Founder) — highest impact; she's evaluating multi-instance management as a capability
- Marcus (Solo Dev) — medium impact; he will interpret "unknown" as "something is wrong"
- Dev (Power User) — lower impact; he knows to check directly, but will still note it as a product flaw

**Trigger scenario**
1. User opens Instance Manager with two instances registered.
2. One instance has its Iranti runtime stopped (it's not actively running).
3. Health probe for the stopped instance times out after a long wait.
4. Display shows "status: checking…" for 10+ seconds, then either shows "unknown" or shows a misleading stale cached value ("running") from a previous session.
5. User doesn't know: is the instance actually stopped, or is the probe broken?

A secondary trigger: the control plane probes health on page load and caches the result. User leaves the page open for 2 hours. Returns to see a health status that hasn't refreshed. Instance state may have changed.

**Severity: High**
Likelihood: Medium-high (stopped instances and long-running control plane sessions are common). User impact: High (health status is a trust signal; misleading status erodes confidence in the entire product).

**Mitigation**
- Show a "last checked" timestamp next to every health status: "Running — checked 2 min ago"
- Probe timeout must result in "unreachable" (specific, honest) not "unknown" (ambiguous)
- Distinguish explicitly: "unreachable" (probe tried, no response) vs "not configured" (no connection info) vs "stopped" (explicit shutdown signal)
- Add a manual "Refresh" button for health probes — don't rely solely on automatic refresh
- Set a maximum stale window: if health data is older than 5 minutes, show a visual warning ("Status may be stale — click to refresh")
- Never show "Running" for a status that was last probed more than 10 minutes ago without a staleness indicator

---

## Risk 4: Temporal History Missing Archive Intervals — Looks Incomplete or Wrong

**Risk description**
The temporal history timeline in Memory Explorer must pull data from both `knowledge_base` (current facts) and `archive` (superseded, contradicted, expired, and decayed intervals). If the backend implementation for Phase 1 only queries `knowledge_base` — or if the JOIN to `archive` is incomplete — the timeline will show only the current value, with no history. A user expecting to see "how this fact changed over time" will see a timeline with a single entry and conclude either that the fact never changed (incorrect) or that the feature is broken.

**Affected personas**
- Dev (Power User) — highest impact; temporal history is his primary Phase 1 job; he will immediately notice if archived intervals are missing
- Marcus (Solo Dev) — medium impact; he may not know what he's missing, but a single-entry timeline will feel unhelpful
- Priya (Tech Founder) — medium impact; she's evaluating the product's consistency model; a flat history undermines her confidence

**Trigger scenario**
1. Dev opens the entity detail page for a frequently-updated fact (e.g., his "active project" entity).
2. He knows this fact has been written 4 times over 3 months.
3. The temporal history timeline shows 1 entry: the current value.
4. Either: the backend is only querying `knowledge_base`, or the `archive` JOIN is missing the `archivedReason` filter, or the timeline component isn't rendering historical rows.
5. Dev checks Adminer. Confirms 3 archived intervals exist. Files a bug.

**Severity: High**
Likelihood: Medium (this depends entirely on backend implementation care, but it's easy to accidentally omit the archive JOIN). User impact: Very high for Dev, medium for others. The temporal history view is the feature most likely to reveal implementation gaps.

**Mitigation**
- Backend acceptance test: for any fact that has archive records, the temporal history endpoint must return all intervals including archived ones
- QA should seed a test entity with deliberate supersession events and verify the timeline shows all intervals before v0.1.0 ships
- If archive data is empty for an entity, the timeline must say "No history — this fact has not been superseded or archived" (not just show nothing)
- The timeline component should visually distinguish current (bold/highlighted) from archived intervals (muted, with archive reason label) so the user can orient themselves without reading every row
- Product note: the `archivedReason` values must be rendered as human-readable labels ("Superseded by newer write," "Contradicted by conflicting source," "Decayed by Archivist") — not raw enum codes

---

## Risk 5: Health Dashboard Shows Warnings for Non-Critical Conditions — User Interprets as System Failure

**Risk description**
The Health and Diagnostics screen is the first screen new users see after install. If it shows "warn" or "fail" states for conditions that don't actually prevent Iranti from functioning — for example, a missing optional provider key, a "version behind latest" warning, or a "no escalations directory" message for a clean install — a new user may interpret these as blocking problems and spend time debugging a non-issue before Iranti even has a chance to show its value.

The PRD notes this concern: provider credit warnings should not erode trust when Iranti is fully operational.

**Affected personas**
- Marcus (Solo Dev) — highest impact; he needs reassurance that Iranti is working; "warn" lights will send him to the terminal looking for problems
- Priya (Tech Founder) — medium impact; she's evaluating product quality; noisy warnings signal immaturity
- Dev (Power User) — low impact; he understands which warnings are noise

**Trigger scenario**
1. New user opens control plane for the first time, immediately landing on Health dashboard (as PRD recommends).
2. They see: ✓ Database connected, ✓ Vector backend reachable, ⚠ Anthropic API balance unavailable (provider doesn't expose this data), ⚠ No escalations directory detected, ⚠ Runtime version 0.12.1 — latest is 0.12.3.
3. User's mental model: "Three warnings. Something is wrong. I should fix these before continuing."
4. Reality: Iranti is fully operational. The "balance unavailable" warning is expected (Anthropic doesn't expose credits via API). The "no escalations directory" is expected for a clean install. The version gap is minor and non-breaking.
5. User spends 30 minutes trying to "fix" these warnings. Nothing changes. They lose confidence in the product.

**Severity: High**
Likelihood: High (provider balance unavailability is near-certain for Anthropic; version gaps are always present; escalations directory warning will appear for all clean installs). User impact: High (the first screen a user sees; a noisy first screen can end a session before it starts).

**Mitigation**
- Implement a strict severity taxonomy for health checks:
  - **Critical** (red): Iranti cannot function. Examples: database unreachable, no provider configured at all.
  - **Warning** (amber): Iranti is functional but something may degrade a specific capability. Examples: provider balance unknown (clearly labeled as "data unavailable, not a failure"), version behind latest.
  - **Informational** (blue/grey): Expected state for a clean or partial setup. Examples: no escalations directory (expected if no conflicts have occurred), no project bindings yet.
  - **Healthy** (green): All checks passed.
- Never show an amber warning for a condition that is expected and harmless — use informational instead
- Each warning and informational item must have a one-line plain-English explanation and, where applicable, a "learn more" link or "dismiss as expected" action
- The health summary header should show the highest-severity state: if database is connected and Iranti is running, the top-level status should say "Operational" even if there are informational items below
- Provider balance checks that return "data unavailable" should be labeled: "Balance visibility not supported by this provider — this is expected" — not "⚠ Balance check failed"

---

## Additional Risk: Identified During Analysis

### Risk 6: Instance Context Unclear When Switching Between Views

**Risk description**
If a user is inspecting Memory Explorer for Instance A and then navigates to Staff Activity Stream, the stream may show events from all instances or from the wrong instance, depending on how instance context is passed across views. A user who doesn't realize the context switched will read data from the wrong instance and draw incorrect conclusions.

**Affected personas**
- Priya (Tech Founder) — highest impact; she's specifically evaluating multi-instance behavior
- Dev (Power User) — high impact; he has 3 instances

**Trigger scenario**
User selects Instance B in the Instance Manager, navigates to Memory Explorer (correctly shows Instance B data), navigates to Staff Activity Stream — which defaults to "all instances" or reverts to Instance A.

**Severity: Medium**
Likelihood: Medium (depends on state management implementation). User impact: High if it occurs undetected.

**Mitigation**
- Instance context must be a persistent, always-visible UI element in the shell header: "Instance: [runtime-root-path or friendly name] ▼"
- Changing instance context from the header selector must update all views simultaneously
- Views that cannot be instance-scoped (e.g., a global health summary across all instances) must be explicitly labeled "All instances" to distinguish from single-instance views
- QA test: select Instance B, navigate through all Phase 1 views, verify every data-bearing view shows Instance B data

---

## Risk Summary Table

| # | Risk | Severity | Likelihood | Impact | Must fix before v0.1.0? |
|---|------|----------|-----------|--------|------------------------|
| 1 | Empty state looks broken | High | High | High | Yes |
| 2 | Staff stream shows partial Staff, looks broken | High | High | High | Yes — label coverage |
| 3 | Instance health shows unknown/stale | High | Medium-High | High | Yes |
| 4 | Temporal history missing archive intervals | High | Medium | Very High (Dev) | Yes |
| 5 | Health dashboard shows noise as warnings | High | High | High | Yes |
| 6 | Instance context unclear across views | Medium | Medium | High | Yes — verify in QA |

All six risks are addressable with design and QA decisions before v0.1.0. None require architectural changes — they are all about the presentation layer's honesty and the backend's query completeness.

---

*Review this document with the frontend and backend developers during Phase 1 implementation handoff. Each risk maps to a specific acceptance test that QA should verify before v0.1.0 release.*
