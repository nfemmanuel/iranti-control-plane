/* Iranti Control Plane — Doctor Results Drawer */
/* CP-T033 — Right-side drawer showing per-instance doctor check results */

import { useState } from 'react'
import type { DoctorCheck, DoctorResponse, RepairMcpJsonResponse, RepairClaudeMdResponse } from '../../api/types'
import { ConfirmationModal } from '../ui/ConfirmationModal'
import styles from './DoctorDrawer.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface RepairState {
  checkId: string
  repairUrl: string
  label: string
}

/* ------------------------------------------------------------------ */
/*  Status icon for doctor checks                                       */
/* ------------------------------------------------------------------ */

function DoctorCheckIcon({ status }: { status: DoctorCheck['status'] }) {
  if (status === 'pass') {
    return <span className={styles.iconPass} aria-label="Pass">✓</span>
  }
  if (status === 'warn') {
    return <span className={styles.iconWarn} aria-label="Warning">⚠</span>
  }
  return <span className={styles.iconFail} aria-label="Failed">✗</span>
}

/* ------------------------------------------------------------------ */
/*  Individual check row                                                */
/* ------------------------------------------------------------------ */

function DoctorCheckRow({
  check,
  onRepair,
}: {
  check: DoctorCheck
  onRepair: (repairUrl: string, label: string) => void
}) {
  return (
    <div className={`${styles.checkRow} ${styles[`checkRow_${check.status}`]}`}>
      <div className={styles.checkHeader}>
        <DoctorCheckIcon status={check.status} />
        <span className={styles.checkLabel}>{check.label}</span>
      </div>
      <p className={styles.checkMessage}>{check.message}</p>
      {check.repairAction && (
        <button
          className={styles.inlineRepairBtn}
          onClick={() => onRepair(check.repairAction!, check.label)}
          type="button"
        >
          Repair ↗
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Repair result display                                               */
/* ------------------------------------------------------------------ */

interface RepairResult {
  kind: 'mcp-json' | 'claude-md'
  data: RepairMcpJsonResponse | RepairClaudeMdResponse
}

function RepairResultBanner({
  result,
  onDismiss,
}: {
  result: RepairResult
  onDismiss: () => void
}) {
  return (
    <div className={styles.repairResult}>
      <span className={styles.repairResultIcon} aria-hidden="true">✓</span>
      <div className={styles.repairResultBody}>
        <p className={styles.repairResultTitle}>Repair complete</p>
        <p className={styles.repairResultFile}>
          <span className={styles.repairResultFileLabel}>File: </span>
          <code className={styles.repairResultFilePath}>{result.data.filePath}</code>
        </p>
        <p className={styles.repairResultAction}>Action: {result.data.action}</p>
        <p className={styles.repairResultWarning}>
          ⚠ This action is not revertable.
        </p>
      </div>
      <button
        className={styles.repairResultDismiss}
        onClick={onDismiss}
        type="button"
        aria-label="Dismiss repair result"
      >
        ×
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Drawer                                                         */
/* ------------------------------------------------------------------ */

interface DoctorDrawerProps {
  instanceId: string
  data: DoctorResponse
  onClose: () => void
}

export function DoctorDrawer({ instanceId, data, onClose }: DoctorDrawerProps) {
  const [pendingRepair, setPendingRepair] = useState<RepairState | null>(null)
  const [repairLoading, setRepairLoading] = useState(false)
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)

  const handleRepairClick = (repairUrl: string, label: string) => {
    setRepairResult(null)
    setRepairError(null)
    setPendingRepair({ checkId: label, repairUrl, label })
  }

  const handleRepairConfirm = async () => {
    if (!pendingRepair) return
    setRepairLoading(true)
    setRepairError(null)
    try {
      const url = `${pendingRepair.repairUrl}?confirm=true`
      const res = await fetch(url, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        const errBody = body as { error?: string }
        throw new Error(errBody.error ?? res.statusText)
      }

      // Detect which repair type based on URL
      const kind = pendingRepair.repairUrl.includes('mcp-json') ? 'mcp-json' : 'claude-md'
      setRepairResult({
        kind,
        data: body as RepairMcpJsonResponse | RepairClaudeMdResponse,
      })
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : 'Repair failed')
    } finally {
      setRepairLoading(false)
      setPendingRepair(null)
    }
  }

  const handleRepairCancel = () => {
    if (!repairLoading) setPendingRepair(null)
  }

  const checkedAt = new Date(data.checkedAt).toLocaleTimeString()
  const passCount = data.checks.filter(c => c.status === 'pass').length
  const failCount = data.checks.filter(c => c.status === 'fail' || c.status === 'warn').length

  return (
    <>
      {/* Drawer overlay — clicking outside closes */}
      <div className={styles.overlay} onClick={onClose} aria-hidden="true" />

      <aside
        className={styles.drawer}
        aria-label="Doctor results"
        role="complementary"
      >
        {/* Drawer header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <h2 className={styles.drawerTitle}>Doctor Results</h2>
            <span className={styles.instanceId} title={instanceId}>
              {instanceId}
            </span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            aria-label="Close doctor results"
          >
            ×
          </button>
        </div>

        {/* Summary line */}
        <div className={styles.summary}>
          <span className={styles.summaryCheckedAt}>Checked at {checkedAt}</span>
          <span className={styles.summaryPass}>{passCount} pass</span>
          {failCount > 0 && (
            <span className={styles.summaryFail}>{failCount} issue{failCount !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Repair result banner */}
        {repairResult && (
          <RepairResultBanner
            result={repairResult}
            onDismiss={() => setRepairResult(null)}
          />
        )}

        {/* Repair error */}
        {repairError && (
          <div className={styles.repairError}>
            <span className={styles.repairErrorIcon} aria-hidden="true">✗</span>
            <span>{repairError}</span>
          </div>
        )}

        {/* Check rows */}
        <div className={styles.checkList}>
          {data.checks.map(check => (
            <DoctorCheckRow
              key={check.id}
              check={check}
              onRepair={handleRepairClick}
            />
          ))}
        </div>

        {/* Repair confirmation modal */}
        {pendingRepair && (
          <ConfirmationModal
            title={`Repair: ${pendingRepair.label}`}
            description={`This will POST to:\n${pendingRepair.repairUrl}?confirm=true\n\nThe repair action will write to the filesystem.`}
            warning="This action is not revertable. The file will be written immediately."
            confirmLabel="Run Repair"
            loading={repairLoading}
            onConfirm={() => void handleRepairConfirm()}
            onCancel={handleRepairCancel}
          />
        )}
      </aside>
    </>
  )
}
