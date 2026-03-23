/* Iranti Control Plane — Configure Instance Panel */
/* CP-T090 — Compact edit panel for port, provider, provider key */

import { useState, useCallback, useEffect } from 'react'
import { configureInstance } from '../../api/client'
import styles from './ConfigureInstancePanel.module.css'

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const PROVIDERS = ['gemini', 'claude', 'openai', 'groq', 'mistral', 'ollama', 'mock'] as const
const PROVIDERS_WITH_KEY: string[] = ['gemini', 'claude', 'openai', 'groq', 'mistral']

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface ConfigureInstancePanelProps {
  instanceName: string
  currentPort: number | null
  currentProvider: string | null
  onSuccess: () => void
  onCancel: () => void
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function ConfigureInstancePanel({
  instanceName,
  currentPort,
  currentProvider,
  onSuccess,
  onCancel,
}: ConfigureInstancePanelProps) {
  const [port, setPort] = useState<string>(currentPort !== null ? String(currentPort) : '')
  const [provider, setProvider] = useState<string>(currentProvider ?? 'claude')
  const [providerKey, setProviderKey] = useState('')

  const [portError, setPortError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [restartWarning, setRestartWarning] = useState<string | null>(null)
  const [changedFields, setChangedFields] = useState<string[] | null>(null)

  useEffect(() => {
    setPort(currentPort !== null ? String(currentPort) : '')
    setProvider(currentProvider ?? 'claude')
    setProviderKey('')
    setPortError(null)
    setSubmitError(null)
    setRestartWarning(null)
    setChangedFields(null)
  }, [instanceName, currentPort, currentProvider])

  const needsKey = PROVIDERS_WITH_KEY.includes(provider)

  const validate = (): boolean => {
    if (port.trim() !== '') {
      const portNum = parseInt(port, 10)
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        setPortError('Port must be between 1024 and 65535.')
        return false
      }
    }
    setPortError(null)
    return true
  }

  const handleSubmit = useCallback(async () => {
    if (submitting || !validate()) return
    setSubmitting(true)
    setSubmitError(null)
    setRestartWarning(null)
    setChangedFields(null)

    const params: {
      port?: number
      provider?: string
      providerKey?: string
    } = {}

    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum !== currentPort) params.port = portNum
    if (provider !== currentProvider) params.provider = provider
    if (PROVIDERS_WITH_KEY.includes(provider) && providerKey.trim()) {
      params.providerKey = providerKey.trim()
    }

    if (Object.keys(params).length === 0) {
      onSuccess()
      return
    }

    try {
      const result = await configureInstance(instanceName, params)
      setChangedFields(result.changed)
      if (result.restartRequired) {
        setRestartWarning(
          `Restart required — ${instanceName} must be restarted for the changes to take effect.`
        )
      } else {
        onSuccess()
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, port, provider, providerKey, instanceName, currentPort, currentProvider])

  /* ---- Post-success restart screen ---- */
  if (restartWarning) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Configure — {instanceName}</span>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.restartWarning} role="alert">
            <span className={styles.restartWarningIcon} aria-hidden="true">↻</span>
            <div>
              <strong>Restart required</strong>
              <p className={styles.restartWarningText}>{restartWarning}</p>
              {changedFields && changedFields.length > 0 && (
                <p className={styles.changedFields}>
                  Changed: {changedFields.join(', ')}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className={styles.panelActions}>
          <button className={styles.primaryBtn} type="button" onClick={onSuccess}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Configure — {instanceName}</span>
        <button
          className={styles.cancelHeaderBtn}
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>

      <div className={styles.panelBody}>
        {/* Port */}
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="cfg-port">Port</label>
          <input
            id="cfg-port"
            className={`${styles.input} ${portError ? styles.inputError : ''}`}
            type="number"
            value={port}
            onChange={e => setPort(e.target.value)}
            min={1024}
            max={65535}
            placeholder={currentPort !== null ? String(currentPort) : '3002'}
          />
          {portError && <p className={styles.fieldError}>{portError}</p>}
        </div>

        {/* Provider */}
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="cfg-provider">Provider</label>
          <select
            id="cfg-provider"
            className={styles.select}
            value={provider}
            onChange={e => {
              setProvider(e.target.value)
              setProviderKey('')
            }}
          >
            {PROVIDERS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Provider key — conditional */}
        {needsKey && (
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="cfg-pkey">
              Provider key
              <span className={styles.fieldLabelHint}> (leave blank to keep existing)</span>
            </label>
            <input
              id="cfg-pkey"
              className={`${styles.input} ${styles.inputMono}`}
              type="password"
              value={providerKey}
              onChange={e => setProviderKey(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
        )}

        {submitError && (
          <div className={styles.submitError} role="alert">
            <span aria-hidden="true">✗</span> {submitError}
          </div>
        )}
      </div>

      <div className={styles.panelActions}>
        <button
          className={styles.cancelBtn}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={styles.primaryBtn}
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? (
            <><span className={styles.spinnerSmall} aria-hidden="true" /> Saving…</>
          ) : (
            'Save changes'
          )}
        </button>
      </div>
    </div>
  )
}
