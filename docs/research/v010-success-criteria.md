# Iranti Control Plane — v0.1.0 Success Criteria (User Perspective)

**Author:** user_researcher
**Date:** 2026-03-20
**Phase:** Phase 1 research
**Source:** PRD `docs/prd/control-plane.md`, persona profiles, JTBD analysis, usability risk assessment

---

## Purpose

This document defines what "good enough to test" means for v0.1.0 from the user's perspective — not from a technical completeness standpoint. A feature can be implemented and still fail this bar if it confuses users, produces misleading outputs, or fails to actually complete the job it claims to support.

These criteria are the evidence the PM needs to accept Phase 1 as ready for design partner testing. QA should treat these as acceptance tests. The frontend and backend developers should use them as north-star constraints during implementation.

---

## The Single Most Important Thing for v0.1.0

**"What does Iranti currently know?"**

If a user can open the control plane, navigate to Memory Explorer, and get a real, accurate, navigable answer to this question in under 30 seconds — without using SQL, Adminer, or the terminal — then v0.1.0 is ready to test.

Everything else in this document is supporting criteria around that core.

---

## Must Be True Before Handing to Users

The following criteria are binary: either they are true or v0.1.0 is not ready to test. Each is observable and verifiable without user interpretation.

---

### Criterion 1: Health Dashboard Is Legible to a New User

**Statement:** A new user can open the control plane, land on the Health dashboard as their first screen, and understand what each check means — including any checks that are failing or warning — without consulting documentation.

**Verification method:**
- Give an Iranti user who has not seen the control plane before access to a running instance.
- Ask them: "What does each item on this screen tell you?"
- Ask them: "Is Iranti working right now?"
- Ask them: "Is there anything you need to fix?"

**Pass condition:**
- User correctly identifies that Iranti is operational (if it is) based on the health display.
- User correctly identifies the severity of any warnings — does not interpret an informational item as a blocking problem.
- User correctly identifies at least one actionable failing check (if any exist in the test scenario).
- User does not express confusion about what any check means.

**Fail condition:**
- User interprets a non-critical warning as a system failure.
- User is unsure whether Iranti is running.
- User asks "what does this check mean?" about more than one item.
- User cannot distinguish between a critical failure and an informational item.

**Notes:**
- This criterion requires the health severity taxonomy (Critical / Warning / Informational / Healthy) to be implemented and labeled correctly.
- The "provider balance unavailable" case must display as informational, not as a warning.
- See Usability Risk 5 in `phase1-usability-risks.md` for implementation guidance.

---

### Criterion 2: Memory Explorer Delivers Fact Discovery in Under 30 Seconds

**Statement:** A user with a running Iranti instance that has at least some memory data can open Memory Explorer and find at least one relevant fact within 30 seconds, without being told what to search for, and without assistance.

**Verification method:**
- Give an Iranti user (Marcus or Priya persona equivalent) access to a control plane connected to their actual Iranti instance.
- Say: "Using Memory Explorer, find something Iranti knows about your work."
- Measure time from landing on Memory Explorer to successfully identifying and opening a fact.

**Pass condition:**
- User finds and opens a fact within 30 seconds of first navigating to Memory Explorer.
- The fact displays: entity, key, value or summary, confidence, source, createdBy, validFrom.
- User does not need to type SQL, open a terminal, or consult documentation to find the fact.

**Fail condition:**
- User cannot find any fact within 30 seconds.
- User finds a fact but cannot interpret the displayed metadata.
- Search or filter does not return results that the user's entity actually has in the KB.
- The view loads empty with no explanation and no path to finding data.

**Notes:**
- This criterion requires the empty-state design (Risk 1 in the usability risk document) to be resolved.
- The search and filter interactions must work against actual `knowledge_base` data — not a static fixture.
- Performance: the Memory Explorer table must load initial results within 3 seconds on a local machine.

---

### Criterion 3: Staff Activity Stream Shows Real Events in Near-Real-Time

**Statement:** The Staff Activity Stream shows at least Librarian write events in near-real-time — where "near-real-time" means within 5 seconds of the write occurring. The stream is clearly labeled to show which Staff components are instrumented and which are not yet connected.

**Verification method:**
- Open the Staff Activity Stream in the control plane.
- In a separate terminal, run an `iranti write` command to create a fact.
- Observe the stream.

**Pass condition:**
- A Librarian write event appears in the stream within 5 seconds of the CLI write completing.
- The event shows: Staff component label ("Librarian"), action type ("write created" or equivalent), entity, key, agent id, source, and timestamp.
- The stream header or sidebar clearly indicates which Staff components are streaming and which are not.
- If Archivist or Attendant events are not yet instrumented, this is labeled explicitly (not silently absent).

**Fail condition:**
- No event appears within 30 seconds of a confirmed `iranti write`.
- The event appears but shows placeholder data (e.g., null entity, missing timestamp).
- The stream claims to show "all Staff events" but does not (undisclosed gap).
- The stream shows only a static list with no live update capability.

**Notes:**
- If the Phase 0 event bus is not complete enough to support real-time streaming by Phase 1 ship, the team must decide whether to delay Phase 1 or ship with a polling-based fallback with a clearly labeled refresh interval.
- A polling-based stream with a 10-second refresh interval is acceptable for v0.1.0 if labeled: "Refreshes every 10 seconds." It is not acceptable to present polling as real-time streaming.
- See JTBD Job 3 and Usability Risk 2 for context.

---

### Criterion 4: Instance Manager Correctly Shows the Local Instance and Its Env Key Completeness

**Statement:** The Instance Manager shows at least one instance (the local instance) with accurate runtime root path, database connection target, port, and a correct assessment of `.env.iranti` key completeness — specifically whether the required keys are present (not their values).

**Verification method:**
- Open the Instance Manager.
- Compare the displayed instance information against the actual `.env.iranti` file for that instance.
- Remove one required key from `.env.iranti`, save, and refresh the Instance Manager.

**Pass condition:**
- Instance shows: runtime root path, database target (host + db name), configured port, running/stopped status.
- Env key completeness shows at minimum: which required keys are present vs missing, without exposing key values.
- After removing a key and refreshing, the completeness indicator updates to reflect the missing key.
- If Claude integration is configured (`.mcp.json` exists), this is shown as "present."

**Fail condition:**
- Instance shows incorrect runtime root path.
- Env key completeness shows "complete" when a required key is missing.
- Status shows "running" for a stopped instance (or vice versa) without a staleness indicator.
- The view does not update when the underlying config file is changed (within a reasonable refresh window).

**Notes:**
- Required keys for completeness check should be defined in a canonical list maintained by the backend — not hardcoded in the frontend.
- This criterion is directly tied to Priya's success definition and to Usability Risk 3.

---

### Criterion 5: Light and Dark Mode Both Look Intentional

**Statement:** Both light and dark mode themes appear intentionally designed — not like broken or unstyled CSS, and not like a generic admin dashboard with default Bootstrap or Tailwind colors. A user who cares about visual quality should be able to say "this was designed" rather than "this was built."

**Verification method:**
- Open the control plane in light mode. Take a screenshot.
- Open in dark mode. Take a screenshot.
- Present both screenshots to a designer or design-literate user who did not build the product.
- Ask: "Does this look intentionally designed, or does it look like a default template?"

**Pass condition:**
- Reviewer says "intentionally designed" for both modes without prompting.
- The color system has a distinct visual identity — not the default grey/blue of Tailwind or Bootstrap out of the box.
- In dark mode, backgrounds are not pure #000000 (too stark) and foreground text is not pure #FFFFFF (hard to read at length).
- In light mode, backgrounds are not pure #FFFFFF and text is not the default browser black.
- Data density tables (Memory Explorer) are readable in both modes without requiring color as the only differentiator.
- Warn / Fail / Healthy states in Health dashboard are distinguishable in both modes for users with color vision deficiency (do not rely on red/green alone).

**Fail condition:**
- Reviewer says "this looks like a starter template" or "this looks unstyled."
- Either mode has obvious contrast issues (white text on light background, dark text on dark background).
- The visual system uses only default framework colors with no customization.
- Dark mode is clearly an afterthought (e.g., one mode has visual polish, the other does not).

**Notes:**
- The PRD is explicit: "Visual design should be intentional in both light and dark mode. Generic dashboard colors are not acceptable."
- This criterion does not require a custom design system from scratch — it requires that the chosen design system be applied with intent and customization.
- See PRD Experience Requirement ER4.

---

## Acceptable Phase 1 Gaps — Communicate to Users Upfront

The following are known gaps in Phase 1. They must be communicated to design partners at the start of testing so that the absence of these features is not interpreted as a bug.

| Gap | User impact | Communication approach |
|-----|-------------|----------------------|
| No project binding detail view | Priya cannot drill into binding configuration | "Project bindings show status only — detail view in Phase 2" |
| No Attendant or Resolutionist events in the stream | Dev cannot see full Staff activity | Labeled in stream header: "Coverage: Librarian ✓ | Others: Phase 2" |
| No entity aliases | Search by alias name won't work | Note in Memory Explorer search: "Alias search coming in Phase 2" |
| No write operations from the UI | User cannot correct a stale fact from the control plane | Read-only label in shell: "Read-only view — writes via CLI or Chat" |
| No embedded Chat | Operator workflow requires terminal for chat | Not shown in UI; mention in onboarding note |
| No conflict review UI | Dev cannot resolve escalations from the control plane | "Escalation review UI ships in Phase 2" — link to CLI escalation command |
| No provider configuration | User cannot change default provider from the UI | Provider shown in Health as read-only; change via CLI with docs link |
| No guided install flow | New users still need CLI-based setup | Onboarding note: "Setup guide in Phase 2; see docs for current install" |

These gaps are not failures. They are scope decisions. Design partners who know them in advance will give feedback on Phase 1's actual scope rather than filing Phase 2 features as Phase 1 bugs.

---

## Recommended v0.1.0 Design Partner Release Notes Template

When handing v0.1.0 to design partners, include a one-page release note with:

1. **What you can do today:**
   - Inspect current memory (Knowledge Base and Archive)
   - View temporal history for any fact
   - Watch Librarian write events in near-real-time
   - See your instance configuration and env key completeness
   - Check system health without running `iranti doctor`

2. **What's coming in Phase 2 (not in this release):**
   - Embedded Chat
   - Conflict and escalation review UI
   - Provider and model configuration from the UI
   - Full Staff event coverage (Attendant, Archivist, Resolutionist)
   - Guided install flow

3. **Where to send feedback:** [feedback channel or form]

4. **Known issues to watch for:** [link to Phase 1 known issues list]

---

## Summary Scorecard

| Criterion | Verifiable? | Must pass before release? |
|-----------|-------------|--------------------------|
| Health dashboard legible to new user | Yes — user test | Yes |
| Memory Explorer: fact in 30 seconds | Yes — timed user task | Yes |
| Staff stream: real Librarian events in <5s | Yes — observable | Yes |
| Instance Manager: accurate env completeness | Yes — compare to file | Yes |
| Light and dark mode: intentionally designed | Yes — design review | Yes |

All five must pass. None of these criteria can be waived for v0.1.0.

---

*This document should be reviewed by the PM before v0.1.0 goes to design partners. If any criterion cannot be met, the PM should decide whether to delay the release or reduce scope further — not ship and hope users don't notice.*
