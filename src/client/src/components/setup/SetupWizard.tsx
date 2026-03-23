/* Iranti Control Plane — Guided Setup Wizard */
/* CP-T083 — Full-screen onboarding wizard for first-run experience */
/* Shown when: iranti not installed OR no instance configured */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchInstallState, startInstance } from '../../api/client'
import type { InstallStateResult, HealthResponse } from '../../api/types'
import { IrantiMark } from '../shell/IrantiMark'
import styles from './SetupWizard.module.css'

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const LS_DISMISSED_KEY = 'iranti_cp_setup_dismissed'
const LS_COMPLETE_KEY = 'iranti_setup_complete'
const INSTANCE_NAME_RE = /^[a-zA-Z0-9_-]*$/

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                                */
/* ------------------------------------------------------------------ */

function readLocalFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeLocalFlag(key: string) {
  try {
    localStorage.setItem(key, 'true')
  } catch {
    // non-fatal
  }
}

/* ------------------------------------------------------------------ */
/*  Health probe                                                        */
/* ------------------------------------------------------------------ */

interface HealthProbe {
  reachable: boolean
  authPassing: boolean
}

async function probeHealth(): Promise<HealthProbe> {
  try {
    const res = await fetch('/api/control-plane/health', { method: 'GET' })
    if (!res.ok) return { reachable: false, authPassing: false }
    const data = await res.json() as HealthResponse
    const authCheck = data.checks.find(c => c.name === 'iranti_auth')
    return {
      reachable: data.overall !== 'error' || data.checks.some(c => c.name === 'iranti_connectivity' && c.status === 'ok'),
      authPassing: authCheck?.status === 'ok',
    }
  } catch {
    return { reachable: false, authPassing: false }
  }
}

/* ------------------------------------------------------------------ */
/*  Copy button                                                         */
/* ------------------------------------------------------------------ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1800)
    })
  }, [text])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Command block                                                        */
/* ------------------------------------------------------------------ */

function CommandBlock({ command }: { command: string }) {
  return (
    <div className={styles.commandBlock}>
      <code className={styles.commandText}>{command}</code>
      <CopyButton text={command} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Progress dots                                                        */
/* ------------------------------------------------------------------ */

type StepState = 'active' | 'complete' | 'pending'

function ProgressDots({ total, current, completed }: { total: number; current: number; completed: number }) {
  return (
    <div className={styles.progressDots} aria-label={`Step ${current + 1} of ${total}`} role="progressbar">
      {Array.from({ length: total }, (_, i) => {
        let state: StepState = 'pending'
        if (i < completed) state = 'complete'
        else if (i === current) state = 'active'
        return (
          <span
            key={i}
            className={styles.progressDot}
            data-state={state}
            aria-hidden="true"
          />
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Install Iranti                                             */
/* ------------------------------------------------------------------ */

interface Step1Props {
  installState: InstallStateResult | undefined
  onAdvance: () => void
  onSkip: () => void
}

function Step1Install({ installState, onAdvance, onSkip }: Step1Props) {
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(false)
  const [detected, setDetected] = useState(false)
  const advancedRef = useRef(false)

  // Auto-advance when installed becomes true
  useEffect(() => {
    if (installState?.installed && !advancedRef.current) {
      advancedRef.current = true
      setDetected(true)
      const t = setTimeout(() => onAdvance(), 1500)
      return () => clearTimeout(t)
    }
  }, [installState?.installed, onAdvance])

  // Poll every 3s
  useEffect(() => {
    const id = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['install-state'] })
    }, 3000)
    return () => clearInterval(id)
  }, [queryClient])

  const handleCheckAgain = useCallback(() => {
    setChecking(true)
    void queryClient.invalidateQueries({ queryKey: ['install-state'] }).then(() => {
      setChecking(false)
    })
  }, [queryClient])

  return (
    <div className={styles.stepContent}>
      <h2 className={styles.stepTitle}>Install Iranti</h2>
      <p className={styles.stepBody}>
        Iranti is not detected on your system. Install it with npm:
      </p>
      <CommandBlock command="npm install -g iranti" />
      <p className={styles.stepHint}>
        Then press the button below to check detection, or wait — we&apos;ll check automatically.
      </p>
      {detected && (
        <div className={styles.successBanner} role="status">
          <span className={styles.successIcon} aria-hidden="true">✓</span>
          Iranti detected{installState?.version ? ` — v${installState.version}` : ''} — advancing…
        </div>
      )}
      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleCheckAgain}
          disabled={checking || detected}
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <button type="button" className={styles.skipLink} onClick={onSkip}>
        Already installed? Skip →
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Create an instance                                         */
/* ------------------------------------------------------------------ */

interface Step2Props {
  onAdvance: (name: string) => void
  onSkip: () => void
}

function Step2Create({ onAdvance, onSkip }: Step2Props) {
  const [name, setName] = useState('default')
  const [nameError, setNameError] = useState<string | null>(null)

  const command = `iranti init --instance ${name || '<name>'}`

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!INSTANCE_NAME_RE.test(v)) return  // block invalid chars as they type
    if (v.length > 32) return
    setName(v)
    setNameError(null)
  }, [])

  const handleNext = useCallback(() => {
    if (!name) {
      setNameError('Instance name is required')
      return
    }
    if (!INSTANCE_NAME_RE.test(name) || name.length > 32) {
      setNameError('Name must be alphanumeric, hyphens, or underscores — max 32 chars')
      return
    }
    onAdvance(name)
  }, [name, onAdvance])

  return (
    <div className={styles.stepContent}>
      <h2 className={styles.stepTitle}>Create an instance</h2>
      <p className={styles.stepBody}>
        An instance is a named Iranti process. Create one:
      </p>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="instance-name">
          Instance name
        </label>
        <input
          id="instance-name"
          type="text"
          className={styles.textInput}
          value={name}
          onChange={handleNameChange}
          placeholder="my-instance"
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
        />
        {nameError && <span className={styles.fieldError} role="alert">{nameError}</span>}
      </div>

      <div className={styles.commandLabel}>Command to run in your terminal:</div>
      <CommandBlock command={command} />

      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleNext}
        >
          Next →
        </button>
      </div>
      <button type="button" className={styles.skipLink} onClick={onSkip}>
        Already have an instance? Skip →
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 3 — Start Iranti                                               */
/* ------------------------------------------------------------------ */

interface Step3Props {
  instanceName: string
  onAdvance: () => void
  onSkip: () => void
}

function Step3Start({ instanceName, onAdvance, onSkip }: Step3Props) {
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const advancedRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const command = `iranti run --instance ${instanceName}`

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    // 30s timeout
    timeoutRef.current = setTimeout(() => {
      if (!advancedRef.current) {
        setTimedOut(true)
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }, 30_000)

    pollRef.current = setInterval(() => {
      void probeHealth().then(({ reachable }) => {
        if (reachable && !advancedRef.current) {
          advancedRef.current = true
          setRunning(true)
          if (pollRef.current) clearInterval(pollRef.current)
          if (timeoutRef.current) clearTimeout(timeoutRef.current)
          const t = setTimeout(() => onAdvance(), 1500)
          return () => clearTimeout(t)
        }
      })
    }, 3000)
  }, [onAdvance])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleStart = useCallback(() => {
    if (!instanceName) return
    setStarting(true)
    setStartError(null)
    setTimedOut(false)
    void startInstance(instanceName)
      .then(() => {
        setStarting(false)
        startPolling()
      })
      .catch((err: unknown) => {
        setStarting(false)
        setStartError(err instanceof Error ? err.message : 'Failed to start instance')
      })
  }, [instanceName, startPolling])

  return (
    <div className={styles.stepContent}>
      <h2 className={styles.stepTitle}>Start Iranti</h2>
      <p className={styles.stepBody}>
        Start your instance to connect:
      </p>

      <div className={styles.instanceBadge}>
        <span className={styles.instanceBadgeLabel}>Instance</span>
        <span className={styles.instanceBadgeName}>{instanceName}</span>
      </div>

      <CommandBlock command={command} />

      {running && (
        <div className={styles.successBanner} role="status">
          <span className={styles.successIcon} aria-hidden="true">✓</span>
          Iranti is running — advancing…
        </div>
      )}
      {startError && (
        <div className={styles.errorBanner} role="alert">
          {startError}
        </div>
      )}
      {timedOut && !running && (
        <div className={styles.warnBanner} role="status">
          Still starting — this can take a few seconds. If it doesn&apos;t connect, check the terminal for errors.
        </div>
      )}

      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleStart}
          disabled={starting || running}
        >
          {starting ? 'Starting…' : 'Start from here'}
        </button>
      </div>
      <button type="button" className={styles.skipLink} onClick={onSkip}>
        Already running? Skip →
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 4 — Configure API Key                                          */
/* ------------------------------------------------------------------ */

interface Step4Props {
  instanceName: string
  onDone: () => void
  onGoToProviders: () => void
}

function Step4ApiKey({ instanceName, onDone, onGoToProviders }: Step4Props) {
  const [authPassing, setAuthPassing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const advancedRef = useRef(false)
  const cliCommand = `iranti add api-key openai --instance ${instanceName} --set-default`

  // Poll health every 3s for auth status
  useEffect(() => {
    pollRef.current = setInterval(() => {
      void probeHealth().then(({ authPassing: ap }) => {
        if (ap && !advancedRef.current) {
          advancedRef.current = true
          setAuthPassing(true)
          if (pollRef.current) clearInterval(pollRef.current)
        }
      })
    }, 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  return (
    <div className={styles.stepContent}>
      <h2 className={styles.stepTitle}>Configure your API key</h2>
      <p className={styles.stepBody}>
        Iranti needs a provider credential in the instance env.
        Add it from the Provider Manager, or run the equivalent CLI command for <code className={styles.inlineCode}>{instanceName}</code>:
      </p>

      <CommandBlock command={cliCommand} />

      {authPassing && (
        <div className={styles.successBanner} role="status">
          <span className={styles.successIcon} aria-hidden="true">✓</span>
          API key configured
        </div>
      )}

      <div className={styles.stepActions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onGoToProviders}
        >
          Go to Provider Manager →
        </button>
      </div>
      <button type="button" className={styles.skipLink} onClick={onDone}>
        Done — Enter Control Plane →
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Dismiss confirmation                                                 */
/* ------------------------------------------------------------------ */

interface DismissConfirmProps {
  onConfirm: () => void
  onCancel: () => void
}

function DismissConfirm({ onConfirm, onCancel }: DismissConfirmProps) {
  return (
    <div className={styles.dismissOverlay} role="dialog" aria-modal="true" aria-label="Dismiss setup wizard">
      <div className={styles.dismissCard}>
        <p className={styles.dismissMessage}>
          Dismiss setup wizard? You can reopen it from the Help menu.
        </p>
        <div className={styles.dismissActions}>
          <button type="button" className={styles.primaryButton} onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  SetupWizard — root component                                        */
/* ------------------------------------------------------------------ */

interface SetupWizardProps {
  onDismiss: () => void
}

export function SetupWizard({ onDismiss }: SetupWizardProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [completedUpTo, setCompletedUpTo] = useState(0)
  const [instanceName, setInstanceName] = useState('default')
  const [showDismissConfirm, setShowDismissConfirm] = useState(false)
  const [allDoneVisible, setAllDoneVisible] = useState(false)

  const { data: installState } = useQuery<InstallStateResult>({
    queryKey: ['install-state'],
    queryFn: fetchInstallState,
    staleTime: 5_000,
    refetchInterval: 5_000,
  })

  // Skip step 1 on first render if already installed
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current && installState !== undefined) {
      initializedRef.current = true
      if (installState.installed) {
        setStep(1)
        setCompletedUpTo(1)
      }
    }
  }, [installState])

  const handleStep1Advance = useCallback(() => {
    setCompletedUpTo(c => Math.max(c, 1))
    setStep(1)
  }, [])

  const handleStep1Skip = useCallback(() => {
    setCompletedUpTo(c => Math.max(c, 1))
    setStep(1)
  }, [])

  const handleStep2Advance = useCallback((name: string) => {
    setInstanceName(name)
    setCompletedUpTo(c => Math.max(c, 2))
    setStep(2)
  }, [])

  const handleStep2Skip = useCallback(() => {
    setCompletedUpTo(c => Math.max(c, 2))
    setStep(2)
  }, [])

  const handleStep3Advance = useCallback(() => {
    setCompletedUpTo(c => Math.max(c, 3))
    setStep(3)
  }, [])

  const handleStep3Skip = useCallback(() => {
    setCompletedUpTo(c => Math.max(c, 3))
    setStep(3)
  }, [])

  const handleDone = useCallback(() => {
    writeLocalFlag(LS_COMPLETE_KEY)
    setAllDoneVisible(true)
    setTimeout(() => {
      onDismiss()
      navigate('/overview', { replace: true })
    }, 2000)
  }, [onDismiss, navigate])

  const handleGoToProviders = useCallback(() => {
    writeLocalFlag(LS_DISMISSED_KEY)
    onDismiss()
    navigate('/providers', { replace: true })
  }, [onDismiss, navigate])

  const handleDismissRequest = useCallback(() => {
    setShowDismissConfirm(true)
  }, [])

  const handleDismissConfirm = useCallback(() => {
    writeLocalFlag(LS_DISMISSED_KEY)
    onDismiss()
  }, [onDismiss])

  const handleDismissCancel = useCallback(() => {
    setShowDismissConfirm(false)
  }, [])

  const TOTAL_STEPS = 4

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Iranti setup wizard">
      {/* Dismiss button */}
      <button
        type="button"
        className={styles.dismissButton}
        onClick={handleDismissRequest}
        aria-label="Skip setup"
      >
        Skip setup
      </button>

      {/* Wizard card */}
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.cardHeader}>
          <IrantiMark size={28} />
          <span className={styles.cardBrand}>iranti</span>
        </div>

        {/* Progress */}
        <ProgressDots total={TOTAL_STEPS} current={step} completed={completedUpTo} />

        {/* All done screen */}
        {allDoneVisible ? (
          <div className={styles.allDone} role="status">
            <span className={styles.allDoneIcon} aria-hidden="true">✓</span>
            <p className={styles.allDoneText}>You&apos;re all set!</p>
          </div>
        ) : (
          <>
            {step === 0 && (
              <Step1Install
                installState={installState}
                onAdvance={handleStep1Advance}
                onSkip={handleStep1Skip}
              />
            )}
            {step === 1 && (
              <Step2Create
                onAdvance={handleStep2Advance}
                onSkip={handleStep2Skip}
              />
            )}
            {step === 2 && (
              <Step3Start
                instanceName={instanceName}
                onAdvance={handleStep3Advance}
                onSkip={handleStep3Skip}
              />
            )}
            {step === 3 && (
              <Step4ApiKey
                instanceName={instanceName}
                onDone={handleDone}
                onGoToProviders={handleGoToProviders}
              />
            )}
          </>
        )}
      </div>

      {/* Dismiss confirmation overlay */}
      {showDismissConfirm && (
        <DismissConfirm
          onConfirm={handleDismissConfirm}
          onCancel={handleDismissCancel}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Wizard guard — decides whether wizard should show                   */
/* ------------------------------------------------------------------ */

/**
 * Reads the localStorage flags to determine whether the wizard should
 * be suppressed regardless of install state.
 * - If `iranti_setup_complete` is set: skip wizard.
 * - If `iranti_cp_setup_dismissed` is set: skip wizard UNLESS Iranti is
 *   literally not installed (that condition cannot be permanently dismissed).
 */
export function shouldShowWizard(installState: InstallStateResult | undefined): boolean {
  if (installState === undefined) return false  // still loading

  // If setup was completed: never show again (unless uninstalled)
  const isComplete = readLocalFlag(LS_COMPLETE_KEY)
  if (isComplete && installState.installed) return false

  // If dismissed: only show again if literally not installed
  const isDismissed = readLocalFlag(LS_DISMISSED_KEY)
  if (isDismissed && installState.installed) return false

  // Show if not installed
  if (!installState.installed) return true

  // If installed but wizard was never dismissed/completed, don't show
  // (install state is the primary trigger — no instance check without backend support)
  return false
}
