/**
 * Attendant Debug Tools Panel — CP-T096
 *
 * Renders two interactive debug tools:
 *   1. Manual Handshake — simulates what the Attendant sends to an agent on session start.
 *   2. Manual Attend    — queries the Attendant for memory blocks relevant to a context.
 *
 * The panel is collapsed by default (wrapped in <details>) and displays a warning chip
 * to reinforce that these tools call the live Iranti instance.
 */

import { useState } from 'react'
import { runDebugHandshake, runDebugAttend } from '../../api/client'
import type { HandshakeResult, AttendResult } from '../../api/types'
import styles from './AttendantDebugPanel.module.css'

/* ------------------------------------------------------------------ */
/*  Manual Handshake tool                                               */
/* ------------------------------------------------------------------ */

function HandshakeTool() {
  const [agentId, setAgentId] = useState('')
  const [task, setTask] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<HandshakeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canRun = agentId.trim() !== '' && task.trim() !== '' && !loading

  const handleRun = async () => {
    if (!canRun) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await runDebugHandshake(agentId.trim(), task.trim())
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.toolCard}>
      <h3 className={styles.toolTitle}>Manual Handshake</h3>
      <p className={styles.toolSubtitle}>
        Simulate what the Attendant sends to an agent on session start.
      </p>

      <div className={styles.fieldGroup}>
        <div className={styles.field}>
          <label htmlFor="handshake-agent-id" className={styles.label}>
            Agent ID
          </label>
          <input
            id="handshake-agent-id"
            type="text"
            className={styles.input}
            placeholder="e.g. frontend_developer"
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="handshake-task" className={styles.label}>
            Task Description
          </label>
          <textarea
            id="handshake-task"
            className={styles.textarea}
            placeholder="Describe the task this agent is starting…"
            value={task}
            onChange={e => setTask(e.target.value)}
            disabled={loading}
            spellCheck={false}
          />
        </div>
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.runBtn}
          disabled={!canRun}
          onClick={() => void handleRun()}
          aria-busy={loading}
          aria-label="Run handshake against live Iranti instance"
        >
          {loading && <span className={styles.spinner} aria-hidden="true" />}
          {loading ? 'Running…' : 'Run Handshake'}
        </button>

        {error && (
          <div className={styles.errorMsg} role="alert">
            <span aria-hidden="true">✗</span>
            {error}
          </div>
        )}
      </div>

      {result !== null && (
        <div className={styles.resultBlock}>
          <span className={styles.resultLabel}>Response</span>
          <pre className={styles.resultPre}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Manual Attend tool                                                  */
/* ------------------------------------------------------------------ */

function AttendTool() {
  const [agentId, setAgentId] = useState('')
  const [query, setQuery] = useState('')
  const [context, setContext] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AttendResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canRun = agentId.trim() !== '' && query.trim() !== '' && !loading

  const handleRun = async () => {
    if (!canRun) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await runDebugAttend(
        agentId.trim(),
        query.trim(),
        context.trim() !== '' ? context.trim() : undefined
      )
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.toolCard}>
      <h3 className={styles.toolTitle}>Manual Attend</h3>
      <p className={styles.toolSubtitle}>
        Query the Attendant for memory blocks relevant to a given context.
      </p>

      <div className={styles.fieldGroup}>
        <div className={styles.field}>
          <label htmlFor="attend-agent-id" className={styles.label}>
            Agent ID
          </label>
          <input
            id="attend-agent-id"
            type="text"
            className={styles.input}
            placeholder="e.g. frontend_developer"
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="attend-query" className={styles.label}>
            Query
          </label>
          <input
            id="attend-query"
            type="text"
            className={styles.input}
            placeholder="What memory to retrieve…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="attend-context" className={styles.labelOptional}>
            Context (optional)
          </label>
          <textarea
            id="attend-context"
            className={`${styles.textarea} ${styles.textareaSmall}`}
            placeholder="Additional context to scope the attend query…"
            value={context}
            onChange={e => setContext(e.target.value)}
            disabled={loading}
            spellCheck={false}
          />
        </div>
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.runBtn}
          disabled={!canRun}
          onClick={() => void handleRun()}
          aria-busy={loading}
          aria-label="Run attend query against live Iranti instance"
        >
          {loading && <span className={styles.spinner} aria-hidden="true" />}
          {loading ? 'Running…' : 'Run Attend'}
        </button>

        {error && (
          <div className={styles.errorMsg} role="alert">
            <span aria-hidden="true">✗</span>
            {error}
          </div>
        )}
      </div>

      {result !== null && (
        <div className={styles.resultBlock}>
          <span className={styles.resultLabel}>Response</span>
          <pre className={styles.resultPre}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AttendantDebugPanel — exported entry point                         */
/* ------------------------------------------------------------------ */

/**
 * Collapsible panel containing both debug tools.
 * Collapsed by default so it is not prominent in the normal Health Dashboard flow.
 * The <details>/<summary> approach requires zero JS for the toggle.
 */
export function AttendantDebugPanel() {
  return (
    <details className={styles.details}>
      <summary className={styles.summary} aria-label="Expand Attendant Debug Tools">
        Attendant Debug Tools ▾
      </summary>

      <div className={styles.section}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Attendant Debug Tools</h2>
          <p className={styles.panelNote}>
            These tools call the live Iranti instance. Results reflect current memory state.
          </p>
          <span className={styles.warningChip} aria-label="Warning: debug tools only">
            ⚠ Debug tools only. Do not use in production workflows.
          </span>
        </div>

        <div className={styles.toolGrid}>
          <HandshakeTool />
          <AttendTool />
        </div>
      </div>
    </details>
  )
}
