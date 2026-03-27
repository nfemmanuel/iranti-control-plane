/* Iranti Control Plane — Configure Instance Panel */
/* CP-T090 — Compact edit panel for port, provider, provider key */

import { useState, useCallback, useEffect } from 'react'
import { configureInstance, restartInstance } from '../../api/client'
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
  currentDbUrlRedacted?: string | null
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
  currentDbUrlRedacted,
  onSuccess,
  onCancel,
}: ConfigureInstancePanelProps) {
  const [port, setPort] = useState<string>(currentPort !== null ? String(currentPort) : '')
  const [provider, setProvider] = useState<string>(currentProvider ?? 'claude')
  const [dbUrl, setDbUrl] = useState('')
  const [providerKey, setProviderKey] = useState('')

  const [portError, setPortError] = useState<string | null>(null)
  const [dbUrlError, setDbUrlError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [restartWarning, setRestartWarning] = useState<string | null>(null)
  const [changedFields, setChangedFields] = useState<string[] | null>(null)

  useEffect(() => {
    setPort(currentPort !== null ? String(currentPort) : '')
    setProvider(currentProvider ?? 'claude')
    setDbUrl('')
    setProviderKey('')
    setPortError(null)
    setDbUrlError(null)
    setSubmitError(null)
    setRestartWarning(null)
    setChangedFields(null)
  }, [instanceName, currentPort, currentProvider, currentDbUrlRedacted])

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
    if (dbUrl.trim() !== '' && dbUrl.toLowerCase().includes('yourpassword')) {
      setDbUrlError('Database URL still contains a placeholder password.')
      return false
    }
    setDbUrlError(null)
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
      dbUrl?: string
      provider?: string
      providerKey?: string
    } = {}

    const portNum = parseInt(port, 10)
    if (!isNaN(portNum) && portNum !== currentPort) params.port = portNum
    if (dbUrl.trim()) params.dbUrl = dbUrl.trim()
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
  }, [submitting, port, dbUrl, provider, providerKey, instanceName, currentPort, currentProvider])

  const handleRestartNow = useCallback(async () => {
    if (restarting) return
    setRestarting(true)
    setSubmitError(null)
    try {
      await restartInstance(instanceName)
      onSuccess()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestarting(false)
    }
  }, [restarting, instanceName, onSuccess])

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
        {submitError && (
          <div className={styles.submitError} role="alert">
            <span aria-hidden="true">x</span> {submitError}
          </div>
        )}
        <div className={styles.panelActions}>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={() => void handleRestartNow()}
            disabled={restarting}
          >
            {restarting ? 'Restarting...' : 'Restart now'}
          </button>
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
          <label className={styles.fieldLabel} htmlFor="cfg-port">Runtime port</label>
          <input
            id="cfg-port"
            className={`${styles.input} ${portError ? styles.inputError : ''}`}
            type="number"
            value={port}
            onChange={e => setPort(e.target.value)}
            min={1024}
            max={65535}
            placeholder={currentPort !== null ? String(currentPort) : '3001'}
          />
          {portError && <p className={styles.fieldError}>{portError}</p>}
          <p className={styles.fieldHint}>
            This changes the Iranti instance port, not the control-plane UI port. New runtimes usually start at
            <code className={styles.inlineCode}>3001</code>.
          </p>
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="cfg-dburl">
            Database URL
            <span className={styles.fieldLabelHint}> (leave blank to keep existing)</span>
          </label>
          <input
            id="cfg-dburl"
            className={`${styles.input} ${styles.inputMono} ${dbUrlError ? styles.inputError : ''}`}
            type="text"
            value={dbUrl}
            onChange={e => setDbUrl(e.target.value)}
            placeholder={currentDbUrlRedacted ?? 'postgresql://user:password@host:5432/dbname'}
            autoComplete="off"
            spellCheck={false}
          />
          {dbUrlError && <p className={styles.fieldError}>{dbUrlError}</p>}
          {currentDbUrlRedacted && (
            <p className={styles.fieldHint}>Current value: <code className={styles.inlineCode}>{currentDbUrlRedacted}</code></p>
          )}
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
          disabled={submitting || restarting}
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
