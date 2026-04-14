/**
 * Iranti Control Plane — Rules Manager
 * Route: /rules
 * Displays all operating rules stored as rule/* entities.
 * Supports delete. Rules are created via CLI (iranti write-rule) or MCP (iranti_write_rule).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchRules, deleteRule } from '../../api/client'
import type { Rule } from '../../api/client'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import { Spinner } from '../ui/Spinner'
import styles from './RulesManager.module.css'

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function EnforcementBadge({ enforcement }: { enforcement: string }) {
  const isHard = enforcement === 'hard'
  return (
    <span className={`${styles.badge} ${isHard ? styles.badgeHard : styles.badgeSoft}`}>
      {isHard ? 'REQUIRED' : 'soft'}
    </span>
  )
}

function RuleRow({ rule, instanceId, onDeleted }: { rule: Rule; instanceId: string | undefined; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: () => deleteRule(rule.ruleId, instanceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules', instanceId] })
      onDeleted()
    },
  })

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    deleteMutation.mutate()
  }

  return (
    <div className={styles.ruleRow}>
      <div className={styles.ruleHeader}>
        <span className={styles.ruleId}>{rule.ruleId}</span>
        <div className={styles.ruleHeaderMeta}>
          <EnforcementBadge enforcement={rule.enforcement} />
          <span className={styles.ruleMeta}>scope: {rule.scope}</span>
          <span className={styles.ruleMeta}>{formatRelativeTime(rule.updatedAt)}</span>
          <button
            className={`${styles.deleteBtn} ${confirming ? styles.deleteBtnConfirm : ''}`}
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            title={confirming ? 'Click again to confirm deletion' : 'Delete rule'}
          >
            {deleteMutation.isPending ? '…' : confirming ? 'Confirm delete' : '✕'}
          </button>
          {confirming && !deleteMutation.isPending && (
            <button
              className={styles.cancelBtn}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <p className={styles.ruleText}>{rule.rule}</p>

      {rule.triggers.length > 0 && (
        <div className={styles.triggers}>
          <span className={styles.triggersLabel}>triggers:</span>
          {(rule.triggers as string[]).map((t) => (
            <span key={t} className={styles.trigger}>{t}</span>
          ))}
        </div>
      )}

      {deleteMutation.isError && (
        <p className={styles.error}>{(deleteMutation.error as Error).message}</p>
      )}
    </div>
  )
}

export function RulesManager() {
  const { activeInstance } = useInstanceContext()
  const instanceId = activeInstance?.id
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rules', instanceId],
    queryFn: () => fetchRules(instanceId),
    staleTime: 10_000,
  })

  const handleDeleted = () => {
    void queryClient.invalidateQueries({ queryKey: ['rules', instanceId] })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <h2 className={styles.pageTitle}>Operating Rules</h2>
          {data && (
            <span className={styles.countBadge}>{data.total}</span>
          )}
        </div>
        <div className={styles.pageHeaderRight}>
          <button className={styles.refreshBtn} onClick={() => void refetch()} title="Refresh">
            ↻
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {isLoading && (
          <div className={styles.loadingState}>
            <Spinner />
            <span>Loading rules…</span>
          </div>
        )}

        {error && (
          <div className={styles.errorState}>
            <span className={styles.errorIcon}>⚠</span>
            <span>{(error as Error).message}</span>
          </div>
        )}

        {!isLoading && !error && data?.rules.length === 0 && (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>No operating rules</p>
            <p className={styles.emptyHint}>
              Create rules with <code>iranti write-rule</code> from the CLI, or via the MCP{' '}
              <code>iranti_write_rule</code> tool.
            </p>
          </div>
        )}

        {!isLoading && !error && data && data.rules.length > 0 && (
          <div className={styles.ruleList}>
            {data.rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                instanceId={instanceId}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
