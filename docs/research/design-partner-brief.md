# Iranti Control Plane — Design Partner Brief (v0.1.0)

**Document type:** Design partner handoff brief
**Produced by:** user_researcher
**Date:** 2026-03-20
**Audience:** Design partner participants (Marcus archetype, Priya archetype, Dev archetype)
**Status:** Ready for handoff — pending v0.1.0 hold lift (CP-D001 fix + QA sign-off)

---

## What is Iranti Control Plane v0.1.0?

- **A browser UI for your local Iranti instance.** It runs on your machine, connects to your database, and shows you what Iranti knows — without requiring SQL, Adminer, or terminal spelunking.
- **An operator surface, not a configuration tool.** v0.1.0 is read-primarily: you can inspect memory, watch Staff activity, check system health, and manage instances. Editing or writing facts from the UI is not in scope for v0.1.0.
- **Built for the three questions Iranti users ask most.** "What does Iranti currently believe?" "When did that change, and why?" "Is my instance healthy right now?" Every Phase 1 view is designed to answer one of these without SQL.

---

## What You Can Do Today (v0.1.0)

The following actions are available in the current release. These are specific capabilities, not marketing copy.

**Memory Explorer:**
- You can search for any entity by name or keyword and see all current facts for that entity.
- You can see each fact's value, confidence tier, source, createdBy, and validFrom timestamp on a single row — no drill-down required for the basics.
- You can expand any fact row to read the full raw JSON value inline.
- You can click through to an entity detail page that shows all current facts for that entity grouped together.
- You can browse the archive table to see facts that have been superseded, contradicted, or expired.
- You can filter the Memory Explorer by entity type, key name, confidence range, and Staff component.

**Temporal History (CP-T036):**
- You can navigate from any fact to its full temporal history — every validity interval from earliest to current, in chronological order.
- You can read human-readable archive reason labels (e.g., "Superseded by newer write," "Contradicted by higher-confidence fact") rather than raw codes.
- You can expand any historical interval to read its full raw JSON value.
- You can see the supersession chain — which fact replaced which.

**Staff Activity Stream:**
- You can watch Librarian write events appear in real time as facts are written to memory.
- You can filter the stream by Staff component (Librarian, Archivist, Attendant, Resolutionist) and by entity.
- You can click any stream event to jump to the affected fact in Memory Explorer.
- Note: Attendant and Resolutionist events require a native emitter integration (upstream PR pending). Librarian and Archivist events are live. The stream labels which components are actively emitting.

**Health and Diagnostics:**
- You can see a consolidated health check for: database reachability, provider credential presence, vector backend status, and runtime version.
- You can see each check with a pass / warn / fail state and a plain-English explanation.
- You can see your provider's reachability status with a last-checked timestamp.

**Instance and Project Manager:**
- You can see all detected local Iranti instances with their runtime root path, database target, port, and active/inactive status.
- You can see which projects are bound to each instance, with `.env.iranti` key completeness and Claude integration status for each binding.
- You can run `iranti doctor` for a specific instance from the UI and see results without opening a terminal.

**Getting Started screen (CP-T035):**
- On first load (or if any setup step is incomplete), you see a guided Getting Started screen listing setup steps with their completion status.
- Each incomplete step shows a plain-English description of what to do and why.
- The shell header shows a setup badge when any step is incomplete.

---

## What to Test — Per Persona

### Marcus (Solo Dev / Indie Hacker)

You have one Iranti instance, one project binding, and use Claude Code daily. You've been using Iranti for a few weeks but still find yourself running SQL queries when something feels "off."

**Task 1: Find what Iranti currently believes about your active project.**
Open the control plane. Without using SQL or Adminer, find the fact that represents your current active project. How long does it take? Do you need to do anything you didn't expect?

**Task 2: Check the history of a fact you wrote more than a week ago.**
Pick a fact you know you wrote a week or more ago. Navigate to its temporal history. Can you tell when it was last changed and why? Is the timeline clear without explanation?

**Task 3: Watch a write happen.**
Open the Staff Activity Stream in the control plane. In a separate terminal window, run `iranti write` to write a new fact. Does the write appear in the stream? How quickly? Does it feel like the system is live?

---

### Priya (Technical Founder)

You are evaluating Iranti for your 3-person team. You have two instances (one personal, one team test) and your core evaluation questions are about multi-instance visibility and conflict handling.

**Task 1: Understand what each instance knows.**
Open the control plane connected to your personal instance. Find a fact specific to your main project. Then, using a separate browser tab or connection, do the same for your team test instance. Does the control plane make it clear which instance you are looking at? Can you answer "are these instances independent?" from what you see?

**Task 2: Verify a provider key you rotated.**
Last week you rotated an API key for one of your instances. Without opening a terminal or editing a file, verify from the control plane that the key is correctly configured and the provider is reachable.

**Task 3: Evaluate the onboarding story for a new team member.**
Imagine you are onboarding a team member who has never set up Iranti. Walk through the Getting Started screen and Health dashboard as if showing them the setup. Is there enough guidance for someone who has never seen Iranti? What is missing?

---

### Dev (Power User / Design Partner)

You have 3 instances, 8+ project bindings, and weekly Adminer sessions with saved SQL queries. Your bar is high: the control plane must replace your Adminer tab and your saved queries entirely.

**Task 1: Answer "what does Iranti believe about [entity X]?" without SQL.**
Pick an entity you care about. Find it in the control plane. Does the entity detail page give you the full picture — current facts, archived facts, relationships? Is anything missing that your SQL query would have shown?

**Task 2: Trace the history of a specific fact.**
Pick a fact on that entity that you know has been archived at least once. Navigate to its temporal history. Is the full interval list there, including archive intervals with human-readable reasons? Is the supersession chain clear?

**Task 3: Watch the Librarian process a write in real time.**
Open the Staff Activity Stream. Run `iranti_handshake` or `iranti write` in a terminal. Does the event appear within 1–2 seconds? Is the event's metadata (entity, key, source, timestamp) sufficient to tell you what happened without any additional lookup?

---

## What Feedback to Capture

These five questions apply to all three personas. Please answer them after your session.

1. **"Was there anything you expected the control plane to show you that it didn't?"**
   This surfaces unmet jobs more reliably than asking about missing features. Be specific — name the entity, the fact, or the piece of information you were looking for.

2. **"Did you reach for SQL, Adminer, or a terminal at any point? If so, why?"**
   If yes, this is the most important feedback of the session. The specific moment you reached for another tool is where the product is failing.

3. **"How would you describe the control plane to a colleague who hasn't seen it?"**
   This reveals what actually registered. The words people use to describe a tool to others are the product's true positioning.

4. **"What is the first thing you would change or add?"**
   Solicits the highest-priority unmet need. Note whether the answer is a current limitation (Phase 1–2 gap) or something entirely new.

5. **"Would you use this instead of Adminer for your regular Iranti operations? What would need to be true for you to switch completely?"**
   The closing question. The conditions they name are Phase 3 inputs.

---

## What Phase 2 Will Add

Phase 2 (v0.2.0) is already in progress. Four concrete additions that address gaps design partners will notice in v0.1.0:

- **Live Staff activity with sub-second latency**: Native emitter injection (CP-T025) will bring Attendant and Resolutionist events into the stream within 200ms of the operation completing — making the stream feel like a terminal tail, not a log viewer. This requires an upstream Iranti PR.
- **Conflict review UI (CP-T021)**: A structured surface for reviewing pending escalations — see both sides of a conflict, read the escalation reason, and resolve it from the UI without touching the filesystem or the CLI.
- **Provider and credit management (CP-T022, CP-T034)**: Change the default provider, set task-specific model overrides, and see remaining credit/quota where providers expose it — without editing env files by hand.
- **Embedded Iranti Chat (CP-T020)**: Run `iranti_write`, `iranti_query`, and slash commands from within the control plane, with chat responses linking directly to affected facts in Memory Explorer.

---

## How to Share Feedback

**During your session:**
If you are joining a facilitated session, the facilitator will take notes. You don't need to document anything during the session — just work naturally and speak your thoughts aloud when something surprises or frustrates you.

**After your session:**
You will receive a 3-question follow-up by email within 48 hours:
1. "What was the one thing you'd change first?"
2. "Is there a workflow you hoped the control plane would support that it didn't?"
3. "Would you share this with a colleague right now? What would you say?"

**Ongoing:**
If you discover an issue between sessions, the best channel is: [add feedback channel — Slack / GitHub issue / email as appropriate before handoff]. Bugs and data correctness issues are the highest priority — please report them immediately rather than waiting for your next session.

**What we're not looking for:**
You don't need to write a formal review or prepare anything before sessions. The goal is naturalistic use on your real Iranti instance, not a demo environment. The most valuable feedback comes from hitting the control plane's limitations against problems you actually care about.

---

## Current Limitations — Be Aware

v0.1.0 is a first release. The following limitations are known and expected — they are not bugs:

- **Read-only**: You cannot write, edit, or delete facts from the control plane. All writes go through `iranti write`, `iranti chat`, or your agent's MCP tools.
- **Single-instance context**: The control plane is connected to one running Iranti backend at a time. Multi-instance side-by-side comparison is Phase 3.
- **No conflict review UI yet**: If you have pending escalations, you will see a count in the Health dashboard but cannot resolve them from the UI in v0.1.0. Resolution still requires the CLI.
- **Attendant/Resolutionist stream events**: These require a native emitter integration not yet merged upstream. The stream will show Librarian and Archivist events reliably; Attendant and Resolutionist are labeled "pending upstream PR."
- **No full-text search in fact values**: Search is entity name and key name only. Searching the content of stored values is Phase 3.

---

*Thank you for being a design partner. Your feedback directly shapes what Phase 3 prioritizes. We are not looking for validation — we are looking for the gaps that still require SQL.*

---

*Produced by: user_researcher | Date: 2026-03-20*
*Review before handoff: PM to confirm feature set accuracy against CP-D001 lift criteria*
