/* Iranti Control Plane — Staff Activity Stream */
/* Route: /activity */
/* CP-T014 — Live SSE feed with filtering, pause/resume, auto-scroll */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
} from 'react'
import type { StaffEvent } from '../../api/types'
import styles from './ActivityStream.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type StaffComponent = 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
type EventLevel = 'audit' | 'debug'
type StreamMode = 'live' | 'tail'

interface StreamFilters {
  components: Set<StaffComponent>
  level: EventLevel
  agentId: string
  entityId: string
}

interface UseEventStreamOptions {
  filters: StreamFilters
  paused: boolean
  mode: StreamMode
}

interface UseEventStreamResult {
  events: StaffEvent[]
  bufferedCount: number
  bufferDropped: boolean
  connected: boolean
  reconnecting: boolean
  error: string | null
  flushBuffer: () => void
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const BACKOFF_MULTIPLIER = 2
const MAX_EVENTS_IN_DOM = 500
const MAX_PAUSE_BUFFER = 1_000

/* ------------------------------------------------------------------ */
/*  useEventStream hook                                                 */
/* ------------------------------------------------------------------ */

function useEventStream(options: UseEventStreamOptions): UseEventStreamResult {
  const { filters, paused, mode } = options

  const [events, setEvents] = useState<StaffEvent[]>([])
  const [buffer, setBuffer] = useState<StaffEvent[]>([])
  const [bufferDropped, setBufferDropped] = useState(false)
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)
  const backoffRef = useRef(INITIAL_BACKOFF_MS)
  const lastEventIdRef = useRef<string | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(paused)

  useEffect(() => { pausedRef.current = paused }, [paused])

  const buildUrl = useCallback((): string | null => {
    if (mode === 'tail') return null
    const base = '/api/control-plane/events/stream'
    const params = new URLSearchParams()
    const comps = Array.from(filters.components)
    if (comps.length > 0 && comps.length < 4) {
      params.set('staffComponent', comps.join(','))
    }
    params.set('level', filters.level)
    if (filters.agentId) params.set('agentId', filters.agentId)
    if (filters.entityId) params.set('entityId', filters.entityId)
    if (lastEventIdRef.current) params.set('since', lastEventIdRef.current)
    return `${base}?${params.toString()}`
  }, [filters, mode])

  const connect = useCallback(() => {
    if (mode === 'tail') return

    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    const url = buildUrl()
    if (!url) return

    setReconnecting(false)
    setError(null)

    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      setReconnecting(false)
      setError(null)
      backoffRef.current = INITIAL_BACKOFF_MS
    }

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as StaffEvent
        if (e.lastEventId) lastEventIdRef.current = e.lastEventId

        if (pausedRef.current) {
          setBuffer(prev => {
            if (prev.length >= MAX_PAUSE_BUFFER) {
              setBufferDropped(true)
              return [...prev.slice(1), event]
            }
            return [...prev, event]
          })
        } else {
          setEvents(prev => {
            const next = [event, ...prev]
            return next.length > MAX_EVENTS_IN_DOM ? next.slice(0, MAX_EVENTS_IN_DOM) : next
          })
        }
      } catch {
        // malformed event — skip
      }
    }

    es.addEventListener('error', (e: Event) => {
      const msgEvent = e as MessageEvent<string>
      if (msgEvent.data) {
        try {
          const errData = JSON.parse(msgEvent.data) as { error?: string }
          setError(errData.error ?? 'Stream error')
        } catch {
          setError('Stream error')
        }
      }
      es.close()
      esRef.current = null
      setConnected(false)
      setReconnecting(true)

      const delay = backoffRef.current
      backoffRef.current = Math.min(delay * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)
      reconnectTimerRef.current = setTimeout(() => {
        connect()
      }, delay)
    })
  }, [buildUrl, mode])

  // Connect when mode is live; reconnect on filter changes
  useEffect(() => {
    if (mode === 'live') {
      connect()
    }
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      setConnected(false)
      setReconnecting(false)
    }
    // Filters that trigger SSE reconnect: components and level (URL params)
    // agentId and entityId are client-side only filters — no reconnect needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.components, filters.level, mode])

  // Load tail events
  useEffect(() => {
    if (mode !== 'tail') return
    setConnected(false)
    const params = new URLSearchParams()
    params.set('limit', '500')
    params.set('level', filters.level)
    if (filters.agentId) params.set('agentId', filters.agentId)
    void fetch(`/api/control-plane/events?${params.toString()}`)
      .then(r => r.json())
      .then((data: { items?: StaffEvent[] }) => {
        setEvents((data.items ?? []).slice().reverse())
        setConnected(true)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load events'
        setError(msg)
      })
  }, [mode, filters.level, filters.agentId])

  const flushBuffer = useCallback(() => {
    setEvents(prev => {
      const combined = [...buffer, ...prev]
      return combined.length > MAX_EVENTS_IN_DOM ? combined.slice(0, MAX_EVENTS_IN_DOM) : combined
    })
    setBuffer([])
    setBufferDropped(false)
  }, [buffer])

  return {
    events,
    bufferedCount: buffer.length,
    bufferDropped,
    connected,
    reconnecting,
    error,
    flushBuffer,
  }
}

/* ------------------------------------------------------------------ */
/*  Staff component helpers                                             */
/* ------------------------------------------------------------------ */

const ALL_COMPONENTS: StaffComponent[] = ['Librarian', 'Attendant', 'Archivist', 'Resolutionist']

function getComponentColorVar(component: StaffComponent): string {
  switch (component) {
    case 'Librarian': return 'var(--color-staff-librarian)'
    case 'Attendant': return 'var(--color-staff-attendant)'
    case 'Archivist': return 'var(--color-staff-archivist)'
    case 'Resolutionist': return 'var(--color-staff-resolutionist)'
  }
}

/* ------------------------------------------------------------------ */
/*  Relative time — updates every 10s                                  */
/* ------------------------------------------------------------------ */

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function formatRelative(isoTimestamp: string, now: number): string {
  const diff = now - new Date(isoTimestamp).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(isoTimestamp).toLocaleTimeString()
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/* ------------------------------------------------------------------ */
/*  Filter state                                                        */
/* ------------------------------------------------------------------ */

type FilterAction =
  | { type: 'TOGGLE_COMPONENT'; component: StaffComponent }
  | { type: 'SET_LEVEL'; level: EventLevel }
  | { type: 'SET_AGENT_ID'; value: string }
  | { type: 'SET_ENTITY_ID'; value: string }
  | { type: 'RESET' }

function filterReducer(state: StreamFilters, action: FilterAction): StreamFilters {
  switch (action.type) {
    case 'TOGGLE_COMPONENT': {
      const next = new Set(state.components)
      if (next.has(action.component)) {
        next.delete(action.component)
      } else {
        next.add(action.component)
      }
      return { ...state, components: next }
    }
    case 'SET_LEVEL': return { ...state, level: action.level }
    case 'SET_AGENT_ID': return { ...state, agentId: action.value }
    case 'SET_ENTITY_ID': return { ...state, entityId: action.value }
    case 'RESET': return {
      components: new Set(ALL_COMPONENTS),
      level: 'audit',
      agentId: '',
      entityId: '',
    }
    default: return state
  }
}

const defaultFilters: StreamFilters = {
  components: new Set(ALL_COMPONENTS),
  level: 'audit',
  agentId: '',
  entityId: '',
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ComponentBadge({ component }: { component: StaffComponent }) {
  return (
    <span
      className={styles.componentBadge}
      style={{ color: getComponentColorVar(component) }}
    >
      {component.toUpperCase()}
    </span>
  )
}

function EventRow({
  event,
  now,
}: {
  event: StaffEvent
  now: number
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className={styles.eventRow}
        onClick={() => setExpanded(e => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v) }}
        aria-expanded={expanded}
      >
        <td className={styles.cellTime} title={event.timestamp}>
          {formatTimestamp(event.timestamp)}
        </td>
        <td className={styles.cellComponent}>
          <ComponentBadge component={event.staffComponent} />
        </td>
        <td className={styles.cellAction}>
          <span className={styles.actionType}>{event.actionType}</span>
        </td>
        <td className={styles.cellEntity}>
          {event.entityType && event.entityId ? (
            <span className={styles.entityKey}>
              {event.entityType}/{event.entityId}
              {event.key && <span className={styles.entityKeyName}> · {event.key}</span>}
            </span>
          ) : '—'}
        </td>
        <td className={styles.cellAgent}>{event.agentId}</td>
        <td className={styles.cellRelTime}>{formatRelative(event.timestamp, now)}</td>
        <td className={styles.cellReason}>{event.reason ?? ''}</td>
      </tr>
      {expanded && (
        <tr className={styles.eventRowExpanded}>
          <td colSpan={7} className={styles.expandedTd}>
            <div className={styles.expandedContent}>
              <div className={styles.expandedGrid}>
                <div className={styles.expandedField}>
                  <span className={styles.expandedLabel}>Event ID</span>
                  <span className={styles.expandedMono}>{event.eventId}</span>
                </div>
                <div className={styles.expandedField}>
                  <span className={styles.expandedLabel}>Level</span>
                  <span className={styles.expandedValue}>{event.level}</span>
                </div>
                <div className={styles.expandedField}>
                  <span className={styles.expandedLabel}>Source</span>
                  <span className={styles.expandedValue}>{event.source}</span>
                </div>
                <div className={styles.expandedField}>
                  <span className={styles.expandedLabel}>Timestamp</span>
                  <span className={styles.expandedValue}>{event.timestamp}</span>
                </div>
              </div>
              {event.metadata && (
                <div className={styles.expandedMeta}>
                  <span className={styles.expandedLabel}>Metadata</span>
                  <pre className={styles.expandedPre}>{JSON.stringify(event.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function ActivityStream() {
  const [filters, dispatch] = useReducer(filterReducer, defaultFilters)
  const [paused, setPaused] = useState(false)
  const [mode, setMode] = useState<StreamMode>('live')
  const listRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [newEventsBelowCount, setNewEventsBelowCount] = useState(0)
  const now = useNow(10_000)

  const { events, bufferedCount, bufferDropped, connected, reconnecting, error, flushBuffer } = useEventStream({
    filters,
    paused,
    mode,
  })

  // Client-side filter: agentId and entityId (local, no SSE reconnect)
  const visibleEvents = events.filter(e => {
    if (filters.agentId && !e.agentId.toLowerCase().includes(filters.agentId.toLowerCase())) return false
    if (filters.entityId) {
      const target = filters.entityId.toLowerCase()
      const matches = (e.entityId ?? '').toLowerCase().includes(target) ||
        (e.entityType ?? '').toLowerCase().includes(target)
      if (!matches) return false
    }
    if (!filters.components.has(e.staffComponent)) return false
    return true
  })

  // Auto-scroll tracking
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    isAtBottomRef.current = atBottom
    if (atBottom) setNewEventsBelowCount(0)
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (isAtBottomRef.current) {
      el.scrollTop = 0
      setNewEventsBelowCount(0)
    } else {
      setNewEventsBelowCount(v => v + 1)
    }
  }, [events.length])

  const scrollToTop = () => {
    if (listRef.current) listRef.current.scrollTop = 0
    setNewEventsBelowCount(0)
    isAtBottomRef.current = true
  }

  const handleResume = () => {
    flushBuffer()
    setPaused(false)
  }

  return (
    <div className={styles.page}>
      {/* Phase 1 limitation notice */}
      <div className={styles.limitationBanner}>
        <span className={styles.limitationIcon}>ℹ</span>
        Attendant and Resolutionist events will appear after the Phase 2 native emitter upgrade.
        Phase 1 emits Librarian writes and Archivist archival events only.
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Component:</span>
          {ALL_COMPONENTS.map(c => (
            <label key={c} className={styles.componentToggle}>
              <input
                type="checkbox"
                checked={filters.components.has(c)}
                onChange={() => dispatch({ type: 'TOGGLE_COMPONENT', component: c })}
                className={styles.filterCheckbox}
              />
              <span style={{ color: getComponentColorVar(c) }}>{c}</span>
            </label>
          ))}

          <span className={styles.filterSep} />
          <span className={styles.filterLabel}>Level:</span>
          {(['audit', 'debug'] as EventLevel[]).map(lv => (
            <button
              key={lv}
              className={`${styles.levelBtn} ${filters.level === lv ? styles.levelBtnActive : ''}`}
              onClick={() => dispatch({ type: 'SET_LEVEL', level: lv })}
              type="button"
            >
              {lv}
            </button>
          ))}

          <span className={styles.filterSep} />
          <span className={styles.filterLabel}>Mode:</span>
          {(['live', 'tail'] as StreamMode[]).map(m => (
            <button
              key={m}
              className={`${styles.levelBtn} ${mode === m ? styles.levelBtnActive : ''}`}
              onClick={() => setMode(m)}
              type="button"
            >
              {m === 'live' ? 'Live' : 'Tail (last 500)'}
            </button>
          ))}

          {mode === 'live' && (
            <>
              <span className={styles.filterSep} />
              <button
                className={`${styles.pauseBtn} ${paused ? styles.pauseBtnActive : ''}`}
                onClick={() => {
                  if (paused) handleResume()
                  else setPaused(true)
                }}
                type="button"
              >
                {paused
                  ? `Resume${bufferedCount > 0 ? ` (${bufferedCount} new)` : ''}`
                  : 'Pause'}
              </button>
            </>
          )}
        </div>

        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Agent:</span>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Filter by agent ID"
            value={filters.agentId}
            onChange={e => dispatch({ type: 'SET_AGENT_ID', value: e.target.value })}
            aria-label="Filter by agent ID"
          />
          <span className={styles.filterLabel}>Entity:</span>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Filter by entity type or ID"
            value={filters.entityId}
            onChange={e => dispatch({ type: 'SET_ENTITY_ID', value: e.target.value })}
            aria-label="Filter by entity ID"
          />
          <button
            className={styles.resetBtn}
            onClick={() => dispatch({ type: 'RESET' })}
            type="button"
          >
            Reset filters
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className={styles.statusBar}>
        {mode === 'live' && (
          <>
            {reconnecting && (
              <span className={styles.statusReconnecting}>
                <span className={styles.spinner} aria-hidden="true" />
                Reconnecting…
              </span>
            )}
            {!reconnecting && connected && (
              <span className={styles.statusConnected}>
                <span className={styles.connDot} />
                Live
              </span>
            )}
            {!reconnecting && !connected && !error && (
              <span className={styles.statusConnecting}>Connecting…</span>
            )}
          </>
        )}
        {mode === 'tail' && connected && (
          <span className={styles.statusTail}>Tail — {visibleEvents.length} events loaded</span>
        )}
        {error && (
          <span className={styles.statusError}>
            Connection error: {error}
            <button
              className={styles.reconnectBtn}
              onClick={() => window.location.reload()}
              type="button"
            >
              Reconnect
            </button>
          </span>
        )}
        <span className={styles.statusCount}>{visibleEvents.length} events</span>
      </div>

      {/* Paused buffer banner */}
      {paused && bufferedCount > 0 && (
        <div className={styles.pausedBanner}>
          <span>
            Paused — {bufferedCount} new event{bufferedCount !== 1 ? 's' : ''} buffered
            {bufferDropped && ' (some early events dropped — buffer limit reached)'}
          </span>
          <button className={styles.resumeInlineBtn} onClick={handleResume} type="button">
            Resume
          </button>
        </div>
      )}

      {/* Event list */}
      <div
        className={styles.eventList}
        ref={listRef}
        onScroll={handleScroll}
      >
        {visibleEvents.length === 0 && !reconnecting && !error && (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">◈</span>
            <p className={styles.emptyTitle}>No Staff events yet</p>
            <p className={styles.emptyBody}>
              Start an agent session to see activity here.
              {!filters.components.has('Librarian') && !filters.components.has('Archivist') &&
                ' All Phase 1 components are hidden — enable Librarian or Archivist in the filter.'}
            </p>
          </div>
        )}

        {visibleEvents.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Component</th>
                <th>Action</th>
                <th>Entity / Key</th>
                <th>Agent</th>
                <th>When</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map(event => (
                <EventRow key={event.eventId} event={event} now={now} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Jump-to-new button */}
      {newEventsBelowCount > 0 && !paused && (
        <button className={styles.jumpToNewBtn} onClick={scrollToTop} type="button">
          ↑ {newEventsBelowCount} new event{newEventsBelowCount !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
