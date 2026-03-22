/* Iranti Control Plane — API Key Manager */
/* CP-T088 — Registry-backed API key management for the active Iranti instance */
/* Lets operators list, create, and revoke registry keys (distinct from provider keys). */

import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAuthKeys, createAuthKey, revokeAuthKey } from '../../api/client'
import type { AuthKey, AuthKeyCreateResult } from '../../api/types'
import type { InstanceMetadata } from '../../api/types'
import styles from './ApiKeyManager.module.css'

// ---------------------------------------------------------------------------
// Standard scope options — must match STANDARD_SCOPES in auth-keys.ts
// ---------------------------------------------------------------------------

const STANDARD_SCOPES = [
  'kb:read',
  'kb:write',
  'memory:read',
  'memory:write',
  'agents:read',
  'agents:write',
  'metrics:read',
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function maskToken(token: string): string {
  const dotIdx = token.indexOf('.')
  if (dotIdx < 0) return `${token.slice(0, 4)}****`
  const keyId = token.slice(0, dotIdx)
  return `${keyId}.****`
}

// ---------------------------------------------------------------------------
// Revoke confirmation modal
// ---------------------------------------------------------------------------

function RevokeConfirmModal({
  target,
  onConfirm,
  onCancel,
  inFlight,
}: {
  target: AuthKey
  onConfirm: () => void
  onCancel: () => void
  inFlight: boolean
}) {
  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="revoke-modal-title">
      <div className={styles.modalBox}>
        <p className={styles.modalTitle} id="revoke-modal-title">Revoke API key?</p>
        <p className={styles.modalBody}>
          This will permanently revoke{' '}
          <code className={styles.modalKeyId}>{target.keyId}</code>
          {target.owner ? <> (owned by <strong>{target.owner}</strong>)</> : ''}.
          {' '}Any agents or integrations using this key will immediately lose access.
          The key will remain visible in the list for audit purposes.
        </p>
        <div className={styles.modalActions}>
          <button
            className={styles.modalCancelBtn}
            type="button"
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
          <button
            className={styles.modalRevokeBtn}
            type="button"
            onClick={onConfirm}
            disabled={inFlight}
          >
            {inFlight ? (
              <><span className={styles.spinnerSmall} aria-hidden="true" /> Revoking…</>
            ) : (
              'Revoke key'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Token reveal panel — shown once after creation
// ---------------------------------------------------------------------------

function TokenRevealPanel({
  result,
  syncedToProject,
  onDismiss,
}: {
  result: AuthKeyCreateResult
  syncedToProject: string | null
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(result.token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }, [result.token])

  const masked = maskToken(result.token)

  return (
    <div className={styles.tokenReveal}>
      <div className={styles.tokenWarning}>
        <span className={styles.tokenWarningIcon} aria-hidden="true">⚠</span>
        <span>
          Copy this token now — it will not be shown again.
          Store it in your project&apos;s <code>.env.iranti</code> as{' '}
          <code>IRANTI_API_KEY</code>.
        </span>
      </div>

      <div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
          Key ID: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{result.keyId}</code>
          {result.scopes.length > 0 && (
            <> &nbsp;·&nbsp; Scopes: {result.scopes.join(', ')}</>
          )}
        </div>
        <div className={styles.tokenRow}>
          <input
            className={styles.tokenInput}
            type="text"
            readOnly
            value={result.token}
            aria-label="Generated API token"
            onFocus={e => (e.target as HTMLInputElement).select()}
            title={masked}
          />
          <button
            className={`${styles.copyBtn} ${copied ? styles.copyBtnCopied : ''}`}
            type="button"
            onClick={handleCopy}
            aria-label="Copy token to clipboard"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {syncedToProject && !result.warning && (
        <div className={styles.tokenSyncNote}>
          Token synced to <code>{syncedToProject}/.env.iranti</code> as IRANTI_API_KEY.
        </div>
      )}
      {result.warning && (
        <div className={styles.tokenWarnNote}>
          {result.warning}
        </div>
      )}

      <button className={styles.tokenDismissBtn} type="button" onClick={onDismiss}>
        I have copied the token
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create key form
// ---------------------------------------------------------------------------

interface CreateFormState {
  keyId:         string
  owner:         string
  selectedScopes: Set<string>
  customScope:   string
  description:   string
  syncToProject: string
}

const EMPTY_FORM: CreateFormState = {
  keyId:          '',
  owner:          '',
  selectedScopes: new Set<string>(),
  customScope:    '',
  description:    '',
  syncToProject:  '',
}

function CreateKeyForm({
  instances,
  onCreated,
  onCancel,
}: {
  instances: InstanceMetadata[]
  onCreated: (result: AuthKeyCreateResult, syncedProject: string | null) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<CreateFormState>({ ...EMPTY_FORM, selectedScopes: new Set() })
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleScope = (scope: string) => {
    setForm(prev => {
      const next = new Set(prev.selectedScopes)
      if (next.has(scope)) {
        next.delete(scope)
      } else {
        next.add(scope)
      }
      return { ...prev, selectedScopes: next }
    })
  }

  const handleSubmit = useCallback(async () => {
    if (inFlight) return
    setError(null)

    const keyId = form.keyId.trim()
    const owner = form.owner.trim()

    if (!keyId) {
      setError('Key ID is required.')
      return
    }
    if (!owner) {
      setError('Owner is required.')
      return
    }

    const scopes: string[] = [...form.selectedScopes]
    if (form.customScope.trim()) {
      scopes.push(...form.customScope.split(',').map(s => s.trim()).filter(Boolean))
    }

    setInFlight(true)
    try {
      const result = await createAuthKey({
        keyId,
        owner,
        scopes,
        description: form.description.trim() || undefined,
        syncToProject: form.syncToProject || undefined,
      })
      onCreated(result, form.syncToProject || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInFlight(false)
    }
  }, [form, inFlight, onCreated])

  // Project options: extract all project roots from all instances
  const projectRoots = Array.from(
    new Set(instances.flatMap(inst => inst.projects.map(p => p.projectRoot)))
  )

  return (
    <div className={styles.formPanel}>
      <p className={styles.formTitle}>Create API Key</p>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="ak-keyId">Key ID <span style={{ color: 'var(--color-status-error)' }}>*</span></label>
        <input
          id="ak-keyId"
          className={styles.formInput}
          type="text"
          value={form.keyId}
          onChange={e => setForm(prev => ({ ...prev, keyId: e.target.value }))}
          placeholder="e.g. claude_code or my_agent"
          autoComplete="off"
          spellCheck={false}
          disabled={inFlight}
        />
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="ak-owner">Owner <span style={{ color: 'var(--color-status-error)' }}>*</span></label>
        <input
          id="ak-owner"
          className={styles.formInput}
          type="text"
          value={form.owner}
          onChange={e => setForm(prev => ({ ...prev, owner: e.target.value }))}
          placeholder="e.g. Claude Code, automation, my-app"
          disabled={inFlight}
        />
      </div>

      <div className={styles.formRow}>
        <span className={styles.formLabel}>Scopes</span>
        <div className={styles.scopeGrid}>
          {STANDARD_SCOPES.map(scope => (
            <label
              key={scope}
              className={`${styles.scopeCheckLabel} ${form.selectedScopes.has(scope) ? styles.scopeChecked : ''}`}
            >
              <input
                className={styles.scopeCheckbox}
                type="checkbox"
                checked={form.selectedScopes.has(scope)}
                onChange={() => toggleScope(scope)}
                disabled={inFlight}
              />
              {scope}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="ak-customScope">
          Custom / namespace scopes
          <span style={{ fontSize: '10px', fontWeight: 400, textTransform: 'none', color: 'var(--color-text-tertiary)', marginLeft: '6px' }}>
            optional, comma-separated (e.g. kb:read:project/acme)
          </span>
        </label>
        <input
          id="ak-customScope"
          className={styles.formInput}
          type="text"
          value={form.customScope}
          onChange={e => setForm(prev => ({ ...prev, customScope: e.target.value }))}
          placeholder="kb:read:project/acme, memory:write:project/*"
          disabled={inFlight}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="ak-description">Description (optional)</label>
        <input
          id="ak-description"
          className={styles.formInput}
          type="text"
          value={form.description}
          onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
          placeholder="What will use this key?"
          disabled={inFlight}
        />
      </div>

      {projectRoots.length > 0 && (
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="ak-syncProject">
            Copy to project
            <span style={{ fontSize: '10px', fontWeight: 400, textTransform: 'none', color: 'var(--color-text-tertiary)', marginLeft: '6px' }}>
              writes token into project&apos;s .env.iranti as IRANTI_API_KEY
            </span>
          </label>
          <select
            id="ak-syncProject"
            className={styles.formSelect}
            value={form.syncToProject}
            onChange={e => setForm(prev => ({ ...prev, syncToProject: e.target.value }))}
            disabled={inFlight}
          >
            <option value="">— Don&apos;t sync —</option>
            {projectRoots.map(root => (
              <option key={root} value={root}>{root}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className={styles.formError} role="alert">{error}</div>
      )}

      <div className={styles.formActions}>
        <button
          className={styles.formSubmitBtn}
          type="button"
          onClick={() => void handleSubmit()}
          disabled={inFlight}
        >
          {inFlight ? (
            <><span className={styles.spinnerSmall} aria-hidden="true" /> Creating…</>
          ) : (
            'Create key'
          )}
        </button>
        <button
          className={styles.formCancelBtn}
          type="button"
          onClick={onCancel}
          disabled={inFlight}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ApiKeyManagerProps {
  /** All discovered instances — used to populate the syncToProject dropdown */
  instances: InstanceMetadata[]
}

export function ApiKeyManager({ instances }: ApiKeyManagerProps) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [createdResult, setCreatedResult] = useState<AuthKeyCreateResult | null>(null)
  const [createdSyncProject, setCreatedSyncProject] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AuthKey | null>(null)
  const [revokeInFlight, setRevokeInFlight] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const {
    data,
    isLoading,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ['auth-keys'],
    queryFn: fetchAuthKeys,
    staleTime: 0,
  })

  const keys = data?.keys ?? []

  // Sort: active first, then by createdAt desc
  const sortedKeys = [...keys].sort((a, b) => {
    if (a.revoked !== b.revoked) return a.revoked ? 1 : -1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const handleCreated = useCallback(
    (result: AuthKeyCreateResult, syncedProject: string | null) => {
      setShowForm(false)
      setCreatedResult(result)
      setCreatedSyncProject(syncedProject)
      void queryClient.invalidateQueries({ queryKey: ['auth-keys'] })
    },
    [queryClient]
  )

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget || revokeInFlight) return
    setRevokeInFlight(true)
    setRevokeError(null)
    try {
      await revokeAuthKey(revokeTarget.keyId)
      setRevokeTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['auth-keys'] })
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : String(err))
    } finally {
      setRevokeInFlight(false)
    }
  }, [revokeTarget, revokeInFlight, queryClient])

  // Reset revoke error when modal closes
  useEffect(() => {
    if (!revokeTarget) setRevokeError(null)
  }, [revokeTarget])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>API Keys</h3>
        {!showForm && (
          <button
            className={styles.createBtn}
            type="button"
            onClick={() => {
              setCreatedResult(null)
              setShowForm(true)
            }}
          >
            + Create Key
          </button>
        )}
      </div>

      {/* Token reveal panel — shown once after creation */}
      {createdResult && (
        <TokenRevealPanel
          result={createdResult}
          syncedToProject={createdSyncProject}
          onDismiss={() => {
            setCreatedResult(null)
            setCreatedSyncProject(null)
          }}
        />
      )}

      {/* Create form */}
      {showForm && (
        <CreateKeyForm
          instances={instances}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Revoke error (shown outside modal in case modal closed) */}
      {revokeError && (
        <div className={styles.errorRow} role="alert">{revokeError}</div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className={styles.loadingRow}>
          <span className={styles.spinnerSmall} aria-hidden="true" />
          Loading API keys…
        </div>
      )}

      {/* Load error */}
      {loadError && !isLoading && (
        <div className={styles.errorRow} role="alert">
          {loadError instanceof Error ? loadError.message : String(loadError)}
          {' '}
          <button
            type="button"
            onClick={() => void refetch()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-accent-primary)',
              cursor: 'pointer',
              fontSize: 'inherit',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !loadError && sortedKeys.length === 0 && (
        <div className={styles.emptyState}>
          No API keys registered. Run{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>iranti setup</code>
          {' '}or create your first key here.
        </div>
      )}

      {/* Keys table */}
      {!isLoading && !loadError && sortedKeys.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Key ID</th>
                <th>Owner</th>
                <th>Scopes</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedKeys.map(key => (
                <tr key={key.keyId} className={key.revoked ? styles.rowRevoked : undefined}>
                  <td className={styles.keyIdCell}>{key.keyId}</td>
                  <td className={styles.ownerCell}>{key.owner || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                  <td>
                    {key.scopes.length === 0 ? (
                      <span className={styles.scopeTagEmpty}>none</span>
                    ) : (
                      <div className={styles.scopesCell}>
                        {key.scopes.map(s => (
                          <span key={s} className={styles.scopeTag}>{s}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={styles.timestampCell}>{formatDate(key.createdAt)}</td>
                  <td className={styles.timestampCell}>{formatDate(key.updatedAt)}</td>
                  <td>
                    {key.revoked ? (
                      <span className={styles.badgeRevoked}>Revoked</span>
                    ) : (
                      <span className={styles.badgeActive}>
                        <span className={styles.activeIndicator} aria-hidden="true" />
                        Active
                      </span>
                    )}
                  </td>
                  <td>
                    {!key.revoked && (
                      <button
                        className={styles.revokeBtn}
                        type="button"
                        onClick={() => setRevokeTarget(key)}
                        title={`Revoke ${key.keyId}`}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Revoke confirmation modal */}
      {revokeTarget && (
        <RevokeConfirmModal
          target={revokeTarget}
          onConfirm={() => void handleRevoke()}
          onCancel={() => setRevokeTarget(null)}
          inFlight={revokeInFlight}
        />
      )}
    </div>
  )
}
