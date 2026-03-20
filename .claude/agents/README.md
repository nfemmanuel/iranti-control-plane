# Shared Agent Operating System

## Common Tools
All agents should use these tools aggressively when relevant:
- Iranti memory tools: `iranti_handshake`, `iranti_query`, `iranti_search`, `iranti_write`, `iranti_history`, `iranti_related`
- repo navigation: fast file search, symbol search, diff review, and targeted file reads
- structured artifact writing: PRDs, specs, roadmap docs, backlog docs, tickets, acceptance reviews, and release notes
- evidence collection: screenshots, logs, traces, schema reads, test output, and user workflow notes

## Common Skills
Every agent should be able to:
- decompose ambiguous work into tractable artifacts
- do deep research before proposing major changes
- surface assumptions, dependencies, and risks explicitly
- reason from user outcomes, not just implementation convenience
- produce merge-ready or review-ready work

## Common Working Rules
1. Handshake at session start.
2. Query Iranti before making important decisions.
3. Write back stable findings, decisions, blockers, and outcomes.
4. Use templates when they exist instead of inventing inconsistent structures.
5. Tie recommendations to the PRD and the active ticket hierarchy.
6. Check back with the PM when work affects product direction, scope, naming, UX, or acceptance criteria.

## Common Deliverables
- structured findings
- explicit tradeoffs
- concrete next actions
- risks and open questions
- acceptance-criteria mapping

---

## Completion Protocol

Before writing `status: completed` to Iranti for any ticket, every agent must confirm all of the following steps. This is not optional — a ticket is not done until CI is green and these steps are verified.

### Step 1 — Typecheck modified files

Run the typecheck for every package containing files you modified:

- Modified `src/server/` → `cd src/server && npx tsc --noEmit`
- Modified `src/client/` → `cd src/client && npx tsc --noEmit`

Both must exit with code 0 before you continue.

### Step 2 — Verify no new unused imports

TypeScript is configured with `noUnusedLocals: true`. Any unused import will fail CI. Before pushing, review every file you modified for imports that are no longer referenced.

### Step 3 — API shape alignment (if backend changes)

If you added or modified a backend route, handler, or shared type, open `src/client/src/api/types.ts` and confirm the response shape your route returns exactly matches the TypeScript interface the client consumes. If they diverged, fix the mismatch and re-run both typechecks.

### Step 4 — Import resolution (if frontend changes)

If you added or modified a component, page, or hook:

1. Confirm every `import` in the modified files resolves to a real file.
2. If you import a CSS module (`*.module.css`), confirm the file exists and `vite-env.d.ts` is present in `src/client/src/`.
3. Confirm no `@/` path alias is broken.

### Step 5 — Check CI after pushing

After pushing, run:

```bash
gh run list --limit 3 --repo nfemmanuel/iranti-control-plane
```

Wait for the run triggered by your push to complete. If it fails, fix it before doing anything else.

### Step 6 — CI must be green before marking done

If CI is red on your push, the ticket is **not done**. Fix CI, push again, confirm green, then write completion to Iranti.

---

*Full protocol details: [docs/protocols/development.md](../../docs/protocols/development.md)*
