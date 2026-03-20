# Iranti Control Plane — Operator Persona Profiles

**Author:** user_researcher
**Date:** 2026-03-20
**Phase:** Phase 1 research
**Source:** PRD `docs/prd/control-plane.md`, JTBD analysis

---

## Overview

Three concrete operator personas derived from the PRD's target user descriptions. These personas are grounded in the specific workflows and failure modes that the control plane is designed to address. They are not generic archetypes — each represents a distinct relationship with Iranti that implies different Phase 1 success criteria and Phase 2 priority signals.

---

## Persona 1: Marcus — Solo Developer / Indie Hacker

**Name:** Marcus Chen
**Role:** Independent developer, building AI-assisted personal tooling
**Location:** Works from home, single machine (Mac), occasional cloud instance

### Context

Marcus has been using Iranti with Claude Code for about six weeks. He started using it to give Claude persistent context about his personal projects — things like his preferred patterns, active tasks, and coding conventions. He has one Iranti instance, one project binding, and uses Claude Code daily.

He set up Iranti by following the README, hit two errors along the way (one Postgres config issue, one env key typo), figured it out over 45 minutes, and hasn't touched the setup since. He doesn't know what version he's running. He doesn't know if his Archivist is doing anything.

He checks in on Iranti occasionally when something feels "off" — when Claude seems to be ignoring context he thought was stored, or when he writes something to memory and it doesn't seem to stick.

### Technical background

Intermediate-to-strong. Comfortable with the terminal, Docker basics, and reading JSON. Would not describe himself as a database person. Can write SQL if he looks up the syntax, but would strongly prefer not to. Knows what environment variables are and how to edit them.

### Primary jobs (from JTBD analysis)

1. **Inspect Current Memory** (highest priority) — Marcus wants to know what Claude is actually working with. "What does Iranti think my current project is?"
2. **Inspect Temporal History** — When context seems stale or wrong, Marcus wants to know when it changed and why.
3. **Watch Staff Activity** — He wants passive reassurance that Iranti is doing something, not just sitting there.
4. **Resolve Issues Without SQL** — When something breaks, he wants to fix it without opening Adminer.

### Current pain points

- Wrote a fact about his "active project" six weeks ago. Has no idea if it's still there, was superseded, or was archived. Has to run a SQL query to check.
- Doesn't know if his Librarian actually processed a write he did last week — he ran `iranti write` and got a success message, but isn't sure.
- Occasionally sees a memory retrieval that feels stale. Suspects Archivist archived something it shouldn't have. No way to verify without diving into the archive table.
- Doesn't know what version of Iranti he's running, whether there's an upgrade available, or whether his provider key still has credits.
- Has opened Adminer twice to check the `knowledge_base` table. Found it disorienting — too many columns, no clear way to navigate.

### Success definition for v0.1.0

Marcus opens the control plane, navigates to Memory Explorer, searches "active project," finds his fact in under 20 seconds, sees its current value and confidence, clicks through to its temporal history and sees that it was last written 3 days ago. He closes the control plane feeling like Iranti is real and working — not a black box.

He also glances at the Health dashboard, sees a green check for database and provider, and feels confident he doesn't need to do anything.

### What would make Marcus recommend it to a colleague

"It's like Adminer but for Iranti — except it makes sense. You can actually see what Iranti thinks without writing SQL."

The bar is low and concrete: the control plane just needs to make the invisible visible. Marcus doesn't need to write anything from the UI. He needs the read experience to be as natural as browsing a document.

---

## Persona 2: Priya — Technical Founder

**Name:** Priya Nair
**Role:** Co-founder / CTO, early-stage dev tools startup (3-person team)
**Location:** Remote-first team, each member on their own machine

### Context

Priya is evaluating Iranti as the shared memory layer for her team's internal AI-assisted development workflow. She has set up a personal Iranti instance for testing over the past two weeks. She hasn't committed to using it for the team yet — she's in discovery mode, understanding what Iranti can and can't do before deciding whether to integrate it into her team's toolchain.

She is technically sophisticated and reads source code when she needs to understand how something works. She has limited time. She made a calendar block for "Iranti evaluation" — one 90-minute session per week. If the control plane can help her answer her core questions within those sessions, she'll move forward. If she keeps hitting dead ends that require infrastructure spelunking, she'll move on.

Her core evaluation questions are:
1. Can I see what's in memory across different agent sessions?
2. Can I manage multiple instances (one per developer) from one place?
3. What happens when two agents write conflicting facts — and can I review and resolve that?
4. How do I know when something is broken?

### Technical background

Strong. Former backend engineer. Comfortable with SQL, Docker, cloud infrastructure, and reading API docs. Does not enjoy unnecessary friction. Will use raw tools if she has to, but will note the friction as a signal about product quality.

### Primary jobs (from JTBD analysis)

1. **Manage Instances and Projects** (highest priority) — Priya wants to understand the multi-instance story before committing.
2. **Inspect Current Memory** — Validates that what got written is actually retrievable.
3. **Resolve Issues Without SQL** — She's using the control plane as a product quality signal. If issue resolution requires SQL, that's a red flag for her team evaluation.
4. **Configure Models and Providers** — She wants to verify that provider routing is controllable at the instance level.

### Current pain points

- Set up two Iranti instances (one for herself, one for a team member) and has to maintain two separate `.env.iranti` files. No way to compare them or see their states side by side.
- Ran `iranti doctor` on both instances, got text output, and had to manually compare them. No baseline to compare against.
- Triggered a deliberate write conflict between two agent sessions to test Resolutionist behavior. Has no idea what happened — there's an escalation file somewhere in the filesystem but she hasn't found it.
- Is unclear whether the Attendant is handling memory retrieval per-instance or sharing across instances. Couldn't find documentation that answered this concisely.
- Provider key status: she's not sure if her API key for one of her test instances is still configured correctly after she rotated it last week.

### Success definition for v0.1.0

Priya opens the control plane's Instance Manager, sees both her instances, can compare their configuration at a glance (env key completeness, database target, port), and sees the project bindings for each. She then opens Memory Explorer, selects a specific instance context, and sees facts specific to that instance. She navigates to Health and sees that both instances are reachable.

She leaves the session knowing: "Iranti supports multi-instance, the control plane makes it inspectable, and the consistency model is real — even if I can't resolve conflicts from the UI yet."

### What would make Priya recommend it to her team

"The control plane showed me enough to trust the product. I could see what each instance knew, verify the instances were independent, and confirm that health monitoring works. I'll set up a trial for the team."

Priya's endorsement is conditional on the control plane not hiding important complexity. She is suspicious of tools that look clean at the expense of accuracy. The control plane needs to show the real state — including partial or warn states — not just green lights.

---

## Persona 3: Dev — Early Design Partner / Power User

**Name:** Dev Okonkwo
**Role:** Senior Software Engineer, individual contributor on a mid-size product team
**Company:** Has been using Iranti personally and is advocating for team adoption

### Context

Dev discovered Iranti four months ago and became a power user quickly. He currently has:
- 3 Iranti instances (personal, work project A, work project B)
- 8+ project bindings across instances
- Regular use of multiple agent types: Claude Code, a custom API wrapper, and experimental Codex integration
- Multiple escalations in his escalations folder that he hasn't reviewed yet

Dev is the most technically sophisticated of the three personas and understands Iranti's internal model fairly well. He has read the source code. He knows what the Archivist does, understands the difference between `superseded` and `contradicted` archive reasons, and has formed opinions about how the Resolutionist should behave.

He currently spelunks in Adminer weekly. He has a set of saved SQL queries he pastes when he needs to inspect the archive table or review escalation state. He finds this workable but embarrassing — it should not require this much infrastructure literacy to operate a memory system.

He is a design partner in the sense that his feedback directly shaped some of the PRD's direction. He is also the user most likely to find edge cases in Phase 1 that other personas would miss.

### Technical background

Expert. Strong SQL, reads Node/TypeScript, has set up PostgreSQL from scratch multiple times. Could build a simple admin UI himself — which is exactly why he cares about this product. He has better things to do than build his own Adminer wrapper.

### Primary jobs (from JTBD analysis)

1. **Inspect Temporal History** (highest priority) — Dev regularly needs to understand why a fact changed. He manages high-confidence entities across multiple agent sessions and needs to verify causality.
2. **Watch Staff Activity** — He wants to know which Staff component made a given decision, at what time, and why.
3. **Resolve Issues Without SQL** — He has pending escalations he hasn't reviewed because the current resolution workflow requires filesystem spelunking. A conflict review UI would unblock him immediately.
4. **Manage Instances and Projects** — Managing 3 instances and 8 bindings manually is becoming a maintenance burden.

### Current pain points

- Has a pending escalation from two weeks ago that he hasn't resolved because the workflow is: find the markdown file, read both versions, decide which is correct, run a CLI command with the right UUID. He knows how to do it but it's annoying enough that he keeps putting it off. A UI would change this.
- Wants to see a timeline view of how a specific entity's facts evolved across multiple agent sessions. Currently requires multiple SQL queries with timestamp joins.
- Has three instances and uses Adminer's instance selector to switch between them. Would rather have a unified control plane view that shows all three.
- Regularly checks "what did the Archivist decide about X?" — currently a JOIN query across `knowledge_base` and `archive`. This should be a click.
- Wants to see Librarian write events in a stream — not to debug a broken system, but as a passive quality monitor. Currently, there is no stream.

### Success definition for v0.1.0

Dev opens Memory Explorer, navigates to a specific entity across one of his three instances, views the full temporal history including archive intervals with human-readable archive reasons, and identifies whether an unexpected archive event was triggered by the Archivist or by a Librarian conflict. He does this without opening Adminer or writing SQL.

He also opens the Staff Activity Stream and sees at least Librarian write events appearing as he runs a test write from the CLI in another window. He confirms that the event stream is real — not a simulated feed.

### What would make Dev recommend it to his team

"This replaced my Adminer tab and my saved SQL queries. I can see everything Iranti knows, how it changed, and what the Staff did — from a real UI. It's not complete yet, but it's already better than what I was doing."

Dev's bar is the highest of the three personas: the control plane needs to show real data with real provenance. He will immediately notice if the temporal history is missing archive intervals, if the Staff stream is fabricated or incomplete, or if the entity detail page glosses over important metadata. He's a net positive as a design partner if the product is honest about what it shows.

---

## Persona Comparison Summary

| Dimension | Marcus (Solo Dev) | Priya (Tech Founder) | Dev (Power User) |
|-----------|------------------|---------------------|-----------------|
| Iranti experience | 6 weeks | 2 weeks | 4+ months |
| Instances | 1 | 2 | 3 |
| Project bindings | 1 | 2-3 | 8+ |
| SQL comfort | Low | High | Expert |
| Visits Adminer | Rarely | Occasionally | Weekly |
| Top Phase 1 job | Inspect Memory | Manage Instances | Temporal History |
| Top Phase 2 job | Install guidance | Conflict review | Conflict review |
| Success bar | Low (legible > complete) | Medium (multi-instance story) | High (accuracy and completeness) |
| Trust model | Needs reassurance | Needs evidence | Needs honesty |

---

## Implications for Phase 1 Design Decisions

**For Marcus:** The zero-data state must not look broken. Empty tables and loading spinners with no guidance will cause Marcus to assume he did something wrong during setup.

**For Priya:** Instance context switching must be explicit and always visible. If Priya doesn't know which instance she's looking at, the control plane fails her primary evaluation question immediately.

**For Dev:** Archive reasons must be human-readable labels, not raw codes. The temporal history view must include archive intervals from the `archive` table, not just current facts. If he sees a temporal history that only shows the current value, he will correctly judge it as incomplete.

---

---

## Phase 2 Persona Evolution — Post-Phase 1 Retrospective

**Date:** 2026-03-20

### Marcus — Phase 2 Evolution

Phase 1 delivered Marcus's primary job (Inspect Current Memory). With CP-T036 shipping in Phase 2, his secondary job (Inspect Temporal History) will also be met. Marcus's Phase 2 experience center of gravity shifts to:

1. **Getting started / setup guidance (CP-T035):** Marcus hit two errors during initial setup. Once v0.2.0 ships, new Marcus-equivalent users should be able to get from zero to running Iranti without 45-minute debugging sessions. CP-T035's getting started screen addresses this directly.
2. **Provider credit visibility (CP-T034):** Marcus doesn't know if his provider key still has credits. This is a recurring anxiety that CP-T034 resolves.
3. **Passive Staff reassurance (CP-T025/CP-T037):** Marcus watches the Activity Stream for passive reassurance that Iranti is processing. With native emitter and live mode UX, the stream becomes the ambient health monitor he needs.

**Phase 2 success bar for Marcus:** Opens control plane, sees "Iranti is healthy" at a glance, runs `iranti write`, watches the Librarian event appear in the stream within 1 second. Clicks a fact in Memory Explorer, views its temporal history. Closes the control plane feeling confident that Iranti is real and working.

### Priya — Phase 2 Evolution

Phase 1 gave Priya the read-only instance view. Her Phase 2 primary jobs are:

1. **Conflict review (CP-T021):** Priya triggered a write conflict deliberately to test Resolutionist behavior — but had no way to see what happened. CP-T021's conflict review UI directly addresses her core evaluation question #3 ("What happens when two agents write conflicting facts?").
2. **Provider configuration (CP-T022):** Priya rotated an API key and wasn't sure if the instance picked it up. CP-T022 gives her visibility and control over provider routing without hand-editing env files.
3. **Embedded chat (CP-T020):** Priya evaluates Iranti for her team's workflow. Embedded chat lets her demonstrate the full product loop — write, retrieve, observe — without switching between terminal and browser.

**Phase 2 success bar for Priya:** Opens the control plane, sees a pending conflict in the conflict review surface, reviews both fact versions, resolves it from the UI. Then opens Instance Manager, sees both her instances, verifies provider key status for each. Sends a chat message and watches the Librarian event appear in the stream.

### Dev — Phase 2 Evolution

Dev is the most critical persona for Phase 2. Phase 1 left him significantly underserved — temporal history was a placeholder, relationships were a flat list, Attendant and Resolutionist events were absent from the stream.

**Dev's Phase 2 primary jobs:**

1. **Live Staff tail while agents run (CP-T025 + CP-T037):** User signal confirmed — Dev (or a Dev-equivalent user) wants to watch Iranti process his agent's actions in real time. Not retrospective debugging: co-temporal observation. This is his most visceral Phase 2 job. The live mode UX (pulse indicator, velocity counter, auto-scroll) makes the stream feel like a terminal tail, not a log browser.
2. **Temporal history frontend (CP-T036):** Dev's Phase 1 success definition is "views full temporal history including archive intervals with human-readable archive reasons without SQL." CP-T036 delivers this directly. After CP-T036 ships, Dev's most important Phase 1 gap is closed.
3. **Conflict review (CP-T021):** Dev has pending escalations he hasn't resolved because the CLI workflow is annoying enough that he keeps deferring them. CP-T021 removes that friction.
4. **Relationship graph (CP-T032):** Dev is the persona most likely to use the relationship graph — he tracks entities across multiple agent sessions and instances. The flat list is "the least defensible part of Phase 1" from his perspective (as noted in the Phase 1 retro).

**Phase 2 success bar for Dev:** Opens Staff Activity Stream, runs `iranti_handshake` in a terminal, watches the Attendant event appear in < 1 second with the pulse dot hot. Navigates to Memory Explorer, opens an entity, clicks through to temporal history — sees full interval list including archive intervals with human-readable reasons. Opens the relationship graph for that entity, sees a visual graph. Reviews and resolves a pending escalation from the conflict review UI. Does all of this without opening Adminer, without SQL, without the filesystem.

This is the definition of "control plane as a real operator tool rather than a curiosity." Dev's Phase 2 success is the design partner validation story for v0.2.0.

---

*Update this document when Phase 2 design partner testing begins and actual user feedback is available.*
