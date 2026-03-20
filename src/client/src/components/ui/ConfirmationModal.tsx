/* Iranti Control Plane — ConfirmationModal */
/* Reusable modal for destructive / irreversible actions (CP-T033) */
/* Accessible: focus trap, Escape to close, Terminals palette */

import { useEffect, useRef } from 'react'
import styles from './ConfirmationModal.module.css'

interface ConfirmationModalProps {
  title: string
  description: string
  /** Shown as an amber warning block — use for "revertable: false" notices */
  warning?: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationModal({
  title,
  description,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  // Focus the cancel button on mount (safer default for destructive actions)
  useEffect(() => {
    cancelBtnRef.current?.focus()
  }, [])

  // Escape to close
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [loading, onCancel])

  // Focus trap — keep Tab/Shift+Tab inside the modal
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }

    dialog.addEventListener('keydown', trap)
    return () => dialog.removeEventListener('keydown', trap)
  }, [])

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget && !loading) onCancel() }}
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
      >
        <h2 className={styles.title} id="confirm-modal-title">{title}</h2>
        <p className={styles.description} id="confirm-modal-desc">{description}</p>

        {warning && (
          <div className={styles.warning} role="alert">
            <span className={styles.warningIcon} aria-hidden="true">⚠</span>
            <span className={styles.warningText}>{warning}</span>
          </div>
        )}

        <div className={styles.actions}>
          <button
            ref={cancelBtnRef}
            className={styles.cancelBtn}
            onClick={onCancel}
            disabled={loading}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={styles.confirmBtn}
            onClick={onConfirm}
            disabled={loading}
            type="button"
            aria-busy={loading}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
