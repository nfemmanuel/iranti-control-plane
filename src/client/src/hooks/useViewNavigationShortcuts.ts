/* Iranti Control Plane — View Navigation Keyboard Shortcuts */
/* CP-T070 — Global G+<key> navigation shortcuts */
/*                                                                     */
/* Pattern: press G (no modifiers, no input focused), then within      */
/* 1500ms press a letter key to navigate to the mapped route.          */
/* Displays a "go mode" indicator chip while waiting for the second    */
/* keypress.                                                            */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/* ------------------------------------------------------------------ */
/*  Route map                                                           */
/* ------------------------------------------------------------------ */

const GO_MODE_ROUTES: Record<string, string> = {
  h: '/overview',
  m: '/memory',
  a: '/archive',
  t: '/activity',
  l: '/logs',
  i: '/instances',
  d: '/health',
  x: '/metrics',
  c: '/conflicts',
  p: '/providers',
  g: '/agents',
  s: '/getting-started',
}

const GO_MODE_TIMEOUT_MS = 1500

/* ------------------------------------------------------------------ */
/*  Input focus guard                                                   */
/* ------------------------------------------------------------------ */

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.getAttribute('contenteditable') === 'true') return true
  return false
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

export interface UseViewNavigationShortcutsReturn {
  goModeActive: boolean
}

export function useViewNavigationShortcuts(): UseViewNavigationShortcutsReturn {
  const navigate = useNavigate()
  // goModeRef tracks state for the event handler (avoids stale closure)
  const goModeRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // goModeActive state drives the visual indicator
  const [goModeActive, setGoModeActive] = useState(false)

  useEffect(() => {
    function exitGoMode() {
      goModeRef.current = false
      setGoModeActive(false)
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    function enterGoMode() {
      goModeRef.current = true
      setGoModeActive(true)
      // Auto-cancel after timeout
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(exitGoMode, GO_MODE_TIMEOUT_MS)
    }

    function handler(e: KeyboardEvent) {
      // Ignore if any modifier held
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Ignore if typing in an input
      if (isInputFocused()) return
      // Ignore non-printable / special keys (Tab, Shift alone, etc.)
      if (e.key.length !== 1) return

      const key = e.key.toLowerCase()

      if (goModeRef.current) {
        // Second keypress — resolve the navigation
        exitGoMode()
        const route = GO_MODE_ROUTES[key]
        if (route) {
          e.preventDefault()
          navigate(route)
        }
        return
      }

      // First keypress — activate go mode on 'g'
      if (key === 'g') {
        e.preventDefault()
        enterGoMode()
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    }
  }, [navigate])

  return { goModeActive }
}

/* ------------------------------------------------------------------ */
/*  Shortcut reference list (for CommandPalette integration)           */
/* ------------------------------------------------------------------ */

export const VIEW_NAVIGATION_SHORTCUTS: Array<{ keys: string; label: string; route: string }> = [
  { keys: 'G → H', label: 'Home',               route: '/overview'        },
  { keys: 'G → M', label: 'Memory Explorer',    route: '/memory'          },
  { keys: 'G → A', label: 'Archive',            route: '/archive'         },
  { keys: 'G → T', label: 'Staff Activity',     route: '/activity'        },
  { keys: 'G → L', label: 'Logs',               route: '/logs'            },
  { keys: 'G → I', label: 'Instances',          route: '/instances'       },
  { keys: 'G → D', label: 'Health & Diagnostics', route: '/health'        },
  { keys: 'G → X', label: 'Metrics',            route: '/metrics'         },
  { keys: 'G → C', label: 'Conflicts',          route: '/conflicts'       },
  { keys: 'G → P', label: 'Providers',          route: '/providers'       },
  { keys: 'G → G', label: 'Agent Registry',     route: '/agents'          },
  { keys: 'G → S', label: 'Getting Started',    route: '/getting-started' },
]
