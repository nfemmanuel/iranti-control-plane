/* Iranti Control Plane — Command Palette */
/* CP-T024 — Global Cmd+K / Ctrl+K command palette */
/* Navigation-only in this ticket. KB search deferred to CP-T024-search. */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
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
/* ------------------------------------------------------------------ */

const NAV_COMMANDS: NavCommand[] = [
  { type: 'nav', id: 'nav-memory',          label: 'Memory Explorer',  icon: '▦', to: '/memory' },
  { type: 'nav', id: 'nav-archive',         label: 'Archive',          icon: '◫', to: '/archive' },
  { type: 'nav', id: 'nav-activity',        label: 'Staff Activity',   icon: '⚡', to: '/activity' },
  { type: 'nav', id: 'nav-instances',       label: 'Instances',        icon: '⊞', to: '/instances' },
  { type: 'nav', id: 'nav-health',          label: 'Health',           icon: '♥', to: '/health' },
  { type: 'nav', id: 'nav-conflicts',       label: 'Conflicts',        icon: '⚖', to: '/conflicts' },
  { type: 'nav', id: 'nav-getting-started', label: 'Getting Started',  icon: '◎', to: '/getting-started' },
]

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

  // Filter by query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands
    return allCommands.filter(cmd => fuzzyMatch(cmd.label, query))
  }, [query, allCommands])

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
                    className={`${styles.resultItem} ${isSelected ? styles.resultItemSelected : ''}`}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(flatIdx)}
                    onClick={() => activateCommand(cmd)}
                  >
                    <span className={styles.resultIcon} aria-hidden="true">{cmd.icon}</span>
                    <span className={styles.resultLabel}>{cmd.label}</span>
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
        </ul>

        {/* Footer hint */}
        <div className={styles.footer}>
          <span className={styles.footerHint}>
            <kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> navigate
            <span className={styles.footerSep} />
            <kbd className={styles.kbd}>↵</kbd> select
            <span className={styles.footerSep} />
            <kbd className={styles.kbd}>Esc</kbd> close
          </span>
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
