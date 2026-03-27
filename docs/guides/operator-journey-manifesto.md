# Iranti Control Plane Operator Journey Manifesto

This document describes the control plane as it exists today: what it shows, what it trusts, what it can repair, and where it still asks the operator to understand the underlying Iranti runtime. It is written as a journey rather than a feature list because the product only makes sense when the operator can move from setup to confidence to recovery without losing the thread of authority.

The core promise is simple:

- tell the truth about the current install state
- show the actual instance lifecycle, not a guessed abstraction
- keep provider configuration anchored to the instance, not the project
- make project binding explicit and reversible
- surface Claude and Codex integration as operational reality, not wishful state
- expose doctor and repair actions at the moment the operator needs them
- let sessions and the knowledge base answer "what happened" and "what is true now"
- reduce recovery work to the smallest honest set of commands and checks

If the control plane cannot do one of those things safely, it should say so plainly.

## 1. The First Truth Is Install State

The first thing an operator needs is not a dashboard. It is an answer to a narrower question: is the Iranti control plane present, runnable, and pointed at the right runtime?

The current install-state surface does three useful things:

- it detects whether the Iranti CLI is installed
- it shows the executable path and version when available
- it makes the next action obvious when it is not installed, usually `npm install -g iranti`

That matters because install state is not just a binary yes/no. It is the beginning of authority. If the CLI is missing, the rest of the workflow is theoretical. If the CLI is present but the runtime root is wrong, every later screen can be technically correct and still operationally useless.

The control plane should therefore behave like a verifier, not a cheerleader. It should show the command the operator can run, the path it resolved, and the instance context it believes it is managing.

## 2. Setup Is a Sequence, Not a Landing Page

The Getting Started experience is not a marketing page. It is the first operational checklist. The current behavior makes that clear by treating setup as a stepwise state machine rather than a single onboarding modal.

The real sequence is:

1. establish database connectivity
2. confirm instance and runtime authority
3. configure provider defaults and keys
4. bind one or more projects
5. verify Claude and Codex integration where relevant

The page is useful because it turns hidden prerequisites into visible work. A clean setup state should mean the operator can move forward with confidence. A partial state should tell the operator exactly which step is missing, which ones are optional, and which ones are not applicable for the selected instance.

The important design principle here is that setup is not complete until the control plane and the live Iranti instance agree on where truth lives.

## 3. Instance Lifecycle Must Stay Concrete

The Instances experience is the control plane's operational center. It should answer five questions without ambiguity:

- what instances exist
- which instance is selected
- which instance is running
- which instance is configured but stopped
- which instance needs repair or re-creation

The current behavior is strongest when it stays close to runtime facts:

- discovered instances are listed with runtime metadata
- start and stop actions operate on the selected instance
- create and configure actions write to the runtime-root authority model
- upgrade and restart actions are exposed where they are safe to offer
- instance health state is separated from the existence of the instance directory

This is the right shape because lifecycle is not just process control. It includes:

- the instance directory
- the instance env file
- the runtime metadata
- the database connection
- the provider configuration
- the project bindings that point at it

An operator can only trust the lifecycle surface if it distinguishes "configured", "running", "stopped", "stale", "unreachable", and "incomplete". Collapsing those states into a single status would make the UI simpler and the operator less informed.

## 4. The Instance Env Is the Authority

The control plane's config model is intentionally asymmetric:

- `.env.iranti` is a project binding pointer
- the instance `.env` is the runtime authority

That distinction is the backbone of the product. It is the difference between "which instance am I talking to" and "how does that instance actually run".

The operator journey should reinforce this repeatedly because many failures come from crossing the streams:

- provider keys belong in the instance env
- `DATABASE_URL` belongs in the instance env
- `LLM_PROVIDER` belongs in the instance env
- `.env.iranti` only points to the instance env and records the connection metadata

If the control plane makes this distinction obvious, it prevents the most expensive class of support issue: writing valid-looking configuration to the wrong file.

The experience should always make the authoritative file discoverable, visible, and copyable. When the control plane writes a provider key or adjusts a runtime setting, it should be explicit that the write lands in the instance env and that the running instance may still require a restart.

## 5. Provider Configuration Is Instance Work

Provider setup is not a project preference. It is instance-level runtime state.

The control plane currently treats provider management as a concrete operator task:

- inspect whether a provider key is present
- inspect which provider is currently active
- set or rotate provider keys
- change the default provider
- manage the fallback chain
- surface routing defaults and task-specific routing where available

The operator should never have to infer whether missing keys are a problem. The UI should tell the difference between:

- active provider missing its key
- non-active provider intentionally unconfigured
- provider value present but legacy or invalid
- provider changes written successfully but not yet picked up by the running process

The most important truth is that provider changes are not instant unless the process reloads them. The control plane should treat restart as part of the operator contract, not as an afterthought hidden in the fine print.

## 6. Project Binding Is a Pointer, Not a Runtime Source

Project binding is where the operator connects a working directory to an instance. It should feel lightweight, but it should never feel magical.

The current model is good when it behaves like this:

- bind a project to a selected instance
- write the binding metadata to `.env.iranti`
- keep the project directory as the unit of attachment
- show bound projects per instance
- let the operator rebind or inspect the existing binding

That makes binding useful for teams because one instance can serve multiple projects, and multiple projects can point at the same runtime truth without duplicating secrets.

The product should keep saying the same thing in different ways: the project knows where to connect, but the instance knows how to run.

## 7. Claude and Codex Integration Are Separate Journeys

Claude and Codex are both integrations, but they are not the same integration.

The control plane should present them as distinct because they have different scopes and different recovery paths:

- Claude Code is project-scoped
- Codex integration is machine-scoped

That is not a cosmetic distinction. It determines what the operator changes and where the result should appear.

For Claude Code, the journey is:

1. bind a project to an instance
2. inspect the bound project
3. scaffold `.mcp.json` and Claude settings for that project
4. verify that the project now references Iranti correctly

For Codex, the journey is:

1. verify local Codex availability
2. inspect current MCP registration state
3. register Iranti as an MCP server when needed
4. refresh to confirm the live registration state

The control plane should not guess from stale config files when the CLI can tell the truth. If Codex says a server is registered, that is the source of truth. If Claude files are missing or malformed, the per-project integration check should say so directly.

## 8. Doctor Is the Bridge Between Symptom and Cause

The Doctor surface is where the control plane stops being descriptive and becomes diagnostic.

The operator uses doctor when something is wrong but not yet understood:

- a provider key appears missing
- the instance looks stale
- the database probe fails
- the vector backend is degraded
- a project integration file is missing
- sessions or health data do not line up with expectations

The best doctor flow does not just label a failure. It narrows the problem domain:

- this is a runtime issue
- this is a database issue
- this is a binding issue
- this is a provider issue
- this is a project integration issue

That matters because operator confidence comes from being able to move from "something is wrong" to "I know where to fix it" in one step.

The diagnostics surfaces should keep exposing runnable or copyable commands where it is safe to do so, but they should remain conservative. If the control plane cannot safely run the fix, it should still present the command clearly and let the operator decide.

## 9. Repair Should Be Narrow, Not Ambiguous

Repair is the moment the product must be honest about the difference between automated fixups and manual intervention.

The current repair posture is strongest when it stays explicit:

- repair MCP integration files when they are missing or stale
- repair Claude project metadata when the per-project setup is incomplete
- surface the exact file or command that needs attention
- avoid pretending that all problems can be healed inside the UI

Repair should never become a blanket "make it work" button. That would hide too much. The operator should be able to answer:

- what was repaired
- what was left unchanged
- whether a restart is still required
- whether the issue belongs to the runtime, the project, or the control plane itself

The product should frame repair as controlled assistance, not silent mutation.

## 10. Sessions Are About Continuity

The Sessions view is the control plane's continuity surface. It helps the operator see whether the agent session story is intact across active, completed, and recovered state.

Sessions matter because they answer a question the KB alone cannot: not just what is true, but what the system was doing while it was becoming true.

The current experience should expose:

- active sessions
- completed sessions
- checkpoints and recovery state
- whether the live session API is available
- whether the control plane is falling back to local or partial state

That fallback behavior is important. A good sessions view does not hide the absence of live data. It labels it. If the instance is unavailable or the session API cannot be reached, the operator should know whether the result is empty, stale, partial, or unreachable.

The operator journey here is not "browse sessions." It is "establish whether agent continuity can be resumed safely."

## 11. The Knowledge Base Is the Proof Layer

KB inspection is where the operator verifies what Iranti currently believes.

The current product gives the operator several levels of proof:

- the Memory Explorer for current facts
- the Archive for superseded or decayed facts
- entity detail for one entity across all its facts
- temporal history for one fact over time
- contributor and relationship views for context
- hybrid search for discovery when entity IDs are unknown

This is powerful because it lets the operator ask different questions without switching tools:

- what is current
- what changed
- who contributed
- how did the fact evolve
- what else is connected
- where did this belief come from

The manifesto for this surface is simple: do not force the operator to reconstruct truth from raw SQL, logs, or stale recollection. The UI should make truth legible at the level of facts, timelines, and relationships.

## 12. Troubleshooting Is Part of the Product

Troubleshooting is not an appendix. It is the last mile of every operator flow.

The current behavior already supports the right troubleshooting sequence:

1. check health
2. run doctor or diagnostics
3. inspect the selected instance and its runtime root
4. verify provider keys in the instance env
5. verify project binding and integration files
6. restart the instance when runtime configuration changed
7. re-open the KB or sessions view to confirm the result

The operator should not need to guess which layer is wrong. The product should teach the distinction between:

- control plane not installed
- control plane installed but pointed at the wrong instance
- instance configured but not running
- provider credentials written to the wrong file
- project bound to the wrong instance
- integration files missing
- live API unavailable
- KB data valid but stale

That is the practical standard for an operator product. If the user can isolate the failure in fewer steps, the product is working.

## 13. What Success Looks Like

The control plane succeeds when an operator can answer these questions quickly and confidently:

- Is the control plane installed?
- Which Iranti instance is this workspace bound to?
- Is that instance configured, running, or stale?
- Which file is authoritative for runtime config?
- Which provider is active and where is its key stored?
- Does this project have the right Claude or Codex integration?
- What does doctor say is actually broken?
- What repair action is safe to take now?
- What are the current facts in the KB?
- What changed over time?
- What is the next recovery step if something fails?

If the UI can answer those questions without making the operator leave the product, it is doing its job.

If it cannot, it should at least tell the truth about what it knows and what it does not.

## 14. Non-Negotiable Product Rules

- Never hide the authority model.
- Never treat `.env.iranti` as runtime truth.
- Never imply provider changes are live without a restart when they are not.
- Never collapse distinct lifecycle states into one vague badge.
- Never present a repair action as safe if it can only be copied, not run.
- Never make sessions or KB views pretend to be live when they are partial or fallback-based.
- Never force the operator back to SQL or filesystem spelunking unless there is no better alternative.

That is the product contract the current control plane should keep honoring.

