/**
 * Iranti Control Plane — Bind / Rebind Project Form
 * CP-T091 — Two-tab form: Bind New | Rebind Existing
 */

import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchInstanceProjects, bindProject, rebindProject, pickPath } from '../../api/client'
import type { InstanceMetadata, BoundProject, BindProjectResult } from '../../api/types'
import styles from './BindProjectForm.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface BindProjectFormProps {
  instanceName: string
  instances: InstanceMetadata[]
  onSuccess: () => void
  onCancel: () => void
}

/* ------------------------------------------------------------------ */
/*  Bind New tab                                                        */
/* ------------------------------------------------------------------ */

function BindNewTab({
  instanceName,
  onSuccess,
}: {
  instanceName: string
  onSuccess: () => void
}) {
  const [projectPath, setProjectPath] = useState('')
  const [mode, setMode] = useState<'isolated' | 'shared'>('isolated')
  const [agentId, setAgentId] = useState('main_agent')
  const [memoryEntity, setMemoryEntity] = useState('')
  const [addToGitignore, setAddToGitignore] = useState(true)

  const [pathError, setPathError] = useState<string | null>(null)
  const [pickingPath, setPickingPath] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<BindProjectResult | null>(null)

  // Auto-populate memoryEntity from projectPath basename
  useEffect(() => {
    const name = basename(projectPath)
    if (name) {
      setMemoryEntity(`project/${name}`)
    } else {
      setMemoryEntity('')
    }
  }, [projectPath])

  const validate = (): boolean => {
    if (!projectPath.trim()) {
      setPathError('Project path is required.')
      return false
    }
    setPathError(null)
    return true
  }

  const handleSubmit = useCallback(async () => {
    if (submitting || !validate()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await bindProject(instanceName, {
        projectPath: projectPath.trim(),
        mode,
        agentId: agentId.trim() || 'main_agent',
        memoryEntity: memoryEntity.trim() || `project/${basename(projectPath.trim())}`,
        addToGitignore,
      })
      setSuccessResult(result)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, projectPath, mode, agentId, memoryEntity, addToGitignore, instanceName])

  const handleBrowse = useCallback(async () => {
    if (pickingPath) return
    setPickingPath(true)
    setSubmitError(null)
    try {
      const result = await pickPath({
        kind: 'directory',
        title: 'Select project folder',
        ...(projectPath.trim() ? { startPath: projectPath.trim() } : {}),
      })
      if (result.path) {
        setProjectPath(result.path)
        setPathError(null)
      }
      if (!result.path && !result.canceled && result.error) {
        setSubmitError(result.error)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setPickingPath(false)
    }
  }, [pickingPath, projectPath])

  if (successResult) {
    return (
      <div className={styles.successScreen}>
        <span className={styles.successIcon} aria-hidden="true">✓</span>
        <h4 className={styles.successTitle}>Project wiring ready</h4>
        <div className={styles.successDetail}>
          <p className={styles.successPath}>{successResult.projectPath}</p>
          <div className={styles.envIrantiNote} role="alert">
            <span className={styles.envIrantiNoteIcon} aria-hidden="true">ℹ</span>
            <span>
              <strong>.env.iranti written to:</strong>{' '}
              <code className={styles.inlineCode}>{successResult.envIrantiPath}</code>
            </span>
          </div>
          <div className={styles.successMeta}>
            <span>Default agent: <code className={styles.inlineCode}>{successResult.agentId}</code></span>
            <span>Memory scope: <code className={styles.inlineCode}>{successResult.mode}</code></span>
            <span>Project entity: <code className={styles.inlineCode}>{successResult.memoryEntity}</code></span>
          </div>
        </div>
        <button className={styles.primaryBtn} type="button" onClick={onSuccess}>
          Done
        </button>
      </div>
    )
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.outcomeCard}>
        <div className={styles.outcomeTitle}>What this does</div>
        <p className={styles.outcomeBody}>
          Wire a repo to <code className={styles.inlineCode}>{instanceName}</code> so local tools, Claude, and Codex all point at the right Iranti instance and project memory.
        </p>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="bp-path">
          Project folder <span className={styles.required}>*</span>
        </label>
        <div className={styles.pathInputRow}>
          <input
            id="bp-path"
            className={`${styles.input} ${styles.inputMono} ${pathError ? styles.inputError : ''}`}
            type="text"
            value={projectPath}
            onChange={e => setProjectPath(e.target.value)}
            placeholder="C:\\Users\\you\\projects\\my-app"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button
            className={styles.browseBtn}
            type="button"
            onClick={() => void handleBrowse()}
            disabled={pickingPath}
          >
            {pickingPath ? 'Opening…' : 'Browse…'}
          </button>
        </div>
        {pathError && <p className={styles.fieldError}>{pathError}</p>}
        <p className={styles.fieldHint}>Choose the repo root you want this instance to serve.</p>
      </div>

      <div className={styles.fieldGroupRow}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="bp-mode">Memory scope</label>
          <select
            id="bp-mode"
            className={styles.select}
            value={mode}
            onChange={e => setMode(e.target.value as 'isolated' | 'shared')}
          >
            <option value="isolated">Private to this project</option>
            <option value="shared">Shared across bound projects</option>
          </select>
          <p className={styles.fieldHint}>Private keeps this repo in its own memory lane. Shared lets several repos work from the same project memory.</p>
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="bp-agent">Default agent</label>
          <input
            id="bp-agent"
            className={styles.input}
            type="text"
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            placeholder="main_agent"
            autoComplete="off"
          />
          <p className={styles.fieldHint}>Used when a connected tool does not send an explicit agent name.</p>
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="bp-entity">Project memory entity</label>
        <input
          id="bp-entity"
          className={`${styles.input} ${styles.inputMono}`}
          type="text"
          value={memoryEntity}
          onChange={e => setMemoryEntity(e.target.value)}
          placeholder="project/my-app"
          autoComplete="off"
          spellCheck={false}
        />
        <p className={styles.fieldHint}>Auto-filled from the folder name. Override only when this repo should write into a different project entity.</p>
      </div>

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={addToGitignore}
          onChange={e => setAddToGitignore(e.target.checked)}
          className={styles.checkbox}
        />
        <span>Keep the local binding file out of git</span>
      </label>

      {submitError && (
        <div className={styles.submitError} role="alert">
          <span aria-hidden="true">✗</span> {submitError}
        </div>
      )}

      <div className={styles.tabActions}>
        <button
          className={styles.primaryBtn}
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
        >
          {submitting ? (
            <><span className={styles.spinnerSmall} aria-hidden="true" /> Binding…</>
          ) : (
            'Wire this project'
          )}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Rebind Existing tab                                                 */
/* ------------------------------------------------------------------ */

function RebindExistingTab({
  instanceName,
  instances,
  onSuccess,
}: {
  instanceName: string
  instances: InstanceMetadata[]
  onSuccess: () => void
}) {
  const { data: projectsData, isLoading, error: fetchError } = useQuery({
    queryKey: ['instance-projects', instanceName],
    queryFn: () => fetchInstanceProjects(instanceName),
    staleTime: 30_000,
  })

  const projects: BoundProject[] = projectsData?.projects ?? []
  const otherInstances = instances.filter(i => i.name !== instanceName)

  const [selectedPath, setSelectedPath] = useState<string>('')
  const [targetInstance, setTargetInstance] = useState<string>('')
  const [newMode, setNewMode] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successPaths, setSuccessPaths] = useState<string[] | null>(null)

  // Pre-select first project when data loads
  useEffect(() => {
    if (projects.length > 0 && !selectedPath) {
      setSelectedPath(projects[0].projectPath)
    }
  }, [projects, selectedPath])

  const handleSubmit = useCallback(async () => {
    if (submitting || !selectedPath) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const params: { targetInstanceName?: string; mode?: string } = {}
      if (targetInstance) params.targetInstanceName = targetInstance
      if (newMode) params.mode = newMode
      const result = await rebindProject(instanceName, selectedPath, params)
      setSuccessPaths(result.changed)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [submitting, selectedPath, targetInstance, newMode, instanceName])

  if (successPaths !== null) {
    return (
      <div className={styles.successScreen}>
        <span className={styles.successIcon} aria-hidden="true">✓</span>
        <h4 className={styles.successTitle}>Project wiring updated</h4>
        {successPaths.length > 0 && (
          <p className={styles.successMeta}>
            Changed: {successPaths.join(', ')}
          </p>
        )}
        <button className={styles.primaryBtn} type="button" onClick={onSuccess}>
          Done
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.loadingNote}>
          <span className={styles.spinnerSmall} aria-hidden="true" />
          Loading bound projects…
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.submitError} role="alert">
          Failed to load projects: {fetchError instanceof Error ? fetchError.message : String(fetchError)}
        </div>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.emptyNote}>
          No projects are currently wired to {instanceName}.
          Use Add Project to wire one now.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.outcomeCard}>
        <div className={styles.outcomeTitle}>What this does</div>
        <p className={styles.outcomeBody}>
          Update an existing repo binding without starting over. Use this when a project should move to a new instance or switch between private and shared memory.
        </p>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="rb-project">Project</label>
        <select
          id="rb-project"
          className={`${styles.select} ${styles.selectMono}`}
          value={selectedPath}
          onChange={e => setSelectedPath(e.target.value)}
        >
          {projects.map(p => (
            <option key={p.projectPath} value={p.projectPath}>
              {p.projectPath}
            </option>
          ))}
        </select>
        <p className={styles.fieldHint}>Pick the repo whose `.env.iranti` binding you want to update.</p>
      </div>

      <div className={styles.fieldGroupRow}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="rb-target">Move to instance</label>
          <select
            id="rb-target"
            className={styles.select}
            value={targetInstance}
            onChange={e => setTargetInstance(e.target.value)}
          >
            <option value="">Keep current instance</option>
            {otherInstances.map(i => (
              <option key={i.instanceId} value={i.name}>{i.name}</option>
            ))}
          </select>
          <p className={styles.fieldHint}>Leave this alone if the repo should stay attached to the current instance.</p>
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="rb-mode">Switch memory scope</label>
          <select
            id="rb-mode"
            className={styles.select}
            value={newMode}
            onChange={e => setNewMode(e.target.value)}
          >
            <option value="">Keep current scope</option>
            <option value="isolated">Private to this project</option>
            <option value="shared">Shared across bound projects</option>
          </select>
          <p className={styles.fieldHint}>Only change this when the repo should move into or out of a shared project memory lane.</p>
        </div>
      </div>

      {submitError && (
        <div className={styles.submitError} role="alert">
          <span aria-hidden="true">✗</span> {submitError}
        </div>
      )}

      <div className={styles.tabActions}>
        <button
          className={styles.primaryBtn}
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !selectedPath}
        >
          {submitting ? (
            <><span className={styles.spinnerSmall} aria-hidden="true" /> Rebinding…</>
          ) : (
            'Apply wiring changes'
          )}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function BindProjectForm({
  instanceName,
  instances,
  onSuccess,
  onCancel,
}: BindProjectFormProps) {
  const [activeTab, setActiveTab] = useState<'bind' | 'rebind'>('bind')

  return (
    <div className={styles.formContainer}>
      <div className={styles.formHeader}>
        <span className={styles.formTitle}>Project Wiring - {instanceName}</span>
        <button
          className={styles.cancelHeaderBtn}
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>

      {/* Tab toggle */}
      <div className={styles.tabBar} role="tablist">
        <button
          className={`${styles.tab} ${activeTab === 'bind' ? styles.tabActive : ''}`}
          role="tab"
          aria-selected={activeTab === 'bind'}
          type="button"
          onClick={() => setActiveTab('bind')}
        >
          Add Project
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'rebind' ? styles.tabActive : ''}`}
          role="tab"
          aria-selected={activeTab === 'rebind'}
          type="button"
          onClick={() => setActiveTab('rebind')}
        >
          Move Existing Project
        </button>
      </div>

      {activeTab === 'bind' && (
        <BindNewTab instanceName={instanceName} onSuccess={onSuccess} />
      )}
      {activeTab === 'rebind' && (
        <RebindExistingTab
          instanceName={instanceName}
          instances={instances}
          onSuccess={onSuccess}
        />
      )}
    </div>
  )
}


