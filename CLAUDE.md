# Iranti Control Plane - Project Operating Context

## Mission
Build the Iranti Control Plane as the operator surface for Iranti: a local-first management product that lets users inspect memory, view Staff behavior, manage instances and project bindings, configure providers/models, understand conflicts, and operate Iranti without raw SQL or filesystem spelunking.

## Product Source of Truth
The product source of truth lives here:
- `docs/prd/control-plane.md`

Every material product decision must map back to that PRD or update it explicitly.

## Shared Memory - Iranti
This project uses Iranti as the shared memory layer for all agents.
Iranti is running at `http://localhost:3001`.
Credentials are in `.env.iranti`.

Every agent must:
1. Call `iranti_handshake` with their `agent_id` at session start.
2. Query Iranti before making architectural, product, or implementation decisions.
3. Write stable outputs, decisions, findings, blockers, and completed work back to Iranti.
4. Record uncertainties and assumptions instead of inventing certainty.
5. Check with the PM before changing product scope, UX intent, naming, roadmap, or acceptance criteria.

## Team Operating Model
The Product Manager is the coordinating brain of the project.

The PM is responsible for:
- user research synthesis
- understanding how Iranti itself works as a product and system
- periodically checking upstream Iranti changes, releases, docs, and operational surfaces
- PRD quality
- roadmap sequencing
- backlog structure
- ticket quality
- acceptance criteria
- product coherence across the whole repo

All other agents are execution specialists.
They do not self-approve product changes.
When an epic, feature, story, task, or subtask is completed, the responsible agent must check back against the PM's requirements and acceptance criteria before considering it done.

## Delivery Hierarchy
Every major workstream should decompose cleanly into:
1. PRD
2. roadmap
3. backlog
4. epics
5. features
6. stories
7. tasks
8. subtasks

No implementation should jump ahead of this structure for major features unless the PM explicitly marks it as an exploratory spike.

## Standard Flow
1. PM defines or refines the PRD.
2. PM creates or updates roadmap phases.
3. PM creates backlog items with acceptance criteria and dependencies.
4. Specialists pick up tickets in their domain.
5. Specialists do research, implementation, testing, and documentation.
6. Specialists report back to PM with what changed, risks, open questions, and whether acceptance criteria were met.
7. PM validates product fit and either accepts the work or sends it back.

## Quality Standard
All agents should operate with:
- strong reasoning
- deep research when needed
- concrete tradeoff analysis
- rigorous problem solving
- high-quality PR-quality output

Low-effort output is not acceptable.
The default standard is senior-level work with explicit reasoning and clear artifacts.

## Core Agent IDs
- PM: `product_manager`
- User Research: `user_researcher`
- Architect: `system_architect`
- Backend: `backend_developer`
- Frontend: `frontend_developer`
- QA: `qa_engineer`
- DevOps: `devops_engineer`
- Technical Writer: `technical_writer`

## Artifact Expectations
Use the repo as a real product workspace.
Expected artifacts include:
- PRD updates
- roadmap docs
- backlog docs
- ticket breakdowns
- architecture notes
- API specs
- wireframes or interface descriptions
- implementation plans
- test plans
- release notes
- upstream Iranti change reviews when product assumptions might have drifted

## Special Product Expectations
- The control plane should help users understand Iranti itself, not just operate a database-like UI.
- Installation and onboarding should be treated as first-class product surfaces.
- The product should explore a genuinely simple Iranti installer or guided setup experience rather than assuming infrastructure fluency.
- Visual design should be intentional in both light and dark mode. Generic dashboard colors are not acceptable.

## Completion Rule
A ticket is not done when code or docs exist.
A ticket is done only when:
- the assigned agent believes the work is complete
- acceptance criteria are checked explicitly
- known risks are documented
- the PM has enough evidence to accept the work

## Entity Naming Suggestions
- `project/iranti_control_plane` - project-wide facts
- `agent/[agent_id]` - per-agent outputs
- `decision/[topic]` - decisions and tradeoffs
- `roadmap/[phase_or_theme]` - roadmap facts
- `ticket/[ticket_id]` - ticket state, acceptance criteria, blockers, and outcomes
- `research/[topic]` - user and market research findings
- `blocker/[topic]` - active blockers
