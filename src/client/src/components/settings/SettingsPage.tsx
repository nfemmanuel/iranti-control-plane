import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { stopControlPlane, uninstallControlPlane } from '../../api/client'
import { ConfirmationModal } from '../ui/ConfirmationModal'
import { useSettings } from '../../hooks/useSettings'
import {
  clearSetupGuideFlags,
  DEFAULT_SETTINGS,
  type CommandRunnerMode,
  type ControlPlaneSettings,
  type LandingPage,
  type PollIntervalMs,
} from '../../lib/settings'
import styles from './SettingsPage.module.css'

const LANDING_OPTIONS: Array<{ value: LandingPage; label: string; detail: string }> = [
  { value: '/overview', label: 'Overview', detail: 'Open the operator dashboard first.' },
  { value: '/instances', label: 'Instances', detail: 'Jump straight into runtime and project control.' },
  { value: '/health', label: 'Health', detail: 'Start with diagnostics and runtime status.' },
  { value: '/providers', label: 'Providers', detail: 'Open credential and model routing controls first.' },
  { value: '/getting-started', label: 'Getting Started', detail: 'Bias toward onboarding and repair guidance.' },
  { value: '/sessions', label: 'Sessions', detail: 'Open live session recovery and inspection first.' },
]

const POLL_OPTIONS: Array<{ value: PollIntervalMs; label: string }> = [
  { value: 30000, label: 'Every 30 seconds' },
  { value: 60000, label: 'Every 60 seconds' },
  { value: 300000, label: 'Every 5 minutes' },
]

const RUNNER_OPTIONS: Array<{ value: CommandRunnerMode; label: string; detail: string }> = [
  { value: 'copy_and_run', label: 'Copy + Run', detail: 'Show both Copy and Run when the command is allowlisted.' },
  { value: 'copy_only', label: 'Copy only', detail: 'Hide Run buttons and force terminal execution.' },
]

const PROVIDER_OPTIONS = ['claude', 'openai', 'gemini', 'groq', 'mistral', 'ollama', 'mock'] as const

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <p className={styles.sectionDescription}>{description}</p>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {hint && <span className={styles.fieldHint}>{hint}</span>}
      {children}
    </label>
  )
}

export function SettingsPage() {
  const { settings, replaceSettings } = useSettings()
  const [draft, setDraft] = useState<ControlPlaneSettings>(settings)
  const [savedState, setSavedState] = useState<'idle' | 'saved'>('idle')
  const [controlPlaneAction, setControlPlaneAction] = useState<{
    phase: 'idle' | 'working' | 'done' | 'error'
    action: 'stop' | 'uninstall' | null
    message: string
  }>({ phase: 'idle', action: null, message: '' })
  const [confirmPending, setConfirmPending] = useState<'stop' | 'uninstall' | null>(null)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    if (savedState !== 'saved') return
    const id = setTimeout(() => setSavedState('idle'), 1800)
    return () => clearTimeout(id)
  }, [savedState])

  const hasChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings])

  const updateDraft = <K extends keyof ControlPlaneSettings>(key: K, value: ControlPlaneSettings[K]) => {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const updateCreateDefaults = <K extends keyof ControlPlaneSettings['createInstanceDefaults']>(
    key: K,
    value: ControlPlaneSettings['createInstanceDefaults'][K],
  ) => {
    setDraft(current => ({
      ...current,
      createInstanceDefaults: {
        ...current.createInstanceDefaults,
        [key]: value,
      },
    }))
  }

  const handleSave = () => {
    replaceSettings(draft)
    setSavedState('saved')
  }

  const handleResetDefaults = () => {
    setDraft(DEFAULT_SETTINGS)
  }

  const handleResetSetupGuide = () => {
    clearSetupGuideFlags()
    setSavedState('saved')
  }

  const handleStopControlPlane = async () => {
    setConfirmPending(null)
    setControlPlaneAction({
      phase: 'working',
      action: 'stop',
      message: 'Stopping Control Plane. This page will stop responding once the shutdown lands.',
    })
    try {
      const result = await stopControlPlane()
      setControlPlaneAction({ phase: 'done', action: 'stop', message: result.message })
    } catch (error) {
      setControlPlaneAction({
        phase: 'error',
        action: 'stop',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleUninstallControlPlane = async () => {
    setConfirmPending(null)
    setControlPlaneAction({
      phase: 'working',
      action: 'uninstall',
      message: 'Starting Control Plane uninstall. The app will shut down before npm removes the package.',
    })
    try {
      const result = await uninstallControlPlane()
      setControlPlaneAction({ phase: 'done', action: 'uninstall', message: result.message })
    } catch (error) {
      setControlPlaneAction({
        phase: 'error',
        action: 'uninstall',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.heroTitle}>Control Plane Settings</h1>
          <p className={styles.heroBody}>
            This page controls how the control plane behaves on this machine. Existing instances are not rewritten here.
            These defaults shape the shell, command surfaces, and new-instance creation flow.
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            className={styles.secondaryBtn}
            type="button"
            onClick={handleResetDefaults}
          >
            Reset Draft To Defaults
          </button>
          <button
            className={styles.primaryBtn}
            type="button"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            {savedState === 'saved' ? 'Saved' : 'Save Settings'}
          </button>
        </div>
      </div>

      <Section
        title="Shell Experience"
        description="What you see first, how often the shell polls health, and whether embedded chat opens by default."
      >
        <div className={styles.gridTwo}>
          <Field label="Theme" hint="Applied immediately after you save.">
            <select
              className={styles.select}
              value={draft.theme}
              onChange={e => updateDraft('theme', e.target.value === 'light' ? 'light' : 'dark')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>

          <Field label="Default landing page" hint="Used when you open /control-plane or click the logo-root route.">
            <select
              className={styles.select}
              value={draft.landingPage}
              onChange={e => updateDraft('landingPage', e.target.value as LandingPage)}
            >
              {LANDING_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className={styles.inlineDetail}>
              {LANDING_OPTIONS.find(option => option.value === draft.landingPage)?.detail}
            </span>
          </Field>

          <Field label="Health poll interval" hint="Controls shell-level API and health transition polling.">
            <select
              className={styles.select}
              value={String(draft.healthPollIntervalMs)}
              onChange={e => updateDraft('healthPollIntervalMs', Number.parseInt(e.target.value, 10) as PollIntervalMs)}
            >
              {POLL_OPTIONS.map(option => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Open embedded chat by default" hint="This becomes the startup state for the shell chat panel.">
            <button
              className={`${styles.toggleBtn} ${draft.chatPanelOpen ? styles.toggleBtnOn : ''}`}
              type="button"
              onClick={() => updateDraft('chatPanelOpen', !draft.chatPanelOpen)}
            >
              {draft.chatPanelOpen ? 'Open on launch' : 'Closed on launch'}
            </button>
          </Field>
        </div>
      </Section>

      <Section
        title="Operator Actions"
        description="How remediation commands behave and what guidance stays visible in the shell."
      >
        <div className={styles.gridTwo}>
          <Field label="Command action mode" hint="Affects Copy/Run cards across Health, Doctor, Getting Started, and instance remediation flows.">
            <select
              className={styles.select}
              value={draft.commandRunnerMode}
              onChange={e => updateDraft('commandRunnerMode', e.target.value as CommandRunnerMode)}
            >
              {RUNNER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className={styles.inlineDetail}>
              {RUNNER_OPTIONS.find(option => option.value === draft.commandRunnerMode)?.detail}
            </span>
          </Field>

          <Field label="Show setup banner" hint="Keeps the shell-level incomplete-setup banner visible until the system is configured.">
            <button
              className={`${styles.toggleBtn} ${draft.showSetupBanner ? styles.toggleBtnOn : ''}`}
              type="button"
              onClick={() => updateDraft('showSetupBanner', !draft.showSetupBanner)}
            >
              {draft.showSetupBanner ? 'Banner enabled' : 'Banner hidden'}
            </button>
          </Field>
        </div>

        <div className={styles.actionStrip}>
          <button className={styles.secondaryBtn} type="button" onClick={handleResetSetupGuide}>
            Reset Setup Guide State
          </button>
          <Link className={styles.inlineLink} to="/getting-started">
            Open Getting Started
          </Link>
        </div>
      </Section>

      <Section
        title="Control Plane Lifecycle"
        description="Manage the control plane itself from inside the product when you are done with this session or want to remove the package."
      >
        <div className={styles.lifecycleRow}>
          <div className={styles.lifecycleCard}>
            <h3 className={styles.lifecycleTitle}>Stop Control Plane</h3>
            <p className={styles.lifecycleBody}>
              Gracefully shut down the current control-plane server. Use this when you want to stop the dashboard without opening a terminal.
            </p>
            <button
              className={styles.secondaryBtn}
              type="button"
              onClick={() => setConfirmPending('stop')}
              disabled={controlPlaneAction.phase === 'working'}
            >
              {controlPlaneAction.phase === 'working' && controlPlaneAction.action === 'stop' ? 'Stopping…' : 'Stop Control Plane'}
            </button>
          </div>

          <div className={styles.lifecycleCard}>
            <h3 className={styles.lifecycleTitle}>Uninstall Package</h3>
            <p className={styles.lifecycleBody}>
              Stop the current control plane, then launch <code>npm uninstall -g iranti-control-plane</code> in the background.
            </p>
            <button
              className={styles.secondaryBtn}
              type="button"
              onClick={() => setConfirmPending('uninstall')}
              disabled={controlPlaneAction.phase === 'working'}
            >
              {controlPlaneAction.phase === 'working' && controlPlaneAction.action === 'uninstall' ? 'Uninstalling…' : 'Uninstall Control Plane'}
            </button>
          </div>
        </div>

        {controlPlaneAction.phase !== 'idle' && (
          <div className={`${styles.lifecycleNotice} ${controlPlaneAction.phase === 'error' ? styles.lifecycleNoticeError : ''}`}>
            {controlPlaneAction.message}
          </div>
        )}

        {confirmPending === 'stop' && (
          <ConfirmationModal
            title="Stop Control Plane?"
            description="The dashboard will become unavailable. Restart from a terminal to bring it back."
            warning="Any in-progress operations will be interrupted."
            confirmLabel="Stop Control Plane"
            onConfirm={handleStopControlPlane}
            onCancel={() => setConfirmPending(null)}
          />
        )}

        {confirmPending === 'uninstall' && (
          <ConfirmationModal
            title="Uninstall Control Plane?"
            description="The dashboard will shut down and the iranti-control-plane package will be removed from npm."
            warning="This cannot be undone without reinstalling the package."
            confirmLabel="Uninstall"
            onConfirm={handleUninstallControlPlane}
            onCancel={() => setConfirmPending(null)}
          />
        )}
      </Section>

      <Section
        title="New Instance Defaults"
        description="These values prefill the Create Instance flow. They do not modify existing instances."
      >
        <div className={styles.gridTwo}>
          <Field label="First suggested port" hint="The create flow will search upward from here for the next free port.">
            <input
              className={styles.input}
              type="number"
              min={1024}
              max={65535}
              value={draft.createInstanceDefaults.startPort}
              onChange={e => updateCreateDefaults('startPort', Number.parseInt(e.target.value, 10) || DEFAULT_SETTINGS.createInstanceDefaults.startPort)}
            />
          </Field>

          <Field label="Default provider" hint="Used as the initial provider selection in Create Instance.">
            <select
              className={styles.select}
              value={draft.createInstanceDefaults.provider}
              onChange={e => updateCreateDefaults('provider', e.target.value)}
            >
              {PROVIDER_OPTIONS.map(provider => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </Field>

          <Field label="Database entry mode" hint="Choose whether Create Instance starts with a composed URL or raw URL input.">
            <select
              className={styles.select}
              value={draft.createInstanceDefaults.databaseMode}
              onChange={e => updateCreateDefaults('databaseMode', e.target.value === 'url' ? 'url' : 'compose')}
            >
              <option value="compose">Build from parts</option>
              <option value="url">Paste full URL</option>
            </select>
          </Field>

          <Field label="Database host">
            <input
              className={styles.input}
              type="text"
              value={draft.createInstanceDefaults.dbHost}
              onChange={e => updateCreateDefaults('dbHost', e.target.value)}
            />
          </Field>

          <Field label="Database port">
            <input
              className={styles.input}
              type="text"
              value={draft.createInstanceDefaults.dbPort}
              onChange={e => updateCreateDefaults('dbPort', e.target.value)}
            />
          </Field>

          <Field label="Database user">
            <input
              className={styles.input}
              type="text"
              value={draft.createInstanceDefaults.dbUser}
              onChange={e => updateCreateDefaults('dbUser', e.target.value)}
            />
          </Field>

          <Field label="Database name prefix" hint="Applied before the sanitized instance slug.">
            <input
              className={styles.input}
              type="text"
              value={draft.createInstanceDefaults.dbNamePrefix}
              onChange={e => updateCreateDefaults('dbNamePrefix', e.target.value)}
            />
            <span className={styles.inlineDetail}>
              Example: <code>{`${draft.createInstanceDefaults.dbNamePrefix || 'iranti_'}example_project`}</code>
            </span>
          </Field>
        </div>
      </Section>
    </div>
  )
}
