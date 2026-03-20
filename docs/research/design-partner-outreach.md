# Design Partner Outreach Plan — v0.1.0 / v0.2.0

**Author:** product_manager
**Date:** 2026-03-20
**Purpose:** Structured plan for approaching the 3 design partner personas, conducting sessions, and capturing feedback for Phase 2 and Phase 3 planning.

---

## Overview

Design partner outreach for Iranti Control Plane begins when v0.1.0 ships and the Phase 2 P0 tickets (CP-T036: entity detail/temporal history views, CP-T035: getting started screen) are complete. The goal is not to validate vanity metrics — it is to surface the specific friction points and unmet jobs that should shape Phase 2 completion and Phase 3 prioritization.

**Target:** 3 design partners, one per persona archetype.
**Session format:** 60-minute unmoderated observation with 15-minute debrief.
**Timing:** Begin outreach when all of the following are true: (1) CP-T036 is merged and CI is green ✓ (done as of 2026-03-20), (2) CP-D001 fix is merged and QA has confirmed REG-001–REG-005 pass, (3) v0.1.0 hold is lifted by PM, (4) `docs/research/design-partner-brief.md` exists and is ready to hand off. First session target: within 1 week of v0.2.0 release.

---

## Persona 1: Marcus (Solo Dev / Indie Hacker)

### Profile reminder
Marcus has been using Iranti with Claude Code for 6 weeks. One instance, one project binding. SQL-avoidant. Uses the control plane to check what Iranti believes about his project. Primary job: inspect current memory without Adminer.

### How to approach Marcus

**Opening framing:**
"We shipped the first version of the Iranti Control Plane — a browser UI for inspecting your Iranti memory, watching what the Staff is doing, and checking system health. We'd love 45 minutes of your time to watch you use it on your actual instance and hear what you think. No demo, no slides — just you using it."

**Pre-session setup:**
- Confirm Marcus has a running Iranti instance with at least 5 facts in `knowledge_base`
- Confirm at least one fact has been superseded (so temporal history is real)
- Share the control plane URL: `http://localhost:3002/control-plane` (or whichever port his instance runs on — verify against Marcus's actual `.env` before the session)
- Do not explain anything about the UI before the session

**Session tasks (give verbally, one at a time):**

1. "Find what Iranti currently believes about your current active project. How long did it take? Did you need to do anything you didn't expect?"

2. "Pick a fact you wrote more than a week ago. Can you tell when it was last changed and why? Show me what you see."

3. "Open the Health dashboard. Tell me: is your Iranti instance healthy right now? Is there anything you'd want to act on?"

4. "Run `iranti write` in a terminal to write a new fact. Watch the control plane — what happens? Does anything feel like it showed you that the write was processed?"

5. "You just opened the control plane for the first time on a fresh Iranti install — no data yet. What does the screen tell you to do? Is it clear?"

**What feedback to capture:**

1. How long did task 1 take? Did Marcus navigate to Memory Explorer directly or explore other views first?
2. Did Marcus find the temporal history view (CP-T036)? Was the interval list clear? Did he understand archivedReason labels?
3. Did the Staff Activity Stream show the write event from task 4? Did it feel live?
4. What did Marcus say about the visual design? (Probe: "Does this feel like a polished tool or a work in progress?")
5. What was the first thing Marcus said that was NOT prompted by a task? (Often reveals the most important unmet need)

**What Marcus success looks like:**
Marcus says (unprompted) something like: "This is basically what I wanted — I can see what Iranti thinks without opening Adminer." Time to complete task 1 is under 30 seconds. He does not ask to write SQL.

**Red flags:**
- Marcus does not find the Memory Explorer without guidance
- Temporal history view fails to show archive intervals (data issue)
- Marcus asks how to do something the control plane already supports

---

## Persona 2: Priya (Technical Founder)

### Profile reminder
Priya is evaluating Iranti for a 3-person team. Two instances (personal + team test). Strong SQL background. Uses the control plane to evaluate the product's completeness before team commitment. Primary job: understand the multi-instance story and conflict handling.

### How to approach Priya

**Opening framing:**
"You've been evaluating Iranti for your team. We've built a control plane — a browser UI for inspecting memory, managing instances, watching Staff activity, and checking health. We want to see if it answers the questions you had when evaluating, without you needing to drop into SQL or the filesystem. Can we have 60 minutes to watch you use it?"

**Pre-session setup:**
- Confirm Priya has 2 running Iranti instances
- Confirm at least one conflict/escalation has been triggered (so conflict review is testable — or note that CP-T021 is Phase 2 if it hasn't shipped yet)
- Provide access to both instances' control planes
- Do not explain the navigation structure before the session

**Session tasks:**

1. "Using the control plane, answer this: what does your personal Iranti instance currently know about your main project? Can you do the same for your team test instance? How does the experience compare?"

2. "Last week you rotated a provider API key on one of your instances. Can you verify from the control plane that the key is correctly configured — without opening a terminal?"

3. "You suspect one of your agent sessions wrote a conflicting fact. Can you find any pending conflicts or escalations in the control plane? What do you see?"

   *(Facilitator note: if CP-T021 Escalation Review has not shipped by session time, this task becomes an open exploration. Do not guide Priya — observe where she goes and what she finds or does not find. The observation IS the finding: if she cannot locate conflict information, that is evidence CP-T021 is a priority.)*

4. "Imagine you're onboarding a team member who has never set up Iranti. Walk me through what you'd show them in the control plane to help them understand if their setup is working."

5. "Is there any question about your Iranti instances that you tried to answer just now and couldn't?"

**What feedback to capture:**

1. Did Priya notice that instance context switching requires separate browser sessions/tabs in Phase 1? What was her reaction?
2. Did the Provider Manager (CP-T022) answer her key rotation question? Or did she have to go to the terminal?
3. For task 3: does the Escalation Review (CP-T021) exist at session time? If yes — did it surface her conflict correctly? If no — what did she do instead?
4. For task 4: did the Getting Started screen (CP-T035) give her a useful onboarding narrative for her team member scenario?
5. What did Priya say about completeness? Specifically: "Would you recommend Iranti to your team based on what you saw today?" What was her answer and reasoning?

**What Priya success looks like:**
Priya answers question 5 with: "Yes, with caveats." The caveats should be Phase 3 items (multi-instance isolation, write actions), not Phase 1 or Phase 2 gaps. She does not open Adminer or a terminal during any task.

**Red flags:**
- Priya cannot answer the provider key question without the terminal (CP-T022 gap)
- Priya cannot find or understand the conflict review surface (CP-T021 gap or UX clarity issue)
- Priya says "I'd still need Adminer for X" where X is a Phase 1 or Phase 2 feature

---

## Persona 3: Dev (Power User / Design Partner)

### Profile reminder
Dev is Iranti's most technically sophisticated user. 3 instances, 8+ bindings, weekly Adminer sessions. Reads source code. Has pending escalations he hasn't resolved. Primary job: replace Adminer with the control plane entirely. His acceptance is the v0.2.0 design partner validation story.

### How to approach Dev

**Opening framing:**
"You've been using Adminer and saved SQL queries to operate Iranti. We want to see if the control plane replaces them. This is a 60-minute session: no guided demo. We'll give you 5 questions to answer using only the control plane — no Adminer, no terminal, no SQL. At the end we'll ask if you'd close Adminer permanently. Ready?"

**Pre-session setup:**
- Confirm Dev has an Iranti instance with: 50+ facts, multiple entities with temporal history, at least one entity with 3+ relationships, at least one pending escalation
- Have Dev's saved SQL queries visible so we can check which ones the control plane replaces
- Confirm Staff Activity Stream is live (SSE connected, events flowing)
- This session is specifically designed to test the v0.2.0 success criterion 5: "Can Dev replace his weekly Adminer session?"

**Session tasks (the 5 questions from v020-success-criteria.md):**

1. "What does Iranti currently believe about [pick an entity Dev cares about]?" — *Target: Memory Explorer, entity detail. Time limit: 60 seconds.*

2. "When did [a specific fact in that entity] change, and why?" — *Target: temporal history timeline. Dev should be able to navigate to the interval list, read archivedReason labels, and identify the supersession chain.*

3. "What entities are related to [that entity]?" — *Target: relationships list or graph (if CP-T032 shipped). Dev should be able to see relationship types and navigate to related entities.*

4. "What did the Librarian do with your last write?" — *Target: Staff Activity Stream, filtered to Librarian. If CP-T025 native emitter is active: also show Attendant handshake_completed. Time limit: the event should appear within 2 seconds of the write.*

5. "Is your Iranti instance healthy right now?" — *Target: Health dashboard. Can Dev answer this in under 30 seconds?*

**What feedback to capture:**

1. How many of the 5 questions did Dev answer without opening Adminer, SQL, or a terminal? Record each.
2. Which of Dev's saved SQL queries does the control plane NOT replace? These are Phase 3 ticket inputs.
3. Did the temporal history view show the full interval list including archive intervals? Were archivedReason labels readable?
4. Did Dev say anything like "This is what I was doing in Adminer"? Those moments confirm the product hypothesis.
5. Dev's direct quote on "Would you close Adminer after this?" — record verbatim.

**What Dev success looks like:**
Dev answers all 5 questions without SQL or Adminer. He says something equivalent to "this is better than what I had." He identifies 2–3 remaining gaps but none of them are Phase 1 or Phase 2 commitments — they should be Phase 3 candidates.

**Red flags:**
- Dev opens Adminer to verify what the control plane showed (accuracy failure — most serious)
- Dev says temporal history is missing archive intervals (CP-T036 regression or data issue)
- Dev says "the Staff stream is too slow" and the events take >5 seconds (CP-T025 or SSE issue)
- Dev finds a data discrepancy between the control plane and Adminer (correctness failure — requires immediate investigation)

---

## Feedback Capture Format

After each session, record the following to Iranti within 24 hours:

```
entity: research/design_partner_session
key: [persona_name]_[date]
value: {
  "persona": "marcus|priya|dev",
  "date": "YYYY-MM-DD",
  "taskSuccess": { "task1": true/false, "task2": true/false, ... },
  "adminerOpened": false,
  "sqlUsed": false,
  "topUnmetNeed": "...",
  "topPositiveFeedback": "...",
  "closingQuestion": "...",
  "phase3CandidatesRaised": ["..."],
  "notes": "..."
}
```

Also record to:
- `research/design_partner_brief` key `feedback_summary` — aggregate findings after all 3 sessions

---

## Session Logistics

**Format:** Remote screen share (Zoom / Google Meet) or in-person. Prefer screen share — easier to capture what they're clicking.

**Recording:** With explicit consent, record the screen share for async review. Without consent, take detailed notes during the session.

**Facilitator rules:**
- Do not explain the UI or guide navigation except to keep the session moving past a critical blocker
- If a user is stuck for >3 minutes on a single task, note it and move on — the stuckness IS the finding
- Do not defend design decisions during the session. Listen.
- Ask "what would you expect to happen here?" rather than explaining what the feature does

**Follow-up:**
- Send a 3-question follow-up email within 48 hours:
  1. "What was the one thing you'd change first?"
  2. "Is there a workflow you hoped the control plane would support that it didn't?"
  3. "Would you share this with a colleague right now? What would you say?"

---

## Success Definition for Outreach Program

The design partner outreach is successful if:
1. All 3 personas are tested within 4 weeks of v0.2.0 release
2. At least 2 of 3 sessions confirm Dev's 5-question test passing
3. At least 1 unexpected Phase 3 candidate is surfaced from each session
4. No Phase 1 or Phase 2 correctness failures are discovered during sessions (accuracy matters most)
5. The feedback is written to Iranti and synthesized into a Phase 3 candidate update within 1 week of the final session

---

*Maintained by: product_manager + user_researcher*
*Next review: After first design partner session*
