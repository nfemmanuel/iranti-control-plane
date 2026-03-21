/* Iranti Control Plane — Toast Container */
/* CP-T069 — Proactive Health Alert Toasts */
/* Fixed bottom-right. Renders above chat panel and command palette (z-index 1100). */

import type { Toast as ToastData } from '../../hooks/useToasts'
import { Toast } from './Toast'
import styles from './ToastContainer.module.css'

interface ToastContainerProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div
      className={styles.container}
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
