/* Iranti Control Plane — Provider Manager */
/* Route: /providers */
/* CP-T046: Standalone provider view, warning threshold, detail panel */

import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, setProviderKey, removeProviderKey, setDefaultProvider, clearDefaultProvider, setFallbackChain, clearFallbackChain } from '../../api/client'
import type { ProvidersResponse, ProviderStatus, ProviderModelsResponse, ProviderScopeType } from '../../api/types'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import styles from './ProviderManager.module.css'
import { Spinner } from '../ui/Spinner'
import { RoutingEditor } from './RoutingEditor'

// ---------------------------------------------------------------------------
// localStorage helpers for warning thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS_KEY = 'iranti_cp_provider_thresholds'

function loadThresholds(): Record<string, number> {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, number>
    }
  } catch {
    // corrupt storage — reset
  }
  return {}
}

function saveThresholds(thresholds: Record<string, number>): void {
  try {
    localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(thresholds))
  } catch {
    // storage unavailable — non-fatal
  }
}

// ---------------------------------------------------------------------------
// In-session reachability history (last 3 checks per provider)
// ---------------------------------------------------------------------------

type ReachabilityHistory = Record<string, Array<{ reachable: boolean; checkedAt: string }>>

function recordHistory(prev: ReachabilityHistory, providers: ProviderStatus[]): ReachabilityHistory {
  const next = { ...prev }
  for (const p of providers) {
    const existing = prev[p.id] ?? []
    const entry = { reachable: p.reachable, checkedAt: p.lastChecked }
    // Avoid duplicate timestamps
    if (existing.length > 0 && existing[existing.length - 1]?.checkedAt === p.lastChecked) {
      continue
    }
    next[p.id] = [...existing, entry].slice(-3) // keep last 3
  }
  return next
}

// ---------------------------------------------------------------------------
// Provider icons
// ---------------------------------------------------------------------------

function providerIcon(id: string): string {
  switch (id) {
    case 'claude':    return 'C'
    case 'openai':    return 'OA'
    case 'ollama':    return 'OL'
    case 'together':  return 'T'
    case 'groq':      return 'G'
    default:          return id.slice(0, 2).toUpperCase()
  }
}

// ---------------------------------------------------------------------------
// Reachability badge
// ---------------------------------------------------------------------------

type ReachabilityState = 'connected' | 'unreachable' | 'not_configured'

function resolveReachabilityState(p: ProviderStatus): ReachabilityState {
  if (!p.keyPresent) return 'not_configured'
  return p.reachable ? 'connected' : 'unreachable'
}

function ReachabilityBadge({ state }: { state: ReachabilityState }) {
  const labels: Record<ReachabilityState, string> = {
    connected:      'Connected',
    unreachable:    'Unreachable',
    not_configured: 'Not configured',
  }
  const classMap: Record<ReachabilityState, string> = {
    connected:      styles.badgeConnected,
    unreachable:    styles.badgeUnreachable,
    not_configured: styles.badgeNotConfigured,
  }
  return (
    <span className={`${styles.badge} ${classMap[state]}`} aria-label={`Reachability: ${labels[state]}`}>
      {labels[state]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// CP-T063: Scope badge + helpers
// ---------------------------------------------------------------------------

/** Truncate a scope string for display in the list card */
function truncateScope(scope: string, max = 28): string {
  return scope.length > max ? scope.slice(0, max - 1) + '…' : scope
}

interface ScopeBadgeProps {
  scope: string | null
  scopeType: ProviderScopeType
}

function ScopeBadge({ scope, scopeType }: ScopeBadgeProps) {
  if (scopeType === 'global') {
    return (
      <span className={styles.scopeBadgeGlobal} title="Global — applies to all namespaces">
        global
      </span>
    )
  }
  if (scopeType === 'namespace' && scope) {
    const display = truncateScope(scope)
    return (
      <code className={styles.scopeCode} title={scope}>
        {display}
      </code>
    )
  }
  // unknown or null
  return <span className={styles.scopeUnknown}>—</span>
}

// ---------------------------------------------------------------------------
// Quota-supported providers
// ---------------------------------------------------------------------------

// Providers where balance threshold is meaningful (supported:true from quota endpoint)
// Claude is permanently supported:false — threshold hidden for it.
// We compute this frontend-side rather than fetching quota for each provider on load.
// Instead: show the threshold field for together/openai (may be supported), hide for claude.
const QUOTA_SUPPORTED_PROVIDERS = new Set(['openai', 'together'])

// ---------------------------------------------------------------------------
// Model list (full — no truncation for detail panel)
// ---------------------------------------------------------------------------

function FullModelList({ providerId, reachable, instanceId }: { providerId: string; reachable: boolean; instanceId?: string }) {
  const { data, isLoading, error } = useQuery<ProviderModelsResponse, Error>({
    queryKey: ['provider-models', instanceId, providerId],
    queryFn: () => apiFetch<ProviderModelsResponse>(`/providers/${providerId}/models`, { instanceId }),
    staleTime: 5 * 60 * 1000,
    enabled: reachable || providerId === 'claude',
  })

  if (isLoading) {
    return <p className={styles.modelsLoading}>Loading models…</p>
  }

  if (error || !data) {
    return <p className={styles.modelsError}>Could not load models</p>
  }

  if (data.models.length === 0) {
    return <p className={styles.modelsEmpty}>No models available</p>
  }

  const sourceLabel =
    data.source === 'live' ? 'live' :
    data.source === 'fallback' ? 'fallback list' : 'static list'

  return (
    <div className={styles.fullModelList}>
      <div className={styles.modelListHeader}>
        <span className={styles.modelCount}>{data.models.length} model{data.models.length !== 1 ? 's' : ''}</span>
        <span className={styles.modelSource}>via {sourceLabel}</span>
      </div>
      <ul className={styles.modelItems} aria-label={`Models for ${providerId}`}>
        {data.models.map((m) => (
          <li key={m.id} className={styles.modelItem}>
            <span className={styles.modelId}>{m.id}</span>
            {m.context > 0 && (
              <span className={styles.modelContext}>{(m.context / 1000).toFixed(0)}k ctx</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Key write form — inline within the API Key section of DetailPanel
// ---------------------------------------------------------------------------

interface KeyWriteFormProps {
  provider: ProviderStatus
  instanceId?: string
  onSuccess: () => void
}

function KeyWriteForm({ provider, instanceId, onSuccess }: KeyWriteFormProps) {
  const [keyInput, setKeyInput] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const clearFeedback = () => setFeedback(null)

  const handleSet = async () => {
    if (!keyInput.trim()) return
    setPending(true)
    clearFeedback()
    try {
      const result = await setProviderKey(provider.id, keyInput.trim(), instanceId)
      setKeyInput('')
      setShowInput(false)
      setFeedback({ kind: 'ok', msg: result.restartRequired ? 'Key saved to the instance env. Restart the instance to apply.' : 'Key saved.' })
      onSuccess()
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Failed to save key.' })
    } finally {
      setPending(false)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm(`Remove the API key for ${provider.name}? This will clear ${provider.keyEnvVar} from the live instance env.`)) return
    setPending(true)
    clearFeedback()
    try {
      const result = await removeProviderKey(provider.id, instanceId)
      setFeedback({ kind: 'ok', msg: result.restartRequired ? 'Key removed from the instance env. Restart the instance to apply.' : 'Key removed.' })
      onSuccess()
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Failed to remove key.' })
    } finally {
      setPending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSet()
    if (e.key === 'Escape') { setShowInput(false); setKeyInput('') }
  }

  return (
    <div className={styles.keyWriteForm}>
      {provider.keyPresent && !showInput && (
        <div className={styles.writeFormRow}>
          <button
            type="button"
            className={styles.writeBtnSecondary}
            onClick={() => { setShowInput(true); clearFeedback() }}
            disabled={pending}
          >
            Update key
          </button>
          <button
            type="button"
            className={styles.writeBtnDanger}
            onClick={() => void handleRemove()}
            disabled={pending}
          >
            Remove key
          </button>
        </div>
      )}

      {(!provider.keyPresent || showInput) && (
        <div className={styles.writeFormRow}>
          <input
            type="password"
            className={styles.writeInput}
            placeholder={`Paste ${provider.keyEnvVar}…`}
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.writeBtn}
            onClick={() => void handleSet()}
            disabled={pending || !keyInput.trim()}
          >
            {pending ? 'Saving…' : provider.keyPresent ? 'Update' : 'Save key'}
          </button>
          {showInput && (
            <button
              type="button"
              className={styles.writeBtnSecondary}
              onClick={() => { setShowInput(false); setKeyInput(''); clearFeedback() }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {feedback && (
        <p className={feedback.kind === 'ok' ? styles.writeSuccess : styles.writeError}>
          {feedback.msg}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Global config panel — default provider + fallback chain
// ---------------------------------------------------------------------------

const ALL_CONFIGURABLE_PROVIDERS = Object.keys({
  claude: true, openai: true, gemini: true, groq: true, mistral: true, together: true, ollama: true, mock: true,
})

interface GlobalConfigProps {
  defaultProvider: string | null
  fallbackChain: string[]
  instanceId?: string
  onSuccess: () => void
}

function GlobalConfigPanel({ defaultProvider, fallbackChain, instanceId, onSuccess }: GlobalConfigProps) {
  const [selectedDefault, setSelectedDefault] = useState(defaultProvider ?? '')
  const [chain, setChain] = useState<string[]>(fallbackChain)
  const [addProvider, setAddProvider] = useState('')
  const [defaultPending, setDefaultPending] = useState(false)
  const [defaultFeedback, setDefaultFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [chainPending, setChainPending] = useState(false)
  const [chainFeedback, setChainFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  // Sync when parent data refreshes
  useEffect(() => { setSelectedDefault(defaultProvider ?? '') }, [defaultProvider])
  useEffect(() => { setChain(fallbackChain) }, [fallbackChain])

  const handleSetDefault = async () => {
    setDefaultPending(true)
    setDefaultFeedback(null)
    try {
      if (selectedDefault) {
        const result = await setDefaultProvider(selectedDefault, instanceId)
        setDefaultFeedback({ kind: 'ok', msg: result.restartRequired ? 'Default provider saved. Restart the instance to apply.' : 'Default provider saved.' })
      } else {
        const result = await clearDefaultProvider(instanceId)
        setDefaultFeedback({ kind: 'ok', msg: result.restartRequired ? 'Default provider cleared. Restart the instance to apply.' : 'Default provider cleared.' })
      }
      onSuccess()
    } catch (e) {
      setDefaultFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Failed to update default.' })
    } finally {
      setDefaultPending(false)
    }
  }

  const handleAddChainItem = () => {
    if (!addProvider || chain.includes(addProvider)) return
    setChain(prev => [...prev, addProvider])
    setAddProvider('')
  }

  const handleRemoveChainItem = (idx: number) => {
    setChain(prev => prev.filter((_, i) => i !== idx))
  }

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return
    setChain(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  const handleMoveDown = (idx: number) => {
    setChain(prev => {
      if (idx === prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  const handleSaveChain = async () => {
    setChainPending(true)
    setChainFeedback(null)
    try {
      if (chain.length === 0) {
        const result = await clearFallbackChain(instanceId)
        setChainFeedback({ kind: 'ok', msg: result.restartRequired ? 'Fallback chain cleared. Restart the instance to apply.' : 'Fallback chain cleared.' })
      } else {
        const result = await setFallbackChain(chain, instanceId)
        setChainFeedback({ kind: 'ok', msg: result.restartRequired ? 'Fallback chain saved. Restart the instance to apply.' : 'Fallback chain saved.' })
      }
      onSuccess()
    } catch (e) {
      setChainFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Failed to update fallback chain.' })
    } finally {
      setChainPending(false)
    }
  }

  const availableToAdd = ALL_CONFIGURABLE_PROVIDERS.filter(p => !chain.includes(p))

  return (
    <div className={styles.configSection}>
      <h2 className={styles.configSectionTitle}>Instance Configuration</h2>

      {/* Default provider */}
      <div className={styles.configRow}>
        <label className={styles.configLabel} htmlFor="default-provider-select">
          Default provider
        </label>
        <select
          id="default-provider-select"
          className={styles.configSelect}
          value={selectedDefault}
          onChange={e => setSelectedDefault(e.target.value)}
          disabled={defaultPending}
        >
          <option value="">(none — auto-detect)</option>
          {ALL_CONFIGURABLE_PROVIDERS.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          type="button"
          className={styles.writeBtn}
          onClick={() => void handleSetDefault()}
          disabled={defaultPending}
        >
          {defaultPending ? 'Saving…' : 'Save'}
        </button>
        {defaultFeedback && (
          <span className={defaultFeedback.kind === 'ok' ? styles.writeSuccess : styles.writeError}>
            {defaultFeedback.msg}
          </span>
        )}
      </div>

      {/* Fallback chain */}
      <div>
        <div className={styles.configRow} style={{ marginBottom: 'var(--space-1)' }}>
          <span className={styles.configLabel}>Fallback chain</span>
          {chain.length > 0 && (
            <ul className={styles.fallbackChainList}>
              {chain.map((p, i) => (
                <li key={p} className={styles.fallbackChainItem}>
                  <span className={styles.fallbackChainIndex}>{i + 1}.</span>
                  <span className={styles.fallbackChainItemName}>{p}</span>
                  <button
                    type="button"
                    className={styles.writeBtnSecondary}
                    onClick={() => handleMoveUp(i)}
                    disabled={chainPending || i === 0}
                    aria-label={`Move ${p} up`}
                    title="Move up"
                  >↑</button>
                  <button
                    type="button"
                    className={styles.writeBtnSecondary}
                    onClick={() => handleMoveDown(i)}
                    disabled={chainPending || i === chain.length - 1}
                    aria-label={`Move ${p} down`}
                    title="Move down"
                  >↓</button>
                  <button
                    type="button"
                    className={styles.writeBtnDanger}
                    onClick={() => handleRemoveChainItem(i)}
                    disabled={chainPending}
                    aria-label={`Remove ${p} from fallback chain`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chain.length === 0 && (
            <p className={styles.fallbackChainEmpty}>No fallback chain configured (LLM_PROVIDER_FALLBACK not set)</p>
          )}
        </div>
        <div className={styles.fallbackAddRow}>
          <select
            className={styles.configSelect}
            value={addProvider}
            onChange={e => setAddProvider(e.target.value)}
            disabled={chainPending}
            aria-label="Select provider to add to fallback chain"
          >
            <option value="">Add provider…</option>
            {availableToAdd.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button
            type="button"
            className={styles.writeBtnSecondary}
            onClick={handleAddChainItem}
            disabled={!addProvider || chainPending}
          >
            Add
          </button>
          <button
            type="button"
            className={styles.writeBtn}
            onClick={() => void handleSaveChain()}
            disabled={chainPending}
          >
            {chainPending ? 'Saving…' : 'Save chain'}
          </button>
          {chainFeedback && (
            <span className={chainFeedback.kind === 'ok' ? styles.writeSuccess : styles.writeError}>
              {chainFeedback.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider Detail Panel (right-side)
// ---------------------------------------------------------------------------

interface DetailPanelProps {
  provider: ProviderStatus
  instanceId?: string
  history: Array<{ reachable: boolean; checkedAt: string }>
  threshold: number | undefined
  onThresholdChange: (providerId: string, value: number) => void
  onRefresh: () => void
  isRefreshing: boolean
  onKeyChange: () => void
}

function DetailPanel({
  provider,
  instanceId,
  history,
  threshold,
  onThresholdChange,
  onRefresh,
  isRefreshing,
  onKeyChange,
}: DetailPanelProps) {
  const state = resolveReachabilityState(provider)
  const showThreshold = QUOTA_SUPPORTED_PROVIDERS.has(provider.id)
  const [thresholdInput, setThresholdInput] = useState<string>(
    threshold !== undefined ? String(threshold) : '5.00'
  )

  // Sync input if threshold prop changes externally
  useEffect(() => {
    if (threshold !== undefined) {
      setThresholdInput(String(threshold))
    }
  }, [threshold])

  const handleThresholdBlur = () => {
    const parsed = parseFloat(thresholdInput)
    if (!isNaN(parsed) && parsed >= 0) {
      onThresholdChange(provider.id, parsed)
    } else {
      // reset to stored or default
      setThresholdInput(threshold !== undefined ? String(threshold) : '5.00')
    }
  }

  const handleThresholdKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  // Provider-specific quota note
  const quotaNote = (() => {
    if (provider.id === 'claude') {
      return 'Claude does not expose credits via API. Check your Anthropic Console for usage.'
    }
    if (provider.id === 'openai') {
      return 'Live balance requires org:read scope. Check the OpenAI Usage dashboard directly.'
    }
    if (provider.id === 'groq') {
      return 'Groq exposes rate limit headers only — no persistent balance available.'
    }
    return null
  })()

  return (
    <div className={styles.detailPanel} aria-label={`${provider.name} detail panel`}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <span className={styles.detailIcon} aria-hidden="true">{providerIcon(provider.id)}</span>
          <div className={styles.detailTitleMeta}>
            <span className={styles.detailProviderName}>{provider.name}</span>
            <span className={styles.detailEnvVar}>{provider.keyEnvVar}</span>
          </div>
          <div className={styles.detailBadges}>
            {provider.isDefault && (
              <span className={styles.defaultBadge} aria-label="Default provider">Default</span>
            )}
            <ReachabilityBadge state={state} />
          </div>
        </div>

        <button
          className={`${styles.refreshBtn} ${isRefreshing ? styles.refreshBtnSpinning : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          type="button"
          aria-label="Refresh provider status"
          title="Refresh now (bypasses 1-min cache)"
        >
          ↺ Refresh now
        </button>
      </div>

      {/* Key info + write form */}
      <section className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>API Key</h3>
        {provider.keyPresent && provider.keyMasked ? (
          <div className={styles.keyRow}>
            <span className={styles.keyLabel}>key</span>
            <code className={styles.keyValue}>{provider.keyMasked}</code>
            <span className={styles.keyPresent}>✓ Present</span>
          </div>
        ) : (
          <p className={styles.keyAbsent}>
            No key configured — add <code>{provider.keyEnvVar}</code> with the form below or run{' '}
            <code>iranti add api-key {provider.id} --instance local</code>.
          </p>
        )}
        {provider.id !== 'mock' && (
          <KeyWriteForm provider={provider} instanceId={instanceId} onSuccess={onKeyChange} />
        )}
      </section>

      {/* CP-T063: API Key Scope */}
      <section className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>API Key Scope</h3>
        <div className={styles.scopeDetailRow}>
          <ScopeBadge scope={provider.scope} scopeType={provider.scopeType} />
          {provider.scope && provider.scopeType !== 'unknown' && (
            <code className={styles.scopeDetailFull} title={provider.scope}>
              {provider.scope}
            </code>
          )}
        </div>
        <p className={styles.scopeDetailNote}>
          Scopes restrict which agent or project namespaces this key services. A global scope (or no
          scope) means the key applies to all namespaces. Manage scopes with{' '}
          <code className={styles.scopeInlineCode}>iranti setup</code>.
        </p>
      </section>

      {/* Quota / balance */}
      <section className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>Balance &amp; Quota</h3>
        {quotaNote ? (
          <p className={styles.quotaNote}>{quotaNote}</p>
        ) : (
          <p className={styles.quotaNote}>Balance data not available — check your provider dashboard.</p>
        )}

        {/* Warning threshold — only for quota-capable providers */}
        {showThreshold && (
          <div className={styles.thresholdRow}>
            <label htmlFor={`threshold-${provider.id}`} className={styles.thresholdLabel}>
              Warn when balance below
            </label>
            <div className={styles.thresholdInputGroup}>
              <span className={styles.thresholdCurrency}>$</span>
              <input
                id={`threshold-${provider.id}`}
                type="number"
                min="0"
                step="0.01"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onBlur={handleThresholdBlur}
                onKeyDown={handleThresholdKey}
                className={styles.thresholdInput}
                aria-label="Warning threshold in USD"
              />
              <span className={styles.thresholdUnit}>USD</span>
            </div>
            <p className={styles.thresholdNote}>
              Balance data not available — threshold will apply when live balance is supported.
            </p>
          </div>
        )}
      </section>

      {/* Reachability history */}
      {history.length > 0 && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Recent Reachability</h3>
          <ul className={styles.historyList} aria-label="Recent reachability checks">
            {[...history].reverse().map((entry, i) => (
              <li key={i} className={styles.historyItem}>
                <span
                  className={entry.reachable ? styles.historyDotOk : styles.historyDotFail}
                  aria-hidden="true"
                >●</span>
                <span className={styles.historyState}>
                  {entry.reachable ? 'Connected' : 'Unreachable'}
                </span>
                <span className={styles.historyTime}>
                  {new Date(entry.checkedAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Model list — full, untruncated */}
      {(state === 'connected' || provider.id === 'claude') && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Models</h3>
          {provider.id === 'groq' && (
            <p className={styles.groqRateLimitNote}>
              Rate limit snapshot (from last check) — reflects rate limit state at the time of the last API check, not a persistent balance.
            </p>
          )}
          <FullModelList providerId={provider.id} reachable={provider.reachable} instanceId={instanceId} />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider list card (left panel)
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: ProviderStatus
  isSelected: boolean
  onClick: () => void
}

function ProviderCard({ provider, isSelected, onClick }: ProviderCardProps) {
  const state = resolveReachabilityState(provider)

  const cardStateClass =
    state === 'connected'   ? styles.cardConnected :
    state === 'unreachable' ? styles.cardUnreachable :
                              styles.cardNotConfigured

  return (
    <button
      type="button"
      className={`${styles.card} ${cardStateClass} ${isSelected ? styles.cardSelected : ''}`}
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`${provider.name} provider — ${state.replace('_', ' ')}`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.providerIcon} aria-hidden="true">
          {providerIcon(provider.id)}
        </span>
        <div className={styles.providerMeta}>
          <div className={styles.providerNameRow}>
            <span className={styles.providerName}>{provider.name}</span>
            {provider.isDefault && (
              <span className={styles.defaultBadge} aria-label="Default provider">Default</span>
            )}
          </div>
          <span className={styles.providerEnvVar}>{provider.keyEnvVar}</span>
        </div>
        <div className={styles.cardBadges}>
          <span
            className={provider.keyPresent ? styles.keyPresent : styles.keyAbsent}
            aria-label={provider.keyPresent ? 'API key present' : 'API key absent'}
          >
            {provider.keyPresent ? '✓ Key set' : '✗ No key'}
          </span>
          <ReachabilityBadge state={state} />
        </div>
      </div>

      {provider.keyPresent && provider.keyMasked && (
        <div className={styles.keyMasked} aria-label="Masked API key">
          <span className={styles.keyMaskedLabel}>key</span>
          <code className={styles.keyMaskedValue}>{provider.keyMasked}</code>
        </div>
      )}

      {/* CP-T063: Scope column in list card */}
      <div className={styles.cardScopeRow}>
        <span className={styles.cardScopeLabel}>Scope</span>
        <ScopeBadge scope={provider.scope} scopeType={provider.scopeType} />
      </div>

      <div className={styles.cardFooter}>
        <span className={styles.lastChecked}>
          Checked: {new Date(provider.lastChecked).toLocaleTimeString()}
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component: ProviderManager
// ---------------------------------------------------------------------------

export function ProviderManager() {
  const { activeInstance } = useInstanceContext()
  const queryClient = useQueryClient()
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [thresholds, setThresholds] = useState<Record<string, number>>(loadThresholds)
  const [reachabilityHistory, setReachabilityHistory] = useState<ReachabilityHistory>({})
  const historyRef = useRef(reachabilityHistory)
  historyRef.current = reachabilityHistory

  const { data, isLoading, error, refetch, isFetching } = useQuery<ProvidersResponse, Error>({
    queryKey: ['providers', activeInstance?.id],
    queryFn: () => apiFetch<ProvidersResponse>('/providers', { instanceId: activeInstance?.id }),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  // Record reachability history whenever data changes
  useEffect(() => {
    if (data?.providers) {
      setReachabilityHistory(prev => recordHistory(prev, data.providers))
    }
  }, [data])

  const handleThresholdChange = (providerId: string, value: number) => {
    setThresholds(prev => {
      const next = { ...prev, [providerId]: value }
      saveThresholds(next)
      return next
    })
  }

  const handleRefreshAll = () => void refetch()

  const handleDetailRefresh = () => {
    // Invalidates the reachability cache on next call via forced refetch
    void refetch()
  }

  const handleWriteSuccess = () => {
    // Invalidate the providers query so the list + config panel reflect the change
    void queryClient.invalidateQueries({ queryKey: ['providers'] })
  }

  const needsClaudeMigration =
    data?.rawDefaultProvider === 'anthropic' ||
    Boolean(data?.rawFallbackChain?.includes('anthropic'))

  const [migrationPending, setMigrationPending] = useState(false)
  const [migrationFeedback, setMigrationFeedback] = useState<string | null>(null)

  const handleNormalizeClaudeProviderIds = async () => {
    if (!data) return
    setMigrationPending(true)
    setMigrationFeedback(null)
    try {
      if (data.rawDefaultProvider === 'anthropic') {
        await setDefaultProvider('claude', activeInstance?.id)
      }

      if (data.rawFallbackChain?.includes('anthropic')) {
        const normalized = data.rawFallbackChain.map(value => value === 'anthropic' ? 'claude' : value)
        if (normalized.length === 0) {
          await clearFallbackChain(activeInstance?.id)
        } else {
          await setFallbackChain(normalized, activeInstance?.id)
        }
      }

      setMigrationFeedback('Provider IDs normalized to claude. Restart the instance to apply.')
      handleWriteSuccess()
    } catch (e) {
      setMigrationFeedback(e instanceof Error ? e.message : 'Failed to normalize provider IDs.')
    } finally {
      setMigrationPending(false)
    }
  }

  const selectedProvider = data?.providers.find(p => p.id === selectedProviderId) ?? null

  // Auto-select first configured provider on load
  useEffect(() => {
    if (data?.providers) {
      const stillExists = selectedProviderId && data.providers.some(p => p.id === selectedProviderId)
      if (!stillExists) {
        const first = data.providers.find(p => p.keyPresent) ?? data.providers[0]
        setSelectedProviderId(first?.id ?? null)
      }
    }
  }, [data, selectedProviderId])

  if (!isLoading && error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>
          <span aria-hidden="true">✗</span> Could not load providers: {error.message}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">◈</span>
          <div>
            <h1 className={styles.pageTitle}>Providers</h1>
            <p className={styles.pageSubtitle}>
              API key presence, reachability, models, and warning thresholds
              {data?.scope ? ` for ${data.scope.instanceName}` : ''}
            </p>
          </div>
        </div>
        <button
          className={`${styles.refreshAllBtn} ${isFetching ? styles.refreshBtnSpinning : ''}`}
          onClick={handleRefreshAll}
          disabled={isFetching}
          type="button"
          aria-label="Refresh all providers"
        >
          ↺ Refresh all
        </button>
      </div>

      {!isLoading && needsClaudeMigration && (
        <div className={styles.errorState}>
          <span aria-hidden="true">âš </span> This instance still uses legacy `anthropic` provider IDs.
          <button
            type="button"
            className={styles.writeBtn}
            onClick={() => void handleNormalizeClaudeProviderIds()}
            disabled={migrationPending}
          >
            {migrationPending ? 'Fixingâ€¦' : 'Normalize to claude'}
          </button>
          {migrationFeedback && <span>{migrationFeedback}</span>}
        </div>
      )}

      {/* Global config: default provider + fallback chain */}
      {!isLoading && data && (
        <GlobalConfigPanel
          defaultProvider={data.defaultProvider}
          fallbackChain={data.fallbackChain}
          instanceId={activeInstance?.id}
          onSuccess={handleWriteSuccess}
        />
      )}

      {/* CP-T087: Task-model routing editor */}
      {!isLoading && data && (
        <RoutingEditor
          taskRouting={data.taskRouting}
          activeProvider={data.defaultProvider}
          onSuccess={handleWriteSuccess}
        />
      )}

      {/* Main content: provider list + detail panel */}
      <div className={styles.layout}>
        {/* Left: provider list */}
        <div className={styles.listPane}>
          {isLoading && (
            <div className={styles.loadingState} aria-busy="true" aria-label="Loading providers">
              <Spinner size="md" label="Loading providers" />
            </div>
          )}

          {!isLoading && data && data.providers.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon} aria-hidden="true">◈</span>
              <p className={styles.emptyTitle}>No providers detected</p>
              <p className={styles.emptyBody}>
                Add a provider key with this page or run{' '}
                <code>{`iranti add api-key <provider> --instance ${activeInstance?.name ?? 'local'}`}</code>. Ollama uses{' '}
                <code>OLLAMA_BASE_URL</code> in the live instance env.
              </p>
            </div>
          )}

          {!isLoading && data && data.providers.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              isSelected={p.id === selectedProviderId}
              onClick={() => setSelectedProviderId(p.id)}
            />
          ))}
        </div>

        {/* Right: detail panel */}
        <div className={styles.detailPane}>
          {!selectedProvider && !isLoading && (
            <div className={styles.detailEmpty}>
              <span className={styles.detailEmptyIcon} aria-hidden="true">◈</span>
              <p className={styles.detailEmptyText}>Select a provider to view details</p>
            </div>
          )}

          {selectedProvider && (
            <DetailPanel
              provider={selectedProvider}
              history={reachabilityHistory[selectedProvider.id] ?? []}
              threshold={thresholds[selectedProvider.id]}
              onThresholdChange={handleThresholdChange}
              onRefresh={handleDetailRefresh}
              isRefreshing={isFetching}
              onKeyChange={handleWriteSuccess}
              instanceId={activeInstance?.id}
            />
          )}
        </div>
      </div>
    </div>
  )
}
