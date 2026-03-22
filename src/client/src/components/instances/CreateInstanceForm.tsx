/* Iranti Control Plane — Create Instance Form */
/* CP-T089 — 4-step wizard: Name+Port → Database → Provider → Review */

import { useState, useCallback } from 'react'
import { createInstance } from '../../api/client'
import type { CreateInstanceResult } from '../../api/types'
import styles from './CreateInstanceForm.module.css'

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const PROVIDERS = ['gemini', 'claude', 'openai', 'groq', 'mistral', 'ollama', 'mock'] as const
const PROVIDERS_WITH_KEY: string[] = ['gemini', 'claude', 'openai', 'groq', 'mistral']
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/
const DB_PLACEHOLDER = 'postgresql://user:password@localhost:5432/iranti_myproject'

/* ------------------------------------------------------------------ */
/*  Step indicator                                                      */
/* ------------------------------------------------------------------ */

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className={styles.stepIndicator} aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`${styles.stepDot} ${i + 1 === step ? styles.stepDotActive : ''} ${i + 1 < step ? styles.stepDotDone : ''}`}
          aria-hidden="true"
        />
      ))}
      <span className={styles.stepLabel}>Step {step} of {total}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface CreateInstanceFormProps {
  onSuccess: (instanceName: string) => void
  onCancel: () => void
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function CreateInstanceForm({ onSuccess, onCancel }: CreateInstanceFormProps) {
  const [step, setStep] = useState(1)

  // Step 1 fields
  const [name, setName] = useState('')
  const [port, setPort] = useState<string>('3002')
  const [nameError, setNameError] = useState<string | null>(null)
  const [portError, setPortError] = useState<string | null>(null)

  // Step 2 fields
  const [dbUrl, setDbUrl] = useState('')
  const [dbUrlError, setDbUrlError] = useState<string | null>(null)

  // Step 3 fields
  const [provider, setProvider] = useState<string>('claude')
  const [providerKey, setProviderKey] = useState('')

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<CreateInstanceResult | null>(null)

  /* ---------------------------------------------------------------- */
  /*  Validation                                                        */
  /* ---------------------------------------------------------------- */

  const validateStep1 = useCallback((): boolean => {
    let valid = true
    if (!NAME_PATTERN.test(name)) {
      setNameError('Name must be 1–64 chars, letters, digits, hyphens, or underscores only.')
      valid = false
    } else {
      setNameError(null)
    }
    const portNum = parseInt(port, 10)
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setPortError('Port must be a number between 1024 and 65535.')
      valid = false
    } else {
      setPortError(null)
    }
    return valid
  }, [name, port])

  const validateStep2 = useCallback((): boolean => {
    if (!dbUrl.trim() || dbUrl.trim() === DB_PLACEHOLDER) {
      setDbUrlError('Database URL is required. Enter a valid PostgreSQL connection string.')
      return false
    }
    setDbUrlError(null)
    return true
  }, [dbUrl])

  /* ---------------------------------------------------------------- */
  /*  Navigation                                                        */
  /* ---------------------------------------------------------------- */

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setStep(s => s + 1)
  }

  const handleBack = () => setStep(s => s - 1)

  /* ---------------------------------------------------------------- */
  /*  Submit                                                            */
  /* ---------------------------------------------------------------- */

  const handleCreate = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await createInstance({
        name: name.trim(),
        port: parseInt(port, 10),
        dbUrl: dbUrl.trim(),
        provider,
        ...(PROVIDERS_WITH_KEY.includes(provider) && providerKey.trim()
          ? { providerKey: providerKey.trim() }
          : {}),
      })
      setSuccessResult(result)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [submitting, name, port, dbUrl, provider, providerKey])

  /* ---------------------------------------------------------------- */
  /*  Success screen                                                    */
  /* ---------------------------------------------------------------- */

  if (successResult) {
    return (
      <div className={styles.formContainer}>
        <div className={styles.successScreen}>
          <span className={styles.successIcon} aria-hidden="true">✓</span>
          <h3 className={styles.successTitle}>Instance created</h3>
          <p className={styles.successName}>{successResult.name}</p>

          {/* CP-T089 AC-7: DB migration note — shown prominently */}
          {successResult.note && (
            <div className={styles.migrationNote} role="alert">
              <span className={styles.migrationNoteIcon} aria-hidden="true">⚠</span>
              <div>
                <strong>Database setup required</strong>
                <p className={styles.migrationNoteText}>{successResult.note}</p>
              </div>
            </div>
          )}

          <div className={styles.successDetails}>
            <div className={styles.successDetailRow}>
              <span className={styles.successDetailLabel}>Port</span>
              <code className={styles.successDetailValue}>{successResult.port}</code>
            </div>
            <div className={styles.successDetailRow}>
              <span className={styles.successDetailLabel}>Instance dir</span>
              <code className={styles.successDetailValue}>{successResult.instanceDir}</code>
            </div>
            <div className={styles.successDetailRow}>
              <span className={styles.successDetailLabel}>Env file</span>
              <code className={styles.successDetailValue}>{successResult.envFile}</code>
            </div>
            <div className={styles.successDetailRow}>
              <span className={styles.successDetailLabel}>Provider</span>
              <code className={styles.successDetailValue}>{successResult.provider}</code>
            </div>
          </div>

          <div className={styles.formActions}>
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={() => onSuccess(successResult.name)}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------------------------------------------------------- */
  /*  Step rendering                                                    */
  /* ---------------------------------------------------------------- */

  const needsKey = PROVIDERS_WITH_KEY.includes(provider)

  return (
    <div className={styles.formContainer}>
      <div className={styles.formHeader}>
        <h3 className={styles.formTitle}>Create Instance</h3>
        <button
          className={styles.cancelHeaderBtn}
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>

      <StepIndicator step={step} total={4} />

      <div className={styles.formBody}>
        {/* ---- Step 1: Name + Port ---- */}
        {step === 1 && (
          <div className={styles.stepContent}>
            <h4 className={styles.stepTitle}>Name &amp; Port</h4>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="ci-name">
                Instance name <span className={styles.required}>*</span>
              </label>
              <input
                id="ci-name"
                className={`${styles.input} ${nameError ? styles.inputError : ''}`}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="my-project"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              {nameError && <p className={styles.fieldError}>{nameError}</p>}
              <p className={styles.fieldHint}>Letters, digits, hyphens, underscores. 1–64 chars.</p>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="ci-port">
                Port <span className={styles.required}>*</span>
              </label>
              <input
                id="ci-port"
                className={`${styles.input} ${portError ? styles.inputError : ''}`}
                type="number"
                value={port}
                onChange={e => setPort(e.target.value)}
                min={1024}
                max={65535}
                placeholder="3002"
              />
              {portError && <p className={styles.fieldError}>{portError}</p>}
              <p className={styles.fieldHint}>1024–65535. Must not conflict with another instance.</p>
            </div>
          </div>
        )}

        {/* ---- Step 2: Database ---- */}
        {step === 2 && (
          <div className={styles.stepContent}>
            <h4 className={styles.stepTitle}>Database</h4>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="ci-dburl">
                Database URL <span className={styles.required}>*</span>
              </label>
              <input
                id="ci-dburl"
                className={`${styles.input} ${styles.inputMono} ${dbUrlError ? styles.inputError : ''}`}
                type="text"
                value={dbUrl}
                onChange={e => setDbUrl(e.target.value)}
                placeholder={DB_PLACEHOLDER}
                autoComplete="off"
                spellCheck={false}
              />
              {dbUrlError && <p className={styles.fieldError}>{dbUrlError}</p>}
              <p className={styles.fieldHint}>
                Format: <code className={styles.inlineCode}>postgresql://user:password@host:5432/dbname</code>
                <br />
                The database must exist and Iranti will run migrations on first start.
              </p>
            </div>
          </div>
        )}

        {/* ---- Step 3: Provider ---- */}
        {step === 3 && (
          <div className={styles.stepContent}>
            <h4 className={styles.stepTitle}>Provider</h4>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="ci-provider">
                LLM Provider <span className={styles.required}>*</span>
              </label>
              <select
                id="ci-provider"
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
              <p className={styles.fieldHint}>
                This sets <code className={styles.inlineCode}>LLM_PROVIDER</code> in the instance .env.iranti.
              </p>
            </div>
            {needsKey && (
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel} htmlFor="ci-pkey">
                  Provider API key
                </label>
                <input
                  id="ci-pkey"
                  className={`${styles.input} ${styles.inputMono}`}
                  type="password"
                  value={providerKey}
                  onChange={e => setProviderKey(e.target.value)}
                  placeholder={`${provider.toUpperCase()}_API_KEY`}
                  autoComplete="new-password"
                />
                <p className={styles.fieldHint}>
                  Optional here — can be set later in the Providers panel.
                </p>
              </div>
            )}
            {!needsKey && (
              <p className={styles.noKeyNote}>
                {provider === 'mock'
                  ? 'Mock provider — no API key required.'
                  : 'Ollama runs locally — no API key required.'}
              </p>
            )}
          </div>
        )}

        {/* ---- Step 4: Review ---- */}
        {step === 4 && (
          <div className={styles.stepContent}>
            <h4 className={styles.stepTitle}>Review &amp; Create</h4>
            <div className={styles.reviewTable}>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}>Name</span>
                <code className={styles.reviewValue}>{name}</code>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}>Port</span>
                <code className={styles.reviewValue}>{port}</code>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}>Database URL</span>
                <code className={`${styles.reviewValue} ${styles.reviewValueTruncate}`}>{dbUrl}</code>
              </div>
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}>Provider</span>
                <code className={styles.reviewValue}>{provider}</code>
              </div>
              {needsKey && (
                <div className={styles.reviewRow}>
                  <span className={styles.reviewLabel}>Provider key</span>
                  <code className={styles.reviewValue}>
                    {providerKey.trim() ? '••••••••' : <span className={styles.dimValue}>not set</span>}
                  </code>
                </div>
              )}
            </div>

            {submitError && (
              <div className={styles.submitError} role="alert">
                <span aria-hidden="true">✗</span> {submitError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Navigation ---- */}
      <div className={styles.formActions}>
        <button
          className={styles.cancelBtn}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <div className={styles.navBtns}>
          {step > 1 && (
            <button
              className={styles.secondaryBtn}
              type="button"
              onClick={handleBack}
              disabled={submitting}
            >
              Back
            </button>
          )}
          {step < 4 && (
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={handleNext}
            >
              Next
            </button>
          )}
          {step === 4 && (
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting}
            >
              {submitting ? (
                <><span className={styles.spinnerSmall} aria-hidden="true" /> Creating…</>
              ) : (
                'Create instance'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
