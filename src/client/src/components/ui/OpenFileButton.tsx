/**
 * Iranti Control Plane — OpenFileButton component
 * CP-T084: Opens a whitelisted local config file in the user's system editor.
 */

import { useState, useCallback } from 'react'
import { openFile } from '../../api/client'
import styles from './OpenFileButton.module.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenFileButtonProps {
  /** Relative filename to open, e.g. ".env.iranti". Must be on the server whitelist. */
  filePath: string
  /** Button label. Defaults to "Open file". */
  label?: string
  className?: string
}

type ButtonState = 'idle' | 'loading' | 'success' | 'error'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Small inline button that requests the control plane server to open a local
 * config file in the user's default system editor.
 *
 * State machine:
 *   idle → loading (on click)
 *   loading → success (opened: true) → idle (after 2s)
 *   loading → error   (opened: false or network error) → idle (after 3s)
 */
export function OpenFileButton({ filePath, label = 'Open file', className }: OpenFileButtonProps) {
  const [state, setState] = useState<ButtonState>('idle')
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const handleClick = useCallback(async () => {
    if (state === 'loading') return

    setState('loading')
    setFeedbackMessage(null)

    try {
      const result = await openFile(filePath)

      if (result.opened) {
        setState('success')
        setFeedbackMessage(null)
        setTimeout(() => {
          setState('idle')
          setFeedbackMessage(null)
        }, 2000)
      } else {
        // File not found, or OS open command failed — server returned opened:false
        const msg = result.reason === 'file not found'
          ? `File not found at ${result.path}`
          : (result.reason ?? 'Could not open file')
        setState('error')
        setFeedbackMessage(msg)
        setTimeout(() => {
          setState('idle')
          setFeedbackMessage(null)
        }, 3000)
      }
    } catch {
      // Network error or unexpected server error
      setState('error')
      setFeedbackMessage('Could not open file')
      setTimeout(() => {
        setState('idle')
        setFeedbackMessage(null)
      }, 3000)
    }
  }, [filePath, state])

  const buttonLabel =
    state === 'loading' ? 'Opening…' :
    state === 'success' ? 'Opened ✓' :
    label

  const btnClass = [
    styles.btn,
    state === 'loading' ? styles.loading : '',
    state === 'success' ? styles.success : '',
    state === 'error'   ? styles.error   : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <span>
      <button
        type="button"
        className={btnClass}
        disabled={state === 'loading'}
        onClick={() => void handleClick()}
        aria-label={`${buttonLabel}: ${filePath}`}
        aria-busy={state === 'loading'}
      >
        {buttonLabel}
      </button>
      {feedbackMessage && (
        <span
          className={`${styles.feedback} ${state === 'error' ? styles.feedbackError : ''}`}
          role="status"
          aria-live="polite"
        >
          {feedbackMessage}
        </span>
      )}
    </span>
  )
}
