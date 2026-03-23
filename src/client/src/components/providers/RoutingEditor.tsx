/* Iranti Control Plane — Provider Task-Model Routing Editor */
/* CP-T087: per-task model override configuration */

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, fetchRoutingDefaults, updateTaskRouting, resetTaskRouting } from '../../api/client'
import type { ProviderModelsResponse, RoutingDefaultsResponse } from '../../api/types'
import styles from './RoutingEditor.module.css'

// ---------------------------------------------------------------------------
// Task type metadata
// ---------------------------------------------------------------------------

const TASK_TYPES = [
  'classification',
  'relevance_filtering',
  'conflict_resolution',
  'summarization',
  'task_inference',
  'extraction',
] as const

type TaskType = typeof TASK_TYPES[number]

const TASK_LABELS: Record<TaskType, string> = {
  classification:      'Classification',
  relevance_filtering: 'Relevance Filtering',
  conflict_resolution: 'Conflict Resolution',
  summarization:       'Summarization',
  task_inference:      'Task Inference',
  extraction:          'Extraction',
}

const TASK_DESCRIPTIONS: Record<TaskType, string> = {
  classification:      'Fast yes/no or category decisions',
  relevance_filtering: 'Deciding what knowledge is relevant',
  conflict_resolution: 'Reasoning about contradicting facts — benefits most from a capable model',
  summarization:       'Compressing knowledge for working memory',
  task_inference:      'Inferring what an agent is currently doing',
  extraction:          'Extracting structured facts from text',
}

// ---------------------------------------------------------------------------
// Compatibility check — mirrors Iranti router.ts isLikelyCompatible()
// ---------------------------------------------------------------------------

function isCompatible(provider: string, model: string): boolean {
  const m = model.toLowerCase()
  if (!provider || provider === 'mock') return true
  if (provider === 'openai') return !(m.startsWith('gemini') || m.startsWith('claude') || m.startsWith('mistral') || m.startsWith('llama'))
  if (provider === 'gemini') return !m.startsWith('gpt') && !m.startsWith('claude') && !m.startsWith('mistral') && !m.startsWith('llama')
  if (provider === 'claude' || provider === 'anthropic') return m.startsWith('claude')
  if (provider === 'mistral') return m.startsWith('mistral')
  return true
}

// ---------------------------------------------------------------------------
// Per-task row
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: TaskType
  currentOverride: string | null
  defaultModel: string
  modelOptions: string[]
  activeProvider: string
  pending: boolean
  onChange: (task: TaskType, value: string | null) => void
  isOllama: boolean
}

function TaskRow({
  task, currentOverride, defaultModel, modelOptions, activeProvider, pending, onChange, isOllama,
}: TaskRowProps) {
  const [freeText, setFreeText] = useState(currentOverride ?? '')
  const effectiveValue = currentOverride ?? ''
  const incompatible = currentOverride !== null && !isCompatible(activeProvider, currentOverride)

  // Sync if parent state resets
  useEffect(() => {
    setFreeText(currentOverride ?? '')
  }, [currentOverride])

  return (
    <tr className={`${styles.taskRow} ${incompatible ? styles.taskRowIncompatible : ''}`}>
      <td className={styles.taskCell}>
        <span className={styles.taskLabel}>{TASK_LABELS[task]}</span>
        <span className={styles.taskDesc}>{TASK_DESCRIPTIONS[task]}</span>
      </td>
      <td className={styles.defaultCell}>
        <code className={styles.defaultModel}>{defaultModel}</code>
      </td>
      <td className={styles.overrideCell}>
        {isOllama ? (
          <input
            type="text"
            className={styles.overrideInput}
            placeholder="e.g. llama3.2"
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            onBlur={() => {
              const v = freeText.trim()
              onChange(task, v || null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            disabled={pending}
          />
        ) : (
          <select
            className={styles.overrideSelect}
            value={effectiveValue}
            onChange={e => onChange(task, e.target.value || null)}
            disabled={pending}
            aria-label={`Model override for ${TASK_LABELS[task]}`}
          >
            <option value="">Using default ({defaultModel})</option>
            {modelOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        {incompatible && (
          <span className={styles.incompatibleWarning} title="This model may be incompatible with the active provider. Iranti will warn at runtime and use the provider default.">
            ⚠ Incompatible
          </span>
        )}
      </td>
      <td className={styles.clearCell}>
        {currentOverride !== null && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => { setFreeText(''); onChange(task, null) }}
            disabled={pending}
            aria-label={`Clear override for ${TASK_LABELS[task]}`}
          >
            Clear
          </button>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RoutingEditorProps {
  /** Current task routing overrides from the parent providers query */
  taskRouting: Record<string, string | null>
  /** Active default provider ID */
  activeProvider: string | null
  /** Called after a successful write so the parent can invalidate the providers query */
  onSuccess: () => void
}

export function RoutingEditor({ taskRouting, activeProvider, onSuccess }: RoutingEditorProps) {
  const provider = activeProvider ?? 'mock'
  const isOllama = provider === 'ollama'

  // Local editable state — initialized from props, updated locally before save
  const [overrides, setOverrides] = useState<Record<string, string | null>>(taskRouting)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string; warnings?: string[] } | null>(null)

  // Sync when parent data refreshes
  useEffect(() => {
    setOverrides(taskRouting)
  }, [taskRouting])

  // Fetch routing defaults for the active provider
  const { data: defaultsData } = useQuery<RoutingDefaultsResponse, Error>({
    queryKey: ['routing-defaults', provider],
    queryFn: () => fetchRoutingDefaults(provider),
    staleTime: 10 * 60 * 1000,
  })

  // Fetch model list for the active provider (for dropdown options)
  const { data: modelsData } = useQuery<ProviderModelsResponse, Error>({
    queryKey: ['provider-models', provider],
    queryFn: () => apiFetch<ProviderModelsResponse>(`/providers/${provider}/models`),
    staleTime: 5 * 60 * 1000,
    enabled: !!provider && provider !== 'mock',
  })

  const modelOptions = (modelsData?.models ?? []).map(m => m.id)

  const handleChange = (task: TaskType, value: string | null) => {
    setOverrides(prev => ({ ...prev, [task]: value }))
    setFeedback(null)
  }

  const handleSave = async () => {
    setPending(true)
    setFeedback(null)
    try {
      const result = await updateTaskRouting(overrides)
      const msg = result.warnings.length > 0
        ? `Saved to the live instance env. Restart the instance to apply. ${result.warnings.length} compatibility warning(s).`
        : 'Task routing saved to the live instance env. Restart the instance to apply.'
      setFeedback({ kind: 'ok', msg, warnings: result.warnings })
      onSuccess()
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Save failed.' })
    } finally {
      setPending(false)
    }
  }

  const handleResetAll = async () => {
    if (!window.confirm('Reset all task-model overrides? Each task will use the provider default.')) return
    setPending(true)
    setFeedback(null)
    try {
      await resetTaskRouting()
      setFeedback({ kind: 'ok', msg: 'All overrides cleared from the live instance env. Restart the instance to apply.' })
      onSuccess()
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Reset failed.' })
    } finally {
      setPending(false)
    }
  }

  const hasAnyOverride = TASK_TYPES.some(t => overrides[t] !== null)

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <div>
          <h2 className={styles.editorTitle}>Task Routing</h2>
          <p className={styles.editorSubtitle}>
            Override which model is used for each Iranti task type.
            Defaults are determined by the active provider (<code>{provider}</code>).
          </p>
        </div>
        <div className={styles.editorActions}>
          {hasAnyOverride && (
            <button
              type="button"
              className={styles.resetAllBtn}
              onClick={() => void handleResetAll()}
              disabled={pending}
            >
              Reset all overrides
            </button>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            onClick={() => void handleSave()}
            disabled={pending}
          >
            {pending ? 'Saving…' : 'Save routing'}
          </button>
        </div>
      </div>

      {/* Restart notice — all vars are static at Iranti startup */}
      <div className={styles.restartNotice} role="note">
        <span className={styles.restartIcon} aria-hidden="true">↺</span>
        <span>These settings are written to the live instance env and take effect after restarting the Iranti instance.</span>
      </div>

      <table className={styles.routingTable} aria-label="Task-model routing overrides">
        <thead>
          <tr>
            <th className={styles.thTask}>Task</th>
            <th className={styles.thDefault}>Provider default</th>
            <th className={styles.thOverride}>Override model</th>
            <th className={styles.thClear}></th>
          </tr>
        </thead>
        <tbody>
          {TASK_TYPES.map(task => (
            <TaskRow
              key={task}
              task={task}
              currentOverride={overrides[task] ?? null}
              defaultModel={defaultsData?.defaults[task] ?? '—'}
              modelOptions={modelOptions}
              activeProvider={provider}
              pending={pending}
              onChange={handleChange}
              isOllama={isOllama}
            />
          ))}
        </tbody>
      </table>

      {feedback && (
        <div className={feedback.kind === 'ok' ? styles.feedbackOk : styles.feedbackErr}>
          <span>{feedback.msg}</span>
          {feedback.warnings && feedback.warnings.length > 0 && (
            <ul className={styles.warningList}>
              {feedback.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
