/* Iranti Control Plane — Toast Notification Component */
/* CP-T069 — Proactive Health Alert Toasts */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Toast as ToastData } from '../../hooks/useToasts'
import styles from './Toast.module.css'

/* ------------------------------------------------------------------ */
/*  Severity → icon mapping                                             */
/* ------------------------------------------------------------------ */

const SEVERITY_ICONS: Record<string, string> = {
  error: '✕',
  warn: '⚠',
  info: '◈',
}

/* ------------------------------------------------------------------ */
/*  Default auto-dismiss durations                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_AUTO_DISMISS_MS: Record<string, number | undefined> = {
  error: undefined,   // sticky — manual dismiss only
  warn: 10_000,
  info: 6_000,
}

/* ------------------------------------------------------------------ */
/*  Toast component                                                     */
/* ------------------------------------------------------------------ */

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const { id, severity, title, message, action, autoDismissMs } = toast
  const [entering, setEntering] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Slide-in animation: entering=true on mount → false after paint
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntering(false)
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Auto-dismiss timer
  useEffect(() => {
    const duration = autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS[severity]
    if (duration === undefined) return
    timerRef.current = setTimeout(() => {
      onDismiss(id)
    }, duration)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [id, severity, autoDismissMs, onDismiss])

  const icon = SEVERITY_ICONS[severity] ?? '◈'

  return (
    <div
      className={styles.toast}
      data-severity={severity}
      data-entering={String(entering)}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      <div className={styles.content}>
        <span className={styles.title}>{title}</span>
        <span className={styles.message} title={message}>{message}</span>
        {action && (
          <Link
            to={action.href}
            className={styles.action}
            onClick={() => onDismiss(id)}
          >
            {action.label}
          </Link>
        )}
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}
