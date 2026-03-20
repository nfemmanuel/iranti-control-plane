# Iranti Control Plane — Visual Token Reference

**Option B: Terminals** — Approved 2026-03-20 by product_manager
**Source of truth**: `decision/visual_direction` in Iranti + `docs/specs/shell-design-exploration.md`
**Implementation**: `src/client/src/styles/tokens.css`

This document is the reference for all CP Phase 1 frontend work. All components must use the token names below — no hardcoded hex values in component CSS.

---

## How to Use Tokens

All tokens are CSS custom properties defined on `:root` (dark mode, the default) and overridden on `[data-theme="light"]`. Any component that references a token automatically responds to theme switching — no JavaScript needed.

```css
/* In any component .module.css file: */
.myComponent {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.myComponent:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-strong);
}

.activeState {
  color: var(--color-accent-primary);
  background: var(--color-accent-subtle);
  border-left: 2px solid var(--color-accent-primary);
}
```

Theme is toggled by setting `data-theme="light"` on `<html>` (or removing the attribute for dark). The `AppShell` component handles this toggle and persists the choice in `localStorage` under the key `iranti-cp-theme`.

---

## Background Tokens

| Token | Semantic Role | Dark hex | Light hex |
|-------|--------------|----------|-----------|
| `--color-bg-base` | Main canvas — outermost background | `#0D1117` | `#F4F6F8` |
| `--color-bg-surface` | Cards, sidebar, panels, table headers | `#161B22` | `#ECEEF2` |
| `--color-bg-elevated` | Dropdowns, modals, tooltips, hover states | `#1F2937` | `#FFFFFF` |
| `--color-bg-sunken` | Input fields, code blocks, inset areas | `#090D12` | `#E4E7ED` |

**Usage guidance**: Most views use `--color-bg-base` for their root background. Sidebar and panels use `--color-bg-surface`. Dropdown menus and dialogs use `--color-bg-elevated`. Input `<textarea>` and code block backgrounds use `--color-bg-sunken`.

---

## Border Tokens

| Token | Semantic Role | Dark hex | Light hex |
|-------|--------------|----------|-----------|
| `--color-border-subtle` | Table row dividers, section separators | `#21262D` | `#DDE1E8` |
| `--color-border-default` | Input borders, card outlines, default UI borders | `#30363D` | `#C6CDD8` |
| `--color-border-strong` | Active borders, focus rings, hovered inputs | `#484F58` | `#9AA3AD` |

**Usage guidance**: Default most borders to `--color-border-default`. Use `--color-border-subtle` for high-frequency dividers (every table row). Reserve `--color-border-strong` for interactive states (focus, hover) where the border needs to stand out.

---

## Text Tokens

| Token | Semantic Role | Dark hex | Light hex |
|-------|--------------|----------|-----------|
| `--color-text-primary` | Main body text, headings, values | `#E6EDF3` | `#0F1117` |
| `--color-text-secondary` | Labels, metadata, nav items, column headers | `#8B949E` | `#5A6374` |
| `--color-text-tertiary` | Timestamps, placeholder text, disabled states | `#484F58` | `#8A93A2` |
| `--color-text-inverse` | Text rendered on accent-colored backgrounds | `#0D1117` | `#FFFFFF` |

**Usage guidance**: Table data values: `--color-text-primary`. Column headers and filter labels: `--color-text-secondary`. Timestamps and "updated 2h ago" metadata: `--color-text-tertiary`. Buttons with accent background: `--color-text-inverse`.

---

## Accent Tokens

| Token | Semantic Role | Dark hex | Light hex |
|-------|--------------|----------|-----------|
| `--color-accent-primary` | Active nav, primary links, primary button, interactive focus | `#10B981` | `#059669` |
| `--color-accent-hover` | Accent hover state (links, buttons) | `#34D399` | `#047857` |
| `--color-accent-subtle` | Selected row background, active nav background tint | `#064E3B` | `#ECFDF5` |
| `--color-accent-border` | Borders on accent-tinted surfaces | `#065F46` | `#A7F3D0` |

**Usage guidance**: The emerald/mint accent is used sparingly — only for active/selected/interactive states and primary CTAs. Do not use accent for decorative purposes. Active nav items: accent primary text + accent subtle background + accent primary left border. Selected table rows: accent subtle background.

---

## Status Tokens

| Token | Semantic Role | Dark hex | Light hex |
|-------|--------------|----------|-----------|
| `--color-status-success` | Healthy indicators, success badges, connected status | `#10B981` | `#059669` |
| `--color-status-success-bg` | Background for success state containers | `#064E3B` | `#ECFDF5` |
| `--color-status-warning` | Degraded indicators, conflict warnings, escalations | `#F59E0B` | `#D97706` |
| `--color-status-warning-bg` | Background for warning state containers | `#1A1400` | `#FFFBEB` |
| `--color-status-error` | Error badges, failed/unreachable indicators | `#F87171` | `#DC2626` |
| `--color-status-error-bg` | Background for error state containers | `#1A0808` | `#FEF2F2` |
| `--color-status-info` | Informational badges, in-progress states | `#3B82F6` | `#2563EB` |
| `--color-status-info-bg` | Background for info state containers | `#0A1628` | `#EFF6FF` |

**Usage guidance**: Use the `*-bg` token with its corresponding foreground token for status containers (e.g., a "healthy" badge: `background: var(--color-status-success-bg); color: var(--color-status-success)`). Don't mix foreground from one status with background from another.

---

## Staff Component Color Tokens

These colors identify Iranti's four internal components (Staff). They are used for accent dots, labels, event tags, and timeline markers in the Activity stream and Memory views. They are NOT used for large background fills.

| Token | Staff Component | Dark hex | Light hex | Role / behavior |
|-------|----------------|----------|-----------|-----------------|
| `--color-staff-librarian` | Librarian | `#F59E0B` | `#D97706` | Amber — writes, ingestion, fact creation |
| `--color-staff-attendant` | Attendant | `#A78BFA` | `#7C3AED` | Violet — session presence, fact reads, handshake |
| `--color-staff-archivist` | Archivist | `#38BDF8` | `#0EA5E9` | Sky blue — decay scanning, archival, supersession |
| `--color-staff-resolutionist` | Resolutionist | `#10B981` | `#059669` | Mint — conflict resolution, accepted/rejected decisions |

**Usage guidance**: Each Staff event or timeline entry should carry a small color-coded indicator using these tokens. Example: `color: var(--color-staff-librarian)` on a "LIBRARIAN" label in the Activity stream. Do not fill large background areas with these colors — they lose signal value at scale.

---

## Typography

| Token | Value | Notes |
|-------|-------|-------|
| `--font-sans` | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | Zero network/bundle overhead. SF Pro on macOS, Segoe UI on Windows. Both excellent at 12–13px data density. |
| `--font-mono` | `"Cascadia Code", "Fira Code", ui-monospace, monospace` | For entity IDs, key names, JSON values, raw fact values. Cascadia Code already present on Windows 11. |

**Type scale in use:**

| Usage | Size | Weight | Color token |
|-------|------|--------|-------------|
| Section titles (topbar) | 14px | 500 | `--color-text-primary` |
| Nav labels | 13px | 400 | `--color-text-secondary` → primary on active |
| Table data rows | 13px (via `--table-font-size`) | 400 | `--color-text-primary` |
| Table column headers | 11px | 500 | `--color-text-secondary` |
| Metadata / timestamps | 11px (via `--table-meta-font-size`) | 400 | `--color-text-tertiary` |
| Filter labels | 12px | 400 | `--color-text-secondary` |
| Entity/key values (mono) | 12px | 400 | `--font-mono` + `--color-text-primary` |
| Instance name (mono) | 12px | 400 | `--font-mono` + `--color-text-secondary` |
| Logo wordmark | 15px | 600 | `--color-text-primary` |
| Section labels (uppercase) | 10px | 500 | `--color-text-tertiary`, `letter-spacing: 0.08em` |

---

## Spacing Scale

| Token | Value | Common usage |
|-------|-------|--------------|
| `--space-1` | 4px | Tight gaps (icon to label, badge padding) |
| `--space-2` | 8px | Small gaps (input padding, button padding) |
| `--space-3` | 12px | Table cell horizontal padding, dropdown item padding |
| `--space-4` | 16px | Standard content padding (`--section-padding` default) |
| `--space-5` | 20px | Medium gaps |
| `--space-6` | 24px | Section gaps |
| `--space-8` | 32px | Large gaps |

---

## Density Constants

| Token | Value | Applied to |
|-------|-------|------------|
| `--table-row-height` | 36px | All data table rows |
| `--table-header-height` | 32px | All table `<th>` rows |
| `--table-font-size` | 13px | Table data cells |
| `--table-meta-font-size` | 11px | Timestamps, secondary metadata in cells |
| `--input-height` | 32px | All form inputs, filter bar controls |
| `--nav-item-height` | 32px | Sidebar nav item height |
| `--section-padding` | 16px | Default horizontal padding inside content areas |

---

## Layout Constants

| Token | Value | Notes |
|-------|-------|-------|
| `--sidebar-width` | 220px | Fixed left rail — never changes in Phase 1 |
| `--header-height` | 48px | Topbar height |
| `--activity-drawer-height` | 240px | Expanded activity drawer |
| `--activity-drawer-collapsed-height` | 32px | Collapsed drawer toggle bar |
| `--chat-panel-width` | 380px | Phase 2 only — not used in Phase 1 |

---

## Border Radius

| Token | Value | Used for |
|-------|-------|----------|
| `--border-radius-sm` | 4px | Buttons, small badges, toggle inputs |
| `--border-radius-md` | 6px | Dropdown menus, tooltips, cards |
| `--border-radius-lg` | 8px | Modals, large panels |

---

## Component Examples

### Status badge

```css
.badgeSuccess {
  color: var(--color-status-success);
  background: var(--color-status-success-bg);
  border: 1px solid var(--color-status-success);
  border-radius: var(--border-radius-sm);
  font-size: 11px;
  padding: 1px var(--space-2);
}
```

### Active nav item

```css
.navItemActive {
  color: var(--color-accent-primary);
  background: var(--color-accent-subtle);
  border-left: 2px solid var(--color-accent-primary);
}
```

### Staff event label

```css
.eventLabelLibrarian {
  color: var(--color-staff-librarian);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

### Table row with expansion

```css
.tableRow {
  height: var(--table-row-height);
  font-size: var(--table-font-size);
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 0.1s;
}

.tableRow:hover {
  background: var(--color-bg-elevated);
}

.tableRowExpanded {
  background: var(--color-accent-subtle);
}

.expandedContent {
  padding: var(--space-3) var(--section-padding);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border-subtle);
}
```

### Monospace entity/key cell

```css
.entityCell {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.keyCell {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-secondary);
}
```

---

*This document is authoritative for all Phase 1 frontend work. Any token name change must be reflected here, in `tokens.css`, and communicated to all active frontend tickets.*
