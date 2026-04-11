/**
 * Iranti Control Plane - Create Instance Form
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { createInstance } from '../../api/client'
import type { CreateInstanceResult, InstanceMetadata, DatabaseIntentChoice } from '../../api/types'
import { useSettings } from '../../hooks/useSettings'
import styles from './CreateInstanceForm.module.css'

const PROVIDERS = ['gemini', 'claude', 'openai', 'groq', 'mistral', 'ollama', 'mock'] as const
const PROVIDERS_WITH_KEY: string[] = ['gemini', 'claude', 'openai', 'groq', 'mistral']
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

function preferredLocalDbHost(): string {
  if (typeof navigator === 'undefined') return 'localhost'
  return /win/i.test(navigator.userAgent) ? '127.0.0.1' : 'localhost'
}

const DB_PLACEHOLDER = `postgresql://user:password@${preferredLocalDbHost()}:5432/iranti_myproject`

type DatabaseMode = 'compose' | 'url'

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

interface CreateInstanceFormProps {
  suggestedPort?: number
  instances: InstanceMetadata[]
  onSuccess: (instanceName: string) => void
  onCancel: () => void
}

function sanitizeDatabaseSlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'instance'
}

function normalizedInstanceCollisionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, '_')
}

function suggestedDatabaseName(instanceName: string, prefix = 'iranti_'): string {
  return `${prefix}${sanitizeDatabaseSlug(instanceName || 'instance')}`
}

function buildDatabaseUrl(params: {
  host: string
  port: string
  databaseName: string
  username: string
  password: string
}): string {
  const auth = params.password.trim()
    ? `${encodeURIComponent(params.username.trim())}:${encodeURIComponent(params.password)}@`
    : `${encodeURIComponent(params.username.trim())}@`
  return `postgresql://${auth}${params.host.trim()}:${params.port.trim()}/${encodeURIComponent(params.databaseName.trim())}`
}

function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const auth = parsed.username ? `${decodeURIComponent(parsed.username)}:${parsed.password ? '••••' : ''}@` : ''
    return `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}

export function CreateInstanceForm({ suggestedPort, instances, onSuccess, onCancel }: CreateInstanceFormProps) {
  const { settings } = useSettings()
  const createDefaults = settings.createInstanceDefaults
  const defaultProvider = PROVIDERS.includes(createDefaults.provider as (typeof PROVIDERS)[number])
    ? createDefaults.provider
    : 'claude'

  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [port, setPort] = useState<string>(String(suggestedPort ?? createDefaults.startPort))
  const [nameError, setNameError] = useState<string | null>(null)
  const [portError, setPortError] = useState<string | null>(null)

  const [databaseMode, setDatabaseMode] = useState<DatabaseMode>(createDefaults.databaseMode)
  const [dbIntent, setDbIntent] = useState<DatabaseIntentChoice>(createDefaults.databaseMode === 'compose' ? 'dedicated' : 'external')
  const [dbTemplateSource, setDbTemplateSource] = useState('')
  const [dbHost, setDbHost] = useState(createDefaults.dbHost)
  const [dbPort, setDbPort] = useState(createDefaults.dbPort)
  const [databaseName, setDatabaseName] = useState(suggestedDatabaseName('', createDefaults.dbNamePrefix))
  const [databaseNameTouched, setDatabaseNameTouched] = useState(false)
  const [dbUser, setDbUser] = useState(createDefaults.dbUser)
  const [dbPassword, setDbPassword] = useState('')
  const [dbUrl, setDbUrl] = useState('')
  const [dbUrlError, setDbUrlError] = useState<string | null>(null)

  const [provider, setProvider] = useState<string>(defaultProvider)
  const [providerKey, setProviderKey] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<CreateInstanceResult | null>(null)

  useEffect(() => {
    if (!databaseNameTouched) {
      setDatabaseName(suggestedDatabaseName(name, createDefaults.dbNamePrefix))
    }
  }, [name, databaseNameTouched, createDefaults.dbNamePrefix])

  useEffect(() => {
    setPort(String(suggestedPort ?? createDefaults.startPort))
  }, [suggestedPort, createDefaults.startPort])

  useEffect(() => {
    setDbHost(createDefaults.dbHost)
    setDbPort(createDefaults.dbPort)
    setDbUser(createDefaults.dbUser)
  }, [createDefaults.dbHost, createDefaults.dbPort, createDefaults.dbUser])

  const composePreview = useMemo(() => {
    if (!dbHost.trim() || !dbPort.trim() || !databaseName.trim() || !dbUser.trim()) return ''
    return buildDatabaseUrl({
      host: dbHost,
      port: dbPort,
      databaseName,
      username: dbUser,
      password: dbPassword,
    })
  }, [dbHost, dbPort, databaseName, dbUser, dbPassword])

  const effectiveDbUrl = databaseMode === 'compose' ? composePreview : dbUrl.trim()
  const siblingNameCollision = useMemo(() => {
    const desired = name.trim()
    if (!desired) return null
    const desiredKey = normalizedInstanceCollisionKey(desired)
    return instances.find((instance) => {
      const existingName = instance.name.trim()
      if (!existingName || existingName === desired) return false
      return normalizedInstanceCollisionKey(existingName) === desiredKey
    }) ?? null
  }, [instances, name])

  const handleTemplateSourceChange = (instanceName: string) => {
    setDbTemplateSource(instanceName)
    const source = instances.find((instance) => instance.name === instanceName)
    if (!source?.database) return
    if (source.database.host) setDbHost(source.database.host)
    if (source.database.port) setDbPort(String(source.database.port))
    if (source.database.user) setDbUser(source.database.user)
  }

  const validateStep1 = useCallback((): boolean => {
    let valid = true
    if (!NAME_PATTERN.test(name)) {
      setNameError('Name must be 1-64 chars, letters, digits, hyphens, or underscores only.')
      valid = false
    } else if (siblingNameCollision) {
      setNameError(`This name is too close to existing instance "${siblingNameCollision.name}". Use a more distinct name so bindings, runtime folders, and database defaults do not collide.`)
      valid = false
    } else {
      setNameError(null)
    }
    const portNum = parseInt(port, 10)
    if (Number.isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setPortError('Port must be a number between 1024 and 65535.')
      valid = false
    } else {
      setPortError(null)
    }
    return valid
  }, [name, port, siblingNameCollision])

  const validateStep2 = useCallback((): boolean => {
    if (databaseMode === 'url') {
      if (!dbUrl.trim() || dbUrl.trim() === DB_PLACEHOLDER) {
        setDbUrlError('Database URL is required. Enter a valid PostgreSQL connection string.')
        return false
      }
      if (dbUrl.toLowerCase().includes('yourpassword')) {
        setDbUrlError('Database URL still contains a placeholder password.')
        return false
      }
      setDbUrlError(null)
      return true
    }

    if (!dbHost.trim() || !dbPort.trim() || !databaseName.trim() || !dbUser.trim()) {
      setDbUrlError('Host, port, database name, and username are required to build a PostgreSQL URL.')
      return false
    }
    const portNum = parseInt(dbPort, 10)
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setDbUrlError('Database port must be between 1 and 65535.')
      return false
    }
    if (!composePreview) {
      setDbUrlError('Could not build a PostgreSQL URL from the current fields.')
      return false
    }
    setDbUrlError(null)
    return true
  }, [composePreview, databaseMode, databaseName, dbHost, dbPort, dbUrl, dbUser])

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setStep((current) => current + 1)
  }

  const handleBack = () => setStep((current) => current - 1)

  const handleCreate = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await createInstance({
        name: name.trim(),
        port: parseInt(port, 10),
        dbUrl: effectiveDbUrl,
        dbIntent,
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
  }, [effectiveDbUrl, dbIntent, name, port, provider, providerKey, submitting])

  if (successResult) {
    return (
      <div className={styles.formContainer}>
        <div className={styles.successScreen}>
          <span className={styles.successIcon} aria-hidden="true">✓</span>
          <h3 className={styles.successTitle}>Instance created</h3>
          <p className={styles.successName}>{successResult.name}</p>

          {successResult.note && (
            <div className={styles.migrationNote} role="alert">
              <span className={styles.migrationNoteIcon} aria-hidden="true">!</span>
              <div>
                <strong>Next step</strong>
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
            <button className={styles.primaryBtn} type="button" onClick={() => onSuccess(successResult.name)}>
              Open instance setup
            </button>
          </div>
        </div>
      </div>
    )
  }

  const needsKey = PROVIDERS_WITH_KEY.includes(provider)

  return (
    <div className={styles.formContainer}>
      <div className={styles.formHeader}>
        <h3 className={styles.formTitle}>Create Instance</h3>
        <button className={styles.cancelHeaderBtn} type="button" onClick={onCancel} aria-label="Cancel">
          ×
        </button>
      </div>

      <StepIndicator step={step} total={4} />

      <div className={styles.formBody}>
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
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              {nameError && <p className={styles.fieldError}>{nameError}</p>}
              <p className={styles.fieldHint}>Letters, digits, hyphens, underscores. 1-64 chars.</p>
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
                onChange={(e) => setPort(e.target.value)}
                min={1024}
                max={65535}
                placeholder={String(suggestedPort ?? createDefaults.startPort)}
              />
              {portError && <p className={styles.fieldError}>{portError}</p>}
              <p className={styles.fieldHint}>1024-65535. Must not conflict with another instance.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={styles.stepContent}>
            <h4 className={styles.stepTitle}>Database</h4>
            <div className={styles.modeToggleRow}>
              <button
                className={`${styles.modeToggleBtn} ${databaseMode === 'compose' ? styles.modeToggleBtnActive : ''}`}
                type="button"
                onClick={() => {
                  setDatabaseMode('compose')
                  setDbIntent((current) => current === 'external' ? 'dedicated' : current)
                }}
              >
                Build from parts
              </button>
              <button
                className={`${styles.modeToggleBtn} ${databaseMode === 'url' ? styles.modeToggleBtnActive : ''}`}
                type="button"
                onClick={() => {
                  setDatabaseMode('url')
                  setDbIntent((current) => current === 'dedicated' ? 'external' : current)
                }}
              >
                Paste full URL
              </button>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="ci-db-intent">Database strategy</label>
              <select
                id="ci-db-intent"
                className={styles.select}
                value={dbIntent}
                onChange={(e) => setDbIntent(e.target.value as DatabaseIntentChoice)}
              >
                <option value="dedicated">Dedicated local database</option>
                <option value="shared">Shared local database</option>
                <option value="external">External existing database</option>
              </select>
              <p className={styles.fieldHint}>
                This tells Iranti whether the instance owns its own local database, shares a local one with other instances, or depends on an external database you manage separately.
              </p>
            </div>

            {databaseMode === 'compose' ? (
              <>
                {instances.some((instance) => instance.database) && (
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="ci-db-template">Use an existing instance as a template</label>
                    <select
                      id="ci-db-template"
                      className={styles.select}
                      value={dbTemplateSource}
                      onChange={(e) => handleTemplateSourceChange(e.target.value)}
                    >
                      <option value="">Use the defaults below</option>
                      {instances.filter((instance) => instance.database).map((instance) => (
                        <option key={instance.instanceId} value={instance.name}>
                          {instance.name} - {instance.database?.host}:{instance.database?.port}/{instance.database?.name}
                        </option>
                      ))}
                    </select>
                    <p className={styles.fieldHint}>This copies the host, port, and database user from an existing instance without exposing its password.</p>
                  </div>
                )}

                <div className={styles.fieldGroupRow}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="ci-db-host">Host <span className={styles.required}>*</span></label>
                    <input id="ci-db-host" className={styles.input} type="text" value={dbHost} onChange={(e) => setDbHost(e.target.value)} autoComplete="off" />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="ci-db-port">Port <span className={styles.required}>*</span></label>
                    <input id="ci-db-port" className={styles.input} type="number" value={dbPort} onChange={(e) => setDbPort(e.target.value)} min={1} max={65535} />
                  </div>
                </div>

                <div className={styles.fieldGroupRow}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="ci-db-name">Database name <span className={styles.required}>*</span></label>
                    <input
                      id="ci-db-name"
                      className={`${styles.input} ${styles.inputMono}`}
                      type="text"
                      value={databaseName}
                      onChange={(e) => {
                        setDatabaseNameTouched(true)
                        setDatabaseName(e.target.value)
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="ci-db-user">Username <span className={styles.required}>*</span></label>
                    <input id="ci-db-user" className={styles.input} type="text" value={dbUser} onChange={(e) => setDbUser(e.target.value)} autoComplete="off" spellCheck={false} />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="ci-db-password">Password</label>
                  <input
                    id="ci-db-password"
                    className={styles.input}
                    type="password"
                    value={dbPassword}
                    onChange={(e) => setDbPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Optional if your PostgreSQL user does not require one"
                  />
                </div>

                <div className={styles.previewCard}>
                  <span className={styles.previewLabel}>Connection preview</span>
                  <code className={styles.previewValue}>{composePreview ? redactDatabaseUrl(composePreview) : DB_PLACEHOLDER}</code>
                </div>
              </>
            ) : (
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel} htmlFor="ci-dburl">
                  Database URL <span className={styles.required}>*</span>
                </label>
                <input
                  id="ci-dburl"
                  className={`${styles.input} ${styles.inputMono} ${dbUrlError ? styles.inputError : ''}`}
                  type="text"
                  value={dbUrl}
                  onChange={(e) => setDbUrl(e.target.value)}
                  placeholder={DB_PLACEHOLDER}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}

            {dbUrlError && <p className={styles.fieldError}>{dbUrlError}</p>}
            <p className={styles.fieldHint}>
              Control Plane will take you into the instance after creation so you can start it, wire providers, and bind projects without dropping into the terminal.
            </p>
          </div>
        )}

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
                onChange={(e) => {
                  setProvider(e.target.value)
                  setProviderKey('')
                }}
              >
                {PROVIDERS.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
              <p className={styles.fieldHint}>
                This sets <code className={styles.inlineCode}>LLM_PROVIDER</code> in the instance <code className={styles.inlineCode}>.env</code>.
              </p>
            </div>
            {needsKey ? (
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel} htmlFor="ci-pkey">Provider API key</label>
                <input
                  id="ci-pkey"
                  className={`${styles.input} ${styles.inputMono}`}
                  type="password"
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  placeholder={`${provider.toUpperCase()}_API_KEY`}
                  autoComplete="new-password"
                />
                <p className={styles.fieldHint}>Optional here - can be set later in the Providers panel.</p>
              </div>
            ) : (
              <p className={styles.noKeyNote}>
                {provider === 'mock' ? 'Mock provider - no API key required.' : 'Ollama runs locally - no API key required.'}
              </p>
            )}
          </div>
        )}

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
                <code className={`${styles.reviewValue} ${styles.reviewValueTruncate}`}>{redactDatabaseUrl(effectiveDbUrl)}</code>
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
                <span aria-hidden="true">!</span> {submitError}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.formActions}>
        <button className={styles.cancelBtn} type="button" onClick={onCancel}>
          Cancel
        </button>
        <div className={styles.navBtns}>
          {step > 1 && (
            <button className={styles.secondaryBtn} type="button" onClick={handleBack} disabled={submitting}>
              Back
            </button>
          )}
          {step < 4 && (
            <button className={styles.primaryBtn} type="button" onClick={handleNext}>
              Next
            </button>
          )}
          {step === 4 && (
            <button className={styles.primaryBtn} type="button" onClick={() => void handleCreate()} disabled={submitting}>
              {submitting ? (<><span className={styles.spinnerSmall} aria-hidden="true" /> Creating...</>) : 'Create instance'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
