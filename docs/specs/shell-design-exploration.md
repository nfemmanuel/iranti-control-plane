# CP-T004 — Shell Design Exploration

**Status**: Complete — awaiting PM visual direction approval before Phase 1 implementation begins
**Author**: frontend_developer
**Date**: 2026-03-20
**Ticket**: CP-T004
**Phase**: 0

---

## Contents

1. [Shell Layout Wireframe](#1-shell-layout-wireframe)
2. [Visual Direction Brief](#2-visual-direction-brief)
3. [Technology Recommendation](#3-technology-recommendation)
4. [Open Questions for PM](#4-open-questions-for-pm)

---

## 1. Shell Layout Wireframe

### 1.1 Navigation Model Decision

**Chosen pattern: Sidebar nav (persistent left rail) + in-section tabs for sub-views**

Rationale:
- The control plane has 7 distinct top-level surfaces that are all peers — no one section is a sub-view of another. Horizontal tabs at the top would either overflow on smaller displays or require a nested structure that hides surfaces.
- A persistent sidebar keeps the active section visible at all times and leaves the full horizontal viewport width for data-dense tables and event feeds.
- The sidebar is the natural home for the always-visible instance context switcher — it sits above the nav items as a first-class affordance rather than squeezed into a top bar.
- Phase 2 embedded chat can be added as a slide-in right panel without restructuring the sidebar or content area. This is explicitly designed in from the start.
- Staff Activity Stream is positioned as a primary nav item (dedicated full-page view) *and* as an optional persistent bottom-drawer for ambient visibility. This gives operators the choice between focused stream inspection and ambient awareness without having to leave the current surface.

**Instance context** lives at the top of the sidebar, always visible, always switchable. It is not buried in a settings page. This satisfies FR4 and the PRD principle "users should always know which instance, project, and database they are looking at."

**Phase 2 chat panel** is designed as a right-rail drawer (collapsible, ~380px wide). The main content area uses `calc(100vw - sidebar_width - chat_panel_width_when_open)` so that opening chat does not overlap content. The shell skeleton reserves this slot from day one; Phase 1 simply does not render the chat panel.

---

### 1.2 Overall Shell Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ OUTER CHROME (100vw × 100vh, no scroll on the outer frame)                   │
│                                                                              │
│ ┌──────────────┐ ┌──────────────────────────────────────┐ ┌───────────────┐ │
│ │ SIDEBAR      │ │ MAIN CONTENT AREA                    │ │ CHAT PANEL    │ │
│ │ 220px fixed  │ │ flex-1, scrolls internally           │ │ 380px         │ │
│ │              │ │                                      │ │ Phase 2 only  │ │
│ │ ┌──────────┐ │ │ ┌──────────────────────────────────┐ │ │ (slot exists  │ │
│ │ │ INSTANCE │ │ │ │ TOPBAR (section title + actions) │ │ │  in DOM,      │ │
│ │ │ SWITCHER │ │ │ │ 48px                             │ │ │  hidden)      │ │
│ │ │          │ │ │ └──────────────────────────────────┘ │ │               │ │
│ │ │ iranti-1 │ │ │                                      │ │               │ │
│ │ │ (active) │ │ │ ┌──────────────────────────────────┐ │ │               │ │
│ │ │   ▾      │ │ │ │ CONTENT (section-specific)       │ │ │               │ │
│ │ └──────────┘ │ │ │ scrolls independently            │ │ │               │ │
│ │              │ │ │                                  │ │ │               │ │
│ │ ──────────── │ │ │                                  │ │ │               │ │
│ │              │ │ │                                  │ │ │               │ │
│ │  ⬡ Overview  │ │ │                                  │ │ │               │ │
│ │  ▦ Memory    │ │ │                                  │ │ │               │ │
│ │  ◫ Archive   │ │ │                                  │ │ │               │ │
│ │  ⚡ Activity  │ │ │                                  │ │ │               │ │
│ │  ⊞ Instances │ │ │                                  │ │ │               │ │
│ │  ♥ Health    │ │ │                                  │ │ │               │ │
│ │  ⚙ Settings  │ │ │                                  │ │ │               │ │
│ │              │ │ └──────────────────────────────────┘ │ │               │ │
│ │ ──────────── │ │                                      │ │               │ │
│ │              │ │ ┌──────────────────────────────────┐ │ │               │ │
│ │  [Activity   │ │ │ ACTIVITY DRAWER (optional)       │ │ │               │ │
│ │   Drawer ↑]  │ │ │ 240px, slide-up, collapsible     │ │ │               │ │
│ │              │ │ │ ambient Staff event tail          │ │ │               │ │
│ └──────────────┘ │ └──────────────────────────────────┘ │ └───────────────┘ │
│                  └──────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Sidebar nav items (in order):**

| Icon | Label | Route | Phase |
|------|-------|-------|-------|
| ⬡ | Overview | `/` | 1 |
| ▦ | Memory | `/memory` | 1 |
| ◫ | Archive | `/archive` | 1 |
| ⚡ | Activity | `/activity` | 1 |
| ⊞ | Instances | `/instances` | 1 |
| ♥ | Health | `/health` | 1 |
| ⚙ | Settings | `/settings` | 2 (placeholder in Phase 1) |

**Activity Drawer** (bottom of sidebar area):
- A toggle button lives at the bottom of the sidebar: "Activity ↑"
- When expanded, a 240px-tall horizontal panel slides up above the sidebar toggle, spanning the full width of the main content area
- Shows a tail of the last 20 Staff events, auto-scrolling
- Does not obscure sidebar nav
- Can be dismissed back to a 32px collapsed state that shows only the latest event badge

---

### 1.3 Memory Explorer View

```
┌── TOPBAR ───────────────────────────────────────────────────────────────────┐
│  Memory Explorer                           [Export ▾]  [Refresh]            │
└─────────────────────────────────────────────────────────────────────────────┘

┌── FILTER BAR ───────────────────────────────────────────────────────────────┐
│  [Search: entity, key, value...    ] [Entity Type ▾] [Source ▾] [Conf ▾]   │
│  [Created By ▾] [Valid At: date   ] [Active only ●]             [Clear ×]  │
└─────────────────────────────────────────────────────────────────────────────┘

┌── TABLE ────────────────────────────────────────────────────────────────────┐
│  Entity                  Key              Summary           Conf  Updated   │
│  ──────────────────────────────────────────────────────────────────────────│
│▶ agent/pm_agent          role             Product manager…   92   2h ago    │
│                                                                             │
│  ── EXPANDED ROW ────────────────────────────────────────────────────────── │
│  │ Entity:      agent/pm_agent                                             │
│  │ Key:         role                                                       │
│  │ Value:       "Product Manager"                                          │
│  │ Source:      handshake                   Confidence: 92                 │
│  │ Created By:  product_manager             Valid From: 2026-03-18         │
│  │ Valid Until: —                                                          │
│  │ [View History]  [View Raw JSON]  [View Related Entities →]             │
│  └──────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  project/iranti_cp       phase            Phase 0 foundation…  88   4h ago │
│  agent/frontend_dev      current_assign…  CP-T004 shell desig… 85   just   │
│  decision/tech_stack     framework        React selected for… 90   1d ago  │
│  …                                                                          │
│                                                                             │
│  ──────────────────────────────────────────────── Showing 1–25 of 142 ──── │
│                              [← Prev]  1  2  3  …  6  [Next →]             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Row click expands inline (accordion). Second click collapses.
- Expanded row shows all temporal metadata and links to history + related entities.
- Filter bar is sticky — scrolling the table does not scroll the filters away.
- "Active only" toggle defaults on (hides archived/superseded rows). One click reveals full archive.
- Column headers are sortable. Default sort: Updated (most recent first).
- Confidence shown as a number (0–100), not a vague label. Operators need the raw signal.

---

### 1.4 Staff Activity Stream View

```
┌── TOPBAR ───────────────────────────────────────────────────────────────────┐
│  Staff Activity                            [Pause ‖]  [Clear]  [Export ▾]  │
└─────────────────────────────────────────────────────────────────────────────┘

┌── FILTER BAR ───────────────────────────────────────────────────────────────┐
│  [Staff: All ▾]  [Action Type ▾]  [Agent ▾]  [Entity contains: ______]    │
│  [Level: Info ● Warn ● Error ●]                           [Live ● / Tail]  │
└─────────────────────────────────────────────────────────────────────────────┘

┌── EVENT FEED (newest at top, auto-scroll unless paused) ────────────────────┐
│                                                                             │
│  10:34:12  LIBRARIAN    write_created       agent/frontend_dev  current_…  │
│            source: handshake · agent: frontend_developer · conf: 85        │
│            ▸ entity: agent/frontend_developer  key: current_assignment      │
│                                                                             │
│  10:33:58  ATTENDANT    handshake           agent/frontend_dev             │
│            task: Phase 0 shell design exploration                           │
│            ▸ 0 memory blocks loaded · session: 2026-03-20T09:58:46Z        │
│                                                                             │
│  10:31:04  ARCHIVIST    decay_scan          —                              │
│            checked 142 facts · 0 decayed · next scan: +6h                  │
│                                                                             │
│  10:28:41  LIBRARIAN    write_escalated     project/iranti_cp  phase       │
│            ⚠ conflict with existing value · escalation file written        │
│            ▸ entity: project/iranti_cp  key: phase  [View Escalation →]   │
│                                                                             │
│  10:25:00  RESOLUTIONIST resolve_accepted   project/iranti_cp  phase       │
│            challenger value accepted · reason: higher confidence            │
│            ▸ [View Resolved Fact →]                                        │
│                                                                             │
│  ──────────────────────────────────── End of session buffer (last 500) ─── │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Feed is append-only, newest at top. "Pause" freezes rendering (events still buffer server-side).
- Each event row is a single compact line by default. Click expands to full event detail.
- Staff component is color-coded using a stable 4-color system (one per component: Librarian, Attendant, Archivist, Resolutionist). These are accent dots, not background floods.
- "Live" mode uses SSE or WebSocket. "Tail" mode shows the last N from the event log (no live connection required — useful for reviewing past sessions).
- Escalation and resolved-fact rows include inline jump links to the relevant Memory/Archive view.
- Level filter (Info/Warn/Error) defaults to all enabled. Operators can suppress Info to focus on anomalies.

---

### 1.5 Instance Manager View

```
┌── TOPBAR ───────────────────────────────────────────────────────────────────┐
│  Instances & Projects                       [+ New Instance]  [Doctor ▾]   │
└─────────────────────────────────────────────────────────────────────────────┘

┌── INSTANCE LIST (left col, ~340px) ──┐ ┌── INSTANCE DETAIL (right col) ───┐
│                                      │ │                                   │
│  ● iranti-1          [active]        │ │  iranti-1                         │
│    localhost:3001                    │ │  ─────────────────────────────── │
│    pg: localhost:5432/iranti         │ │  Runtime root:                    │
│    3 projects bound                  │ │  ~/dev/iranti                     │
│                                      │ │                                   │
│  ○ iranti-staging    [stopped]       │ │  Database:                        │
│    localhost:3002                    │ │  postgres://localhost:5432/iranti  │
│    pg: localhost:5432/iranti_stage   │ │  ✓ Reachable                      │
│    1 project bound                   │ │                                   │
│                                      │ │  Port:  3001   ✓ Listening        │
│  [+ Add Instance]                    │ │                                   │
│                                      │ │  .env.iranti:  ✓ Present          │
│                                      │ │                                   │
│                                      │ │  ── Bound Projects ─────────────  │
│                                      │ │                                   │
│                                      │ │  /Users/nf/dev/control-plane      │
│                                      │ │  claude: ✓   mcp: ✓   codex: ✗   │
│                                      │ │  [Inspect Binding]  [Repair →]   │
│                                      │ │                                   │
│                                      │ │  /Users/nf/dev/other-project      │
│                                      │ │  claude: ✓   mcp: ✓   codex: ✓   │
│                                      │ │  [Inspect Binding]                │
│                                      │ │                                   │
│                                      │ │  /Users/nf/dev/third-project      │
│                                      │ │  claude: ✗   mcp: ✗   codex: ✗   │
│                                      │ │  ⚠ No integrations configured     │
│                                      │ │  [Inspect Binding]  [Setup →]    │
│                                      │ │                                   │
│                                      │ │  ── Instance Actions ───────────  │
│                                      │ │  [Run Doctor]  [Open Escalations] │
│                                      │ │  [Inspect Env]  [Set as Active]   │
└──────────────────────────────────────┘ └───────────────────────────────────┘
```

**Notes:**
- Left column is a scrollable instance list. Active instance has a filled indicator.
- Right column is a detail panel for the selected instance.
- Project bindings show integration status inline as compact status dots/badges.
- Actions call existing CLI/API operations — no direct DB mutation from this surface.
- "Set as Active" changes the shell's current instance context (visible in the sidebar switcher).

---

## 2. Visual Direction Brief

**No existing Iranti brand guide or design system was found in this repository.** The visual direction below is anchored to the product character described in the PRD ("local-first, operator-grade, readable for long sessions, not a generic dashboard") and the product principles ("readability before cleverness," "progressive power," "staff-centric observability"). The PM must confirm whether an upstream Iranti brand reference exists before finalizing visual tokens in Phase 1.

---

### Option A — "Fieldwork": Warm Editorial

**Character**: The control plane as a research notebook. Warm amber and stone tones replace cold steel grays. Typography is confident and slightly humanistic rather than corporate sans-serif. Dense data tables feel like well-organized field notes rather than a SaaS admin grid. Operators who work with this surface for hours feel oriented and calm, not sterile.

This option is intentionally warm without sacrificing precision. The amber accent is used sparingly — only for active states, highlights, and warnings — so it retains signal value. The surface colors are warm off-whites and warm near-blacks rather than pure `#FFFFFF` / `#000000`.

#### Light Mode

| Role | Token name | Hex | Notes |
|------|-----------|-----|-------|
| Background (canvas) | `--bg-canvas` | `#F7F4EF` | Warm parchment, not white |
| Background (surface) | `--bg-surface` | `#EFEBE3` | Sidebar, panels |
| Background (elevated) | `--bg-elevated` | `#FFFFFF` | Modals, dropdowns |
| Border (subtle) | `--border-subtle` | `#DDD8CE` | Row dividers |
| Border (default) | `--border-default` | `#C4BDB0` | Input outlines, panel edges |
| Text (primary) | `--text-primary` | `#1C1917` | Near-black, warm undertone |
| Text (secondary) | `--text-secondary` | `#6B6460` | Labels, meta |
| Text (muted) | `--text-muted` | `#9C9490` | Timestamps, disabled |
| Accent (primary) | `--accent-primary` | `#B45309` | Active nav, links, CTAs — amber-brown |
| Accent (hover) | `--accent-hover` | `#92400E` | Deeper amber on hover |
| Accent (subtle bg) | `--accent-subtle` | `#FEF3C7` | Selected row background |
| Success | `--status-success` | `#15803D` | Reachable/healthy indicators |
| Warning | `--status-warning` | `#B45309` | Shared with accent — intentional |
| Error | `--status-error` | `#DC2626` | Escalations, connection errors |
| Librarian (Staff) | `--staff-librarian` | `#B45309` | Amber — writes and ingestion |
| Attendant (Staff) | `--staff-attendant` | `#0369A1` | Slate blue — session presence |
| Archivist (Staff) | `--staff-archivist` | `#6D28D9` | Violet — decay and archival |
| Resolutionist (Staff) | `--staff-resolutionist` | `#0F766E` | Teal — resolution decisions |

#### Dark Mode

| Role | Token name | Hex | Notes |
|------|-----------|-----|-------|
| Background (canvas) | `--bg-canvas` | `#1A1714` | Very dark warm brown-black |
| Background (surface) | `--bg-surface` | `#232019` | Sidebar, panels |
| Background (elevated) | `--bg-elevated` | `#2C2820` | Cards, dropdowns |
| Border (subtle) | `--border-subtle` | `#38332A` | Row dividers |
| Border (default) | `--border-default` | `#4A4438` | Input outlines |
| Text (primary) | `--text-primary` | `#F5F0E8` | Warm off-white |
| Text (secondary) | `--text-secondary` | `#A89E92` | Labels, meta |
| Text (muted) | `--text-muted` | `#6B6258` | Timestamps |
| Accent (primary) | `--accent-primary` | `#F59E0B` | Bright amber on dark bg |
| Accent (hover) | `--accent-hover` | `#FCD34D` | Lighter amber on hover |
| Accent (subtle bg) | `--accent-subtle` | `#2D2410` | Selected row — very dark amber |
| Success | `--status-success` | `#22C55E` | Brighter green for dark contrast |
| Warning | `--status-warning` | `#F59E0B` | Same amber |
| Error | `--status-error` | `#F87171` | Lightened red for dark bg |
| Librarian (Staff) | `--staff-librarian` | `#F59E0B` | |
| Attendant (Staff) | `--staff-attendant` | `#38BDF8` | |
| Archivist (Staff) | `--staff-archivist` | `#A78BFA` | |
| Resolutionist (Staff) | `--staff-resolutionist` | `#2DD4BF` | |

#### Typography

**Primary**: `"Inter"` (variable font, weights 400/500/600/700)
- Rationale: Excellent tabular number support via `font-variant-numeric: tabular-nums`. Readable at 12px–13px for dense table content. Available via `@fontsource/inter` (no external CDN dependency at runtime — bundles with the app). Familiar to operators but clean enough to feel modern.
- Fallback stack: `"Inter", system-ui, -apple-system, sans-serif`

**Monospace** (raw values, JSON inspector, event payloads): `"JetBrains Mono"` or `"Fira Code"` (variable, weight 400/500)
- Rationale: Data-dense operator tools benefit from a readable monospace. JetBrains Mono has excellent readability at small sizes and ships via `@fontsource/jetbrains-mono`.
- Fallback: `"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace`

#### Spacing and Density

**Compact** — this is an operator tool, not a marketing page.
- Base unit: 4px
- Table row height: 36px (not the 48–56px common in consumer SaaS)
- Table font size: 13px for data rows, 11px for metadata/timestamps
- Sidebar nav item height: 32px
- Input height: 32px
- Section content padding: 16px (not 32–48px)
- Dense tables use `border-collapse: collapse` with 1px dividers, not card-per-row layouts

---

### Option B — "Terminals": Cool Technical

**Character**: The control plane as a precision instrument. Dark substrates by default (though a clean light mode exists). Cool slate and zinc tones with a single sharp mint-green accent. Monospace elements feel at home alongside prose. Typography is neutral and highly legible — more tool than product. The kind of interface that disappears and lets operators focus entirely on the data. Operators who use a terminal daily will feel immediately at home.

This option leans into the local, grounded character of Iranti without trying to look warm or editorial. The mint accent is deliberately unusual for operator tooling — it avoids the standard blue/teal combinations and carries more character than generic green.

#### Light Mode

| Role | Token name | Hex | Notes |
|------|-----------|-----|-------|
| Background (canvas) | `--bg-canvas` | `#F4F6F8` | Cool near-white |
| Background (surface) | `--bg-surface` | `#ECEEF2` | Sidebar |
| Background (elevated) | `--bg-elevated` | `#FFFFFF` | Modals |
| Border (subtle) | `--border-subtle` | `#DDE1E8` | Row dividers |
| Border (default) | `--border-default` | `#C6CDD8` | Inputs |
| Text (primary) | `--text-primary` | `#0F1117` | Near-black, cool undertone |
| Text (secondary) | `--text-secondary` | `#5A6374` | Labels |
| Text (muted) | `--text-muted` | `#8A93A2` | Timestamps |
| Accent (primary) | `--accent-primary` | `#059669` | Sharp emerald-mint — not teal, not lime |
| Accent (hover) | `--accent-hover` | `#047857` | Deeper on hover |
| Accent (subtle bg) | `--accent-subtle` | `#ECFDF5` | Selected row |
| Success | `--status-success` | `#059669` | Shared with accent |
| Warning | `--status-warning` | `#D97706` | Amber — distinct from accent |
| Error | `--status-error` | `#DC2626` | Red |
| Librarian (Staff) | `--staff-librarian` | `#D97706` | Amber |
| Attendant (Staff) | `--staff-attendant` | `#7C3AED` | Violet |
| Archivist (Staff) | `--staff-archivist` | `#0EA5E9` | Sky blue |
| Resolutionist (Staff) | `--staff-resolutionist` | `#059669` | Mint — shared with accent |

#### Dark Mode

| Role | Token name | Hex | Notes |
|------|-----------|-----|-------|
| Background (canvas) | `--bg-canvas` | `#0D1117` | GitHub-dark-adjacent, very deep cool |
| Background (surface) | `--bg-surface` | `#161B22` | Sidebar |
| Background (elevated) | `--bg-elevated` | `#1F2937` | Cards, dropdowns |
| Border (subtle) | `--border-subtle` | `#21262D` | Row dividers |
| Border (default) | `--border-default` | `#30363D` | Inputs |
| Text (primary) | `--text-primary` | `#E6EDF3` | Cool off-white |
| Text (secondary) | `--text-secondary` | `#8B949E` | Labels |
| Text (muted) | `--text-muted` | `#484F58` | Timestamps |
| Accent (primary) | `--accent-primary` | `#10B981` | Bright emerald on dark |
| Accent (hover) | `--accent-hover` | `#34D399` | Lighter on hover |
| Accent (subtle bg) | `--accent-subtle` | `#064E3B` | Selected row — deep green |
| Success | `--status-success` | `#10B981` | |
| Warning | `--status-warning` | `#F59E0B` | |
| Error | `--status-error` | `#F87171` | |
| Librarian (Staff) | `--staff-librarian` | `#F59E0B` | |
| Attendant (Staff) | `--staff-attendant` | `#A78BFA` | |
| Archivist (Staff) | `--staff-archivist` | `#38BDF8` | |
| Resolutionist (Staff) | `--staff-resolutionist` | `#10B981` | |

#### Typography

**Primary**: System font stack — no web font loaded
- `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Rationale: Zero network/bundle overhead. On macOS this resolves to SF Pro, on Windows to Segoe UI, both of which are excellent at small sizes. For a local-first tool this is the right call for Option B specifically — it maximizes native integration and avoids a bundled font as a dependency.

**Monospace**: `"Cascadia Code"` preferred (already present on Windows 11), `"Fira Code"` as fallback
- Fallback: `"Cascadia Code", "Fira Code", ui-monospace, monospace`

#### Spacing and Density

Same compact density model as Option A (4px base unit, 36px table rows, 13px data font). No difference in density between options — both serve operator use cases. The visual feel differs, not the information density.

---

### Visual Direction Recommendation (for PM consideration)

Both options are fully resolved and implementable. The choice is a product personality decision, not a technical one.

**Option A (Fieldwork)** is recommended if Iranti wants to feel crafted, approachable, and editorially distinctive — unusual for a data tool, which is what makes it memorable.

**Option B (Terminals)** is recommended if Iranti wants to feel tool-native, familiar to developer operators, and zero-friction to pick up for anyone comfortable in a terminal.

The PM must approve one of these options before Phase 1 begins. The visual direction gates CP-E006 (design system token implementation).

---

## 3. Technology Recommendation

### Summary: Recommended Stack

| Concern | Recommendation |
|---------|---------------|
| Framework | **React 18** (with Vite) |
| Bundler | **Vite** |
| Component library | **Radix UI primitives + custom styles** |
| CSS approach | **CSS custom properties + CSS modules** |
| State management | **React Query (TanStack Query) + local `useState`/`useReducer`** |
| Routing | **React Router v6 (SPA, client-side)** |

---

### Framework: React 18

**Evaluated**: React 18, Svelte 5, Vue 3, vanilla JS + web components, HTMX

**Recommendation: React 18**

**Rationale:**

React is the right choice for this product for several concrete reasons:

1. **Real-time data complexity**: The Staff Activity Stream requires an append-only live feed sourced from SSE or WebSocket, filtered client-side in real time, with event expansion, level filtering, pause/resume, and inline links to related data. This is non-trivial reactive UI. React's component model and ecosystem (specifically React Query's `useInfiniteQuery` and SSE integration patterns) handles this more cleanly than Svelte or Vue at the wiring level — not because of framework capability, but because the patterns are more established and the team is most likely to find prior art quickly.

2. **Radix UI availability**: The visual direction brief calls for a headless component library with fully custom visual styling (see Component Library stance below). Radix UI is the best option for this, and it is React-only. Radix provides accessible, unstyled primitives for every operator UI pattern needed: dropdown menus, dialogs, comboboxes, tabs, tooltips, accordion rows. Building these correctly from scratch is a significant time investment; Radix eliminates it without dictating aesthetics.

3. **Developer velocity**: The single most consistent predictor of velocity on a small-team product is ecosystem familiarity. React's ecosystem (hooks, React Query, React Router, Radix) has the largest surface area of solved problems and the largest pool of documentation. For a local tool where "fast to correct" matters more than "architected for 100 engineers," this wins.

4. **Build complexity is manageable**: React + Vite is not heavy. The resulting bundle for this control plane will be in the 150–300KB range gzip-compressed — perfectly acceptable for a local-only tool served from localhost. There is no CDN latency, no mobile data concern, and no SEO constraint. The "heavyweight SPA" objection is a production deployment concern, not a local tool concern.

**Where Svelte and Vue lose:**

- **Svelte 5**: Compelling for bundle size and reactivity model. However, Radix UI does not support Svelte (there are community ports, but they lag). The visual identity requirement is strong enough that building accessible primitives from scratch is risky scope. Svelte also has a smaller pool of operator-tool UI patterns to draw from.
- **Vue 3**: Excellent framework. Headless UI (Tailwind Labs) supports Vue, but with a narrower primitive set than Radix. Vue is a legitimate alternative if the team has strong Vue preference — but absent that, the React + Radix pairing is more complete.
- **Vanilla JS + web components**: Acceptable for very simple read-only dashboards. Not appropriate when the complexity includes real-time SSE feeds, complex filter state, row expansion with nested data, and eventually embedded chat. The maintenance burden of managing DOM state manually at that complexity level exceeds the value of no framework.
- **HTMX**: Appropriate for server-rendered hypermedia apps. The control plane has meaningful client-side state (filter state, live event buffering, row expansion, sidebar instance context) that makes HTMX's server-round-trip model awkward. HTMX is a strong choice for form-heavy, CRUD-heavy apps; it is the wrong fit for a real-time event stream with rich client-side interactivity.

---

### Bundler: Vite

**Evaluated**: Vite, esbuild, Webpack, no bundler (direct ES modules)

**Recommendation: Vite**

**Rationale:**

- Near-instant dev server startup via native ES module serving (HMR is <50ms for this size codebase)
- Production build via Rollup produces well-tree-shaken output
- First-class React + TypeScript support with zero config
- CSS modules, PostCSS, and asset handling all built in
- No configuration sprawl — the default config is the right config for 95% of this project's lifetime

**Why not esbuild directly**: esbuild is what Vite uses internally for transforms. Using it directly loses the dev server, HMR, and plugin ecosystem without gaining meaningful build speed improvement at this project's scale.

**Why not Webpack**: Configuration complexity with no benefit for a project this size. Webpack is appropriate for monorepos or highly specialized chunking strategies, neither of which applies here.

**Why not no bundler**: Direct ES modules work for trivially small projects. This project will have 15–25 routes/views, a component library, React Query, and multiple icon sets. The import graph will be large enough that HTTP/2 multiplexing on localhost does not fully compensate for hundreds of individual module fetches on cold load. A bundler is the right call.

---

### Component Library: Radix UI Primitives + Custom Styles

**Evaluated**: (a) Headless + custom styles (Radix UI, Headless UI), (b) full design system (shadcn/ui, Mantine, Ant Design), (c) build from scratch

**Recommendation: Radix UI primitives with fully custom CSS (no shadcn/ui, no Mantine)**

This is the most important technology decision in this document, and it requires explicit reasoning because the instinct to reach for shadcn/ui or Mantine is strong and reasonable.

**Why not shadcn/ui**: shadcn/ui is Radix UI + Tailwind + opinionated visual defaults. The visual defaults are well-designed but they produce a recognizable aesthetic — the one the PRD explicitly prohibits ("not a generic admin dashboard"). Every shadcn/ui app has the same rounded corners, the same gray/slate surface system, the same ring-focus style. Overriding those defaults deeply enough to produce either Option A or Option B's visual identity requires as much work as starting from Radix directly, without the clean separation. Additionally, shadcn/ui couples to Tailwind, which creates a constraint on CSS approach (see below).

**Why not Mantine or Ant Design**: These ship opinionated full design systems with blue primaries, specific component shapes, and bundled icon libraries. They are genuinely excellent for internal tools that have no visual identity requirements. Given the PRD's explicit "distinctive, beautiful, intentional visual systems" requirement, adopting a pre-styled component library is accepting a visual ceiling. Fighting a design system's opinions costs more than building on unstyled primitives.

**Why Radix UI directly**:
- Provides accessible, keyboard-navigable, WAI-ARIA-compliant primitives for every complex component type needed: `Dialog`, `DropdownMenu`, `Tabs`, `Accordion`, `Tooltip`, `Select`, `Combobox`, `Popover`, `Toggle`
- Completely unstyled — it renders zero visual opinion. All visual expression comes from our CSS custom properties.
- React-only (not a constraint since React is our framework)
- Stable API, well-maintained, used in production by major products

**The cost**: Radix provides behavior, not visual components. Every component needs to be styled. This is a feature, not a bug — it means the visual system is fully owned — but it is real implementation work. That work is Phase 1 scope (CP-E006). The Phase 0 exploration specifically calls out that building the component library is Phase 1 work, not now.

**Simple components** (tables, filter bars, event rows, status badges) do not need Radix — those are plain HTML + CSS. Radix is only used where accessible interactive behavior is genuinely complex to implement correctly from scratch.

---

### CSS Approach: CSS Custom Properties + CSS Modules

**Evaluated**: CSS modules, Tailwind, vanilla CSS with custom properties, styled-components

**Recommendation: CSS custom properties (design tokens) + CSS modules (component scoping)**

**Rationale:**

The visual direction brief defines a complete semantic token system (both options use the same token names). CSS custom properties are the most direct implementation of that token system:

```css
/* globals.css */
:root {
  --bg-canvas: #F7F4EF;
  --accent-primary: #B45309;
  /* ... all tokens ... */
}

[data-theme="dark"] {
  --bg-canvas: #1A1714;
  --accent-primary: #F59E0B;
  /* ... */
}
```

Dark mode switching is then a single `data-theme="dark"` attribute on `<html>` — no JavaScript class toggling, no duplicate style blocks. Any component automatically responds to theme switches because it reads from the custom property, not a hardcoded value.

CSS modules provide scoped class names at the component level, eliminating global style leakage without the runtime overhead of CSS-in-JS.

**Why not Tailwind**: Tailwind is excellent for teams that want to move fast without writing CSS. However, it creates friction with a semantic token system because Tailwind utility classes carry visual values inline. Deep theming (especially the warm-vs-cool two-option visual system described here) requires Tailwind's `@layer` customization, which partially defeats the "utility classes as the source of truth" mental model. More importantly: committing to Tailwind would force shadcn/ui as the component library (they are deeply coupled), which has the downstream consequences described above. The CSS approach and component library choices are coupled — separating them cleanly requires CSS modules.

**Why not styled-components**: Runtime CSS-in-JS is unnecessary overhead for a local tool. It also makes the token system more awkward to express (theme providers via React context add indirection). CSS custom properties are simpler and faster.

---

### State Management: React Query + Local State

**Evaluated**: Redux Toolkit, Zustand, Jotai, React Query alone, plain `useState`/`useReducer`

**Recommendation: TanStack Query (React Query v5) for server state + `useState`/`useReducer` for local UI state**

**Rationale:**

Phase 1 is primarily read-only: data flows from the server (control plane API) into display components. There is no complex cross-cutting client state that would justify a global state manager like Redux or Zustand.

React Query handles:
- Fetching KB table data, archive data, instance list, health status
- Cache invalidation and background refetching
- Loading and error states
- Pagination and infinite scroll (Memory Explorer)

Local `useState` / `useReducer` handles:
- Filter bar state (which filters are active)
- Row expansion state (which rows are open)
- Sidebar collapse state
- Activity drawer open/closed state

The live SSE event stream (Staff Activity) is handled directly with a custom `useEventStream` hook wrapping `EventSource` — React Query is not the right abstraction for an infinite append-only stream. The hook manages the event buffer, pause state, and filter application locally.

**No global state manager is needed for Phase 1.** If Phase 2 (embedded chat with conversation history, complex cross-panel linking) creates state that genuinely needs to be shared across many unrelated components, adding Zustand at that point is a one-day refactor — it is not a foundation that needs to be laid now.

---

### Routing: React Router v6 (SPA, client-side)

**SPA vs MPA decision:**

**Recommendation: SPA with client-side routing via React Router v6.**

**Reasoning:**

This is a local web app with no SEO requirement, no crawlability requirement, and a small, stable set of routes. The case for server-side rendering (MPA or SSR) would be:
- faster initial page load (not a concern on localhost)
- SEO (not applicable)
- progressive enhancement for poor JS environments (not applicable — this is a developer tool on a machine that's running Node.js)

The case for SPA:
- instant navigation between sections (no page reload, no round-trip)
- persistent sidebar and activity drawer state across navigation (no re-render of chrome)
- real-time SSE stream continuity (the EventSource connection survives route changes)
- simpler architecture (Express serves `index.html` for all routes; no per-route server handlers)

**Route structure:**

```
/                     → Overview / Home (Health summary + recent activity)
/memory               → Memory Explorer (KB table)
/memory/:entityType/:entityId/:key  → Entity Detail + Temporal History
/archive              → Archive Explorer
/activity             → Staff Activity Stream
/instances            → Instance & Project Manager
/instances/:id        → Instance Detail (deep-linked)
/health               → Health & Diagnostics
/settings             → Settings / Config (Phase 2 placeholder)
```

React Router v6's nested route support means the shell chrome (sidebar, topbar) is rendered once in a root layout route, and only the content area re-renders on navigation. This is the correct implementation for a persistent sidebar.

**Hash routing** (`/#/memory`) is an alternative that simplifies Express configuration (no catch-all needed). However, clean path routing is preferable for a developer tool where operators may deep-link to a specific entity detail from a bug report or terminal output. The Express server will serve `index.html` for all unrecognized paths — a two-line configuration.

---

## 4. Open Questions for PM

These questions arose during this exploration. They must be answered before Phase 1 implementation begins. They are ordered by blocking priority.

---

**Q1 (Blocking — visual tokens gate CP-E006):** Is there an existing Iranti brand guide, design system, color palette, or visual reference that should constrain or inform the control plane visual direction?

No such reference was found in this repository. If one exists upstream (in the main Iranti repo or in product documentation not checked into this repo), it must be shared before Option A or Option B is finalized. If no reference exists, that is a relevant finding: the control plane will be establishing the first intentional Iranti visual language, and that decision should be made consciously.

---

**Q2 (Blocking — visual direction gate):** Which visual direction option does the PM approve for Phase 1 implementation — Option A (Fieldwork, warm amber/stone) or Option B (Terminals, cool slate/mint)?

Per CP-T004's Definition of Done, this approval is a hard gate. No Phase 1 frontend implementation begins without a written PM decision.

---

**Q3 (High priority — affects layout):** Should the Staff Activity Stream be a primary nav destination (full-page view) only, or should it also be a persistent ambient drawer available from any section?

The wireframe above designs both: a full-page Activity view for focused inspection, and an optional slide-up Activity Drawer accessible from the bottom of the sidebar from any section. This is the recommended approach because operators often want ambient awareness without navigating away from Memory Explorer mid-investigation. However, this adds implementation scope (the drawer component) and the PM should confirm it is in Phase 1 scope or defer the drawer to Phase 2.

---

**Q4 (Medium priority — affects shell structure):** Should the Phase 2 chat panel slot be included in the Phase 1 DOM structure (as a hidden/empty element) or should the layout be refactored when chat is added in Phase 2?

Including it now is lower-risk (no Phase 2 restructuring of the outer shell) but adds a small amount of Phase 1 complexity. Deferring it is simpler now but creates a layout refactor risk in Phase 2. The recommendation is to include the slot in Phase 1 as a commented-out or hidden structural element. PM should confirm.

---

**Q5 (Medium priority — affects routing):** Should the control plane shell support multiple browser tabs open simultaneously against the same local instance?

If yes, state management must account for concurrent reads from the same data source with no cross-tab synchronization primitives (since this is a local web app, not a shared session). The primary concern is the Staff Activity Stream: two open tabs will both establish SSE connections to the same endpoint. This is fine for read-only event consumption but should be confirmed as an acceptable pattern. If the answer is "one tab only," a `BroadcastChannel` or `localStorage` lock can enforce that with a user-facing notice.

---

**Q6 (Medium priority — affects Phase 1 scope):** Is keyboard-first navigation a Phase 1 requirement?

Radix UI primitives provide full keyboard navigation for interactive components (dropdowns, dialogs, tabs) by default. The question is whether the broader shell — specifically the data tables, filter bars, and event feed — must be navigable entirely by keyboard in Phase 1. Full keyboard navigation for tables (row selection, expansion, column focus) is meaningful implementation scope. If this is a Phase 1 requirement, it should be reflected in acceptance criteria for CP-E006 and the Memory Explorer tickets.

---

**Q7 (Low priority — affects tech choice validation):** Does the team have a strong existing preference for a framework other than React?

The React recommendation stands on its merits, but if there is existing team expertise in Vue 3 or Svelte 5 that was not documented at the time of this exploration, that should be surfaced before Phase 1 begins. Framework choice is sticky — it is not worth overriding team familiarity for marginal architectural gains at this project's scale.

---

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Shell layout wireframe covers all 7 Phase 1 surfaces | ✓ Overview, Memory, Archive, Activity, Instances, Health, Settings (placeholder) — all present in nav and wireframed |
| Visual direction includes 2 distinct options with light + dark variants | ✓ Option A (Fieldwork) and Option B (Terminals) — each with full light and dark hex palettes |
| Neither palette resembles a generic gray/blue admin dashboard | ✓ Option A uses amber/stone; Option B uses mint/slate. Neither uses blue as primary. |
| Technology recommendation is concrete (not "React or Vue") | ✓ React 18, Vite, Radix UI, CSS modules, React Query, React Router v6 — each named explicitly |
| SPA vs MPA question is explicitly addressed | ✓ Section 3, Routing — SPA recommended with full rationale |
| Output document exists at `docs/specs/shell-design-exploration.md` | ✓ This document |
| PM review required before Phase 1 implementation | ✓ Noted in summary, Section 2 recommendation, and Q2 open question |

---

*This document is complete as of 2026-03-20. It is pending PM review and approval of visual direction before Phase 1 frontend work begins.*
