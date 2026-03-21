/* Iranti Control Plane — Toast State Hook */
/* CP-T069 — Proactive Health Alert Toasts */

import { useReducer, useCallback } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type ToastSeverity = 'error' | 'warn' | 'info'

export interface Toast {
  id: string
  severity: ToastSeverity
  title: string
  message: string
  action?: { label: string; href: string }
  autoDismissMs?: number
}

/* ------------------------------------------------------------------ */
/*  Reducer                                                             */
/* ------------------------------------------------------------------ */

type ToastAction =
  | { type: 'ADD'; toast: Toast }
  | { type: 'DISMISS'; id: string }

const MAX_TOASTS = 4

function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case 'ADD': {
      // Deduplication: do not add if a toast with the same title is already visible
      const isDuplicate = state.some((t) => t.title === action.toast.title)
      if (isDuplicate) return state
      // Cap: if already at MAX_TOASTS, remove the oldest (first in array)
      const base = state.length >= MAX_TOASTS ? state.slice(1) : state
      return [...base, action.toast]
    }
    case 'DISMISS':
      return state.filter((t) => t.id !== action.id)
    default:
      return state
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

export interface UseToastsReturn {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
}

export function useToasts(): UseToastsReturn {
  const [toasts, dispatch] = useReducer(toastReducer, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    dispatch({ type: 'ADD', toast: { ...toast, id } })
  }, [])

  const dismissToast = useCallback((id: string) => {
    dispatch({ type: 'DISMISS', id })
  }, [])

  return { toasts, addToast, dismissToast }
}
