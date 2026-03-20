/* Iranti Control Plane — Command Palette */
/* CP-T024 — Global Cmd+K / Ctrl+K command palette */
/* CP-T042 — Inline help: descriptions + shortcuts section + "?" footer trigger */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import styles from './CommandPalette.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface NavCommand {
  type: 'nav'
  id: string
  label: string
  icon: string
  to: string
  description: string
  hint?: string
}

interface ActionCommand {
  type: 'action'
  id: string
  label: string
  icon: string
  onActivate: () => void
}

type Command = NavCommand | ActionCommand

/* ------------------------------------------------------------------ */
/*  Navigation commands — all Phase 1 views                            */
/* Descriptions authored by PM (CP-T042)                               */
/* ------------------------------------------------------------------ */

const NAV_COMMANDS: NavCommand[] = [
  {
    type: 'nav',
    id: 'nav-memory',
    label: 'Memory Explorer',
    icon: '▦',
    to: '/memory',
    description: 'Browse and search all facts Iranti currently holds, filtered by entity type, key, or source.',
  },
  {
    type: 'nav',
    id: 'nav-archive',
    label: 'Archive',
    icon: '◫',
    to: '/archive',
    description: 'Inspect retired and superseded facts with their archival reason and full history.',
  },
  {
    type: 'nav',
    id: 'nav-activity',
    label: 'Staff Activity',
    icon: '⚡',
    to: '/activity',
    description: 'Watch Librarian, Archivist, Attendant, and Resolutionist events in real time as they happen.',
  },
  {
    type: 'nav',
    id: 'nav-instances',
    label: 'Instances',
    icon: '⊞',
    to: '/instances',
    description: 'View all connected Iranti instances, their project bindings, and instance health status.',
  },
  {
    type: 'nav',
    id: 'nav-health',
    label: 'Health',
    icon: '♥',
    to: '/health',
    description: 'Diagnose system connectivity, provider config, and Iranti component health at a glance.',
  },
  {
    type: 'nav',
    id: 'nav-conflicts',
    label: 'Conflicts',
    icon: '⚖',
    to: '/conflicts',
    description: 'Review pending escalations — conflicting facts the Resolutionist couldn\u2019t auto-resolve.',
  },
  {
    type: 'nav',
    id: 'nav-getting-started',
    label: 'Getting Started',
    icon: '◎',
    to: '/getting-started',
    description: 'Step-by-step setup status for a new Iranti installation.',
  },
]

/* ------------------------------------------------------------------ */
/*  Shortcuts — CP-T042                                                 */
/*                                                                      */
/*  Audit result (2026-03-20): No view-specific keyboard shortcuts     */
/*  are currently implemented in any Phase 1 view component.           */
/*  Only global shortcuts are listed. View-specific shortcuts will     */
/*  be added here as they are implemented in their target components.  */
/* ------------------------------------------------------------------ */

interface ShortcutEntry {
  keys: string[]           // Display tokens — e.g. ['Cmd+K', 'Ctrl+K']
  action: string
  scope: string | null     // null = global; string = view name
  viewPath: string | null  // null = global; path prefix = view-specific
}

const SHORTCUT_ENTRIES: ShortcutEntry[] = [
  {
    keys: ['Cmd+K', 'Ctrl+K'],
    action: 'Open command palette',
    scope: null,
    viewPath: null,
  },
  {
    keys: ['↑', '↓'],
    action: 'Navigate results',
    scope: null,
    viewPath: null,
  },
  {
    keys: ['↵'],
    action: 'Select / activate',
    scope: null,
    viewPath: null,
  },
  {
    keys: ['Esc'],
    action: 'Close palette / dismiss panel',
    scope: null,
    viewPath: null,
  },
]

/** Returns shortcuts applicable for the given pathname */
function getApplicableShortcuts(pathname: string): ShortcutEntry[] {
  return SHORTCUT_ENTRIES.filter(
    s => s.viewPath === null || pathname.startsWith(s.viewPath)
  )
}

/* ------------------------------------------------------------------ */
/*  Fuzzy / substring match                                             */
/* ------------------------------------------------------------------ */

/**
 * Returns true if every character of `query` appears in order in `target`.
 * This is a minimal fuzzy match — sufficient for short labels.
 */
function fuzzyMatch(target: string, query: string): boolean {
  if (!query) return true
  const t = target.toLowerCase()
  const q = query.toLowerCase()
  let ti = 0
  let qi = 0
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) qi++
    ti++
  }
  return qi === q.length
}

/* ------------------------------------------------------------------ */
/*  Command Palette component                                           */
/* ------------------------------------------------------------------ */

interface CommandPaletteProps {
  onClose: () => void
  onToggleDarkMode: () => void
}

export function CommandPalette({ onClose, onToggleDarkMode }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // CP-T042: Determine if we should show the Shortcuts section.
  // Shown when query is empty, or when user types "?", "help", or "shortcuts".
  const trimmedQuery = query.trim()
  const showShortcuts =
    trimmedQuery === '' ||
    trimmedQuery === '?' ||
    trimmedQuery.toLowerCase() === 'help' ||
    trimmedQuery.toLowerCase() === 'shortcuts'

  const applicableShortcuts = useMemo(
    () => getApplicableShortcuts(location.pathname),
    [location.pathname]
  )

  // Build the action commands inside the component so we have access to callbacks
  const actionCommands: ActionCommand[] = useMemo(() => [
    {
      type: 'action' as const,
      id: 'action-toggle-dark-mode',
      label: 'Toggle dark / light mode',
      icon: '◑',
      onActivate: onToggleDarkMode,
    },
    {
      type: 'action' as const,
      id: 'action-refresh-health',
      label: 'Refresh health',
      icon: '♥',
      onActivate: () => {
        // Navigate to health and dispatch a custom refresh event the HealthDashboard listens to
        navigate('/health')
        window.dispatchEvent(new CustomEvent('iranti:refresh-health'))
        onClose()
      },
    },
  ], [onToggleDarkMode, navigate, onClose])

  // All commands available (nav + actions)
  const allCommands: Command[] = useMemo(
    () => [...NAV_COMMANDS, ...actionCommands],
    [actionCommands]
  )

  // Filter by query.
  // When the query is a shortcuts-only trigger ("?", "help", "shortcuts"),
  // show all nav+action commands so the shortcuts section is a supplement,
  // not the only thing visible. When a real search query is entered, fuzzy-filter.
  const isShortcutsOnlyQuery =
    trimmedQuery === '?' ||
    trimmedQuery.toLowerCase() === 'help' ||
    trimmedQuery.toLowerCase() === 'shortcuts'

  const filteredCommands = useMemo(() => {
    if (!trimmedQuery || isShortcutsOnlyQuery) return allCommands
    return allCommands.filter(cmd => fuzzyMatch(cmd.label, trimmedQuery))
  }, [trimmedQuery, isShortcutsOnlyQuery, allCommands])

  // Keep selectedIndex in bounds
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keyboard handler for navigation within palette
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % Math.max(1, filteredCommands.length))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + Math.max(1, filteredCommands.length)) % Math.max(1, filteredCommands.length))
        break
      case 'Enter': {
        e.preventDefault()
        const cmd = filteredCommands[selectedIndex]
        if (cmd) activateCommand(cmd)
        break
      }
    }
  }, [filteredCommands, selectedIndex, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-selected="true"]`) as HTMLElement | null
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  function activateCommand(cmd: Command) {
    if (cmd.type === 'nav') {
      navigate(cmd.to)
      onClose()
    } else {
      cmd.onActivate()
      // action commands handle their own close if needed (e.g. refresh-health does it inline)
      // for toggle dark mode, close after
      if (cmd.id === 'action-toggle-dark-mode') onClose()
    }
  }

  // Trap focus inside the palette
  const handleTabKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusableEls = document.querySelectorAll<HTMLElement>(
        '[data-palette-focusable]'
      )
      const arr = Array.from(focusableEls)
      const firstEl = arr[0]
      const lastEl = arr[arr.length - 1]
      if (!firstEl || !lastEl) return
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault()
          lastEl.focus()
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }
  }, [])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // Nav and action sections for display
  const filteredNav = filteredCommands.filter((c): c is NavCommand => c.type === 'nav')
  const filteredActions = filteredCommands.filter((c): c is ActionCommand => c.type === 'action')

  // Build a flat index map so we can assign keyboard-selected indices correctly
  const flatCommands = [...filteredNav, ...filteredActions]

  return createPortal(
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      role="presentation"
      aria-label="Command palette backdrop"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(e) => { handleKeyDown(e); handleTabKey(e) }}
      >
        {/* Search input */}
        <div className={styles.inputRow}>
          <span className={styles.searchIcon} aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Navigate or run a command…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Command palette search"
            aria-autocomplete="list"
            aria-controls="cp-results-list"
            aria-activedescendant={
              flatCommands[selectedIndex] ? `cp-cmd-${flatCommands[selectedIndex].id}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
            data-palette-focusable
          />
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            aria-label="Close command palette"
            tabIndex={0}
            data-palette-focusable
          >
            Esc
          </button>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          className={styles.resultsList}
          id="cp-results-list"
          role="listbox"
          aria-label="Commands"
        >
          {filteredCommands.length === 0 && (
            <li className={styles.emptyState} role="option" aria-selected={false}>
              No commands match &ldquo;{query}&rdquo;
            </li>
          )}

          {/* Navigate section */}
          {filteredNav.length > 0 && (
            <>
              <li className={styles.sectionHeader} role="presentation">Navigate</li>
              {filteredNav.map((cmd) => {
                const flatIdx = flatCommands.indexOf(cmd)
                const isSelected = flatIdx === selectedIndex
                return (
                  <li
                    key={cmd.id}
                    id={`cp-cmd-${cmd.id}`}
                    className={`${styles.resultItemWithDesc} ${isSelected ? styles.resultItemWithDescSelected : ''}`}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(flatIdx)}
                    onClick={() => activateCommand(cmd)}
                  >
                    <span className={styles.resultIcon} aria-hidden="true">{cmd.icon}</span>
                    <span className={styles.resultLabelGroup}>
                      <span className={styles.resultLabel}>{cmd.label}</span>
                      <span className={styles.resultDesc}>{cmd.description}</span>
                    </span>
                    {cmd.hint && (
                      <span className={styles.resultHint}>{cmd.hint}</span>
                    )}
                    <span className={styles.resultTag}>View</span>
                  </li>
                )
              })}
            </>
          )}

          {/* Actions section */}
          {filteredActions.length > 0 && (
            <>
              <li className={styles.sectionHeader} role="presentation">Actions</li>
              {filteredActions.map((cmd) => {
                const flatIdx = flatCommands.indexOf(cmd)
                const isSelected = flatIdx === selectedIndex
                return (
                  <li
                    key={cmd.id}
                    id={`cp-cmd-${cmd.id}`}
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemSelected : ''}`}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(flatIdx)}
                    onClick={() => activateCommand(cmd)}
                  >
                    <span className={styles.resultIcon} aria-hidden="true">{cmd.icon}</span>
                    <span className={styles.resultLabel}>{cmd.label}</span>
                    <span className={styles.resultTag}>Action</span>
                  </li>
                )
              })}
            </>
          )}

          {/* CP-T042: Shortcuts section — visible when query is empty or is "?", "help", "shortcuts" */}
          {showShortcuts && applicableShortcuts.length > 0 && (
            <>
              <li className={styles.sectionHeader} role="presentation">Shortcuts</li>
              {applicableShortcuts.map((s, i) => (
                <li
                  key={i}
                  className={styles.shortcutRow}
                  role="presentation"
                  aria-hidden="true"
                >
                  <span className={styles.shortcutKeys}>
                    {s.keys.map((k, ki) => (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {ki > 0 && <span className={styles.shortcutSlash}>/</span>}
                        <kbd className={styles.kbdShortcut}>{k}</kbd>
                      </span>
                    ))}
                  </span>
                  <span className={styles.shortcutAction}>{s.action}</span>
                  {s.scope && (
                    <span className={styles.shortcutScope}>{s.scope}</span>
                  )}
                </li>
              ))}
            </>
          )}
        </ul>

        {/* Footer — CP-T042: "?" shortcuts trigger button on the right */}
        <div className={styles.footer}>
          <span className={styles.footerHint}>
            <kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> navigate
            <span className={styles.footerSep} />
            <kbd className={styles.kbd}>↵</kbd> select
            <span className={styles.footerSep} />
            <kbd className={styles.kbd}>Esc</kbd> close
          </span>
          <button
            className={`${styles.footerShortcutsBtn} ${showShortcuts ? styles.footerShortcutsBtnActive : ''}`}
            type="button"
            tabIndex={-1}
            aria-label="Show keyboard shortcuts"
            onClick={() => {
              if (showShortcuts && query === '') {
                // Already showing shortcuts via empty query — no-op (they're visible)
                inputRef.current?.focus()
              } else {
                setQuery('?')
                inputRef.current?.focus()
              }
            }}
            data-palette-focusable
          >
            <span aria-hidden="true">⌨</span> shortcuts
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ */
/*  useCommandPalette — keyboard trigger hook                           */
/* ------------------------------------------------------------------ */

/**
 * Registers a global Cmd+K / Ctrl+K listener.
 * Returns open/close state and a toggle function.
 * Also tracks the element that was focused before open, so focus can be
 * restored on close.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const openPalette = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    setOpen(true)
  }, [])

  const closePalette = useCallback(() => {
    setOpen(false)
    // Restore focus to the element that was active before the palette opened
    const prev = previousFocusRef.current
    if (prev && typeof prev.focus === 'function') {
      // Defer to next frame so the palette has finished unmounting
      requestAnimationFrame(() => prev.focus())
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const trigger = (isMac ? e.metaKey : e.ctrlKey) && e.key === 'k'
      if (!trigger) return
      e.preventDefault()
      if (open) {
        closePalette()
      } else {
        openPalette()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, openPalette, closePalette])

  return { open, openPalette, closePalette }
}
