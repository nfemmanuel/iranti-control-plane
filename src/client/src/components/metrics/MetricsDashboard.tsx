/* Iranti Control Plane — Metrics Dashboard */
/* Route: /metrics */
/* CP-T060 — Summary stat cards, SVG-native KB growth line chart, */
/*           SVG-native agent activity bar chart, 7d/30d period toggle */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type {
  KbGrowthResponse,
  KbGrowthDataPoint,
  AgentActivityResponse,
  AgentActivitySeries,
  MetricsSummaryResponse,
} from '../../api/types'
import { Spinner } from '../ui/Spinner'
import styles from './MetricsDashboard.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Period = '7d' | '30d'

/* ------------------------------------------------------------------ */
/*  Agent color palette                                                 */
/*                                                                      */
/*  AgentRegistry has no color seed function — it uses no per-agent     */
/*  coloring at all. We define 5 accent slots mapped to existing        */
/*  --color-* tokens from the Terminals palette. A sixth slot covers   */
/*  the "Other" bucket (muted).                                         */
/* ------------------------------------------------------------------ */

/*
 * Agent color slots are managed via CSS class names barColor0–barColor5,
 * each mapped to an existing --color-* token in MetricsDashboard.module.css.
 * This avoids inline style hex values and respects theme switching.
 */

/* ------------------------------------------------------------------ */
/*  Date formatting helpers                                             */
/* ------------------------------------------------------------------ */

function formatDateAxis(iso: string): string {
  // "2026-03-20" → "Mar 20"
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/* ------------------------------------------------------------------ */
/*  SVG geometry helpers                                                */
/* ------------------------------------------------------------------ */

/** Map a value in [dataMin, dataMax] to a Y pixel in the SVG coordinate space. */
function toY(value: number, dataMin: number, dataMax: number, yTop: number, yBottom: number): number {
  if (dataMax === dataMin) return (yTop + yBottom) / 2
  return yBottom - ((value - dataMin) / (dataMax - dataMin)) * (yBottom - yTop)
}

/** Map an index to an X pixel across the available width. */
function toX(index: number, count: number, xLeft: number, xRight: number): number {
  if (count <= 1) return (xLeft + xRight) / 2
  return xLeft + (index / (count - 1)) * (xRight - xLeft)
}

/** Build a SVG polyline `points` string from an array of {x, y}. */
function buildPolylinePoints(pts: Array<{ x: number; y: number }>): string {
  return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

/** Nice Y-axis tick values: 4 ticks from 0 (or dataMin) to a rounded ceiling. */
function niceYTicks(dataMin: number, dataMax: number, tickCount = 4): number[] {
  const range = dataMax - dataMin
  if (range === 0) return [dataMin]
  const step = Math.ceil(range / (tickCount - 1))
  const ticks: number[] = []
  for (let i = 0; i < tickCount; i++) {
    ticks.push(dataMin + step * i)
  }
  // Ensure last tick >= dataMax
  if ((ticks[ticks.length - 1] ?? 0) < dataMax) ticks[ticks.length - 1] = dataMax
  return ticks
}

/* ------------------------------------------------------------------ */
/*  Summary stat cards (AC-8)                                           */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string
  value: string
  icon: string
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statIcon} aria-hidden="true">{icon}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function SummaryCards({ summary }: { summary: MetricsSummaryResponse }) {
  return (
    <div className={styles.statCardRow}>
      <StatCard
        label="Total KB Facts"
        value={summary.totalFacts.toLocaleString()}
        icon="▦"
      />
      <StatCard
        label="Written in last 24h"
        value={summary.factsLast24h.toLocaleString()}
        icon="⚡"
      />
      <StatCard
        label="Active agents (7d)"
        value={String(summary.activeAgentsLast7d)}
        icon="◉"
      />
      <StatCard
        label="Rejection rate (7d)"
        value={formatPercent(summary.rejectionRateLast7d)}
        icon="⚖"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Period toggle button                                                 */
/* ------------------------------------------------------------------ */

function PeriodToggle({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className={styles.periodToggle} role="group" aria-label="Select time period">
      <button
        className={`${styles.periodBtn} ${period === '7d' ? styles.periodBtnActive : ''}`}
        onClick={() => onChange('7d')}
        type="button"
        aria-pressed={period === '7d'}
      >
        7d
      </button>
      <button
        className={`${styles.periodBtn} ${period === '30d' ? styles.periodBtnActive : ''}`}
        onClick={() => onChange('30d')}
        type="button"
        aria-pressed={period === '30d'}
      >
        30d
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Empty state (AC-9)                                                  */
/* ------------------------------------------------------------------ */

function MetricsEmptyState() {
  return (
    <div className={styles.emptyState} role="status">
      <span className={styles.emptyStateIcon} aria-hidden="true">▦</span>
      <p className={styles.emptyStateTitle}>Not enough history yet</p>
      <p className={styles.emptyStateBody}>
        Metrics will appear after at least 48 hours of activity.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  KB Growth SVG line chart (AC-6)                                     */
/*                                                                      */
/*  ViewBox: 600 × 240                                                  */
/*  Margins: top=16, right=16, bottom=40, left=52                       */
/*  Two polylines: newFacts (emerald) and archivedFacts (amber)         */
/* ------------------------------------------------------------------ */

const KB_SVG_W = 600
const KB_SVG_H = 240
const KB_MARGIN = { top: 16, right: 16, bottom: 40, left: 52 }
const KB_X_LEFT  = KB_MARGIN.left
const KB_X_RIGHT = KB_SVG_W - KB_MARGIN.right
const KB_Y_TOP   = KB_MARGIN.top
const KB_Y_BOT   = KB_SVG_H - KB_MARGIN.bottom

interface KbGrowthChartProps {
  data: KbGrowthDataPoint[]
}

function KbGrowthChart({ data }: KbGrowthChartProps) {
  const newFacts     = data.map(d => d.newFacts)
  const archFacts    = data.map(d => d.archivedFacts)
  const allValues    = [...newFacts, ...archFacts]
  const dataMin      = 0
  const dataMax      = Math.max(1, ...allValues)
  const yTicks       = useMemo(() => niceYTicks(dataMin, dataMax, 4), [dataMax])
  const count        = data.length

  const newPts = data.map((d, i) => ({
    x: toX(i, count, KB_X_LEFT, KB_X_RIGHT),
    y: toY(d.newFacts, dataMin, dataMax, KB_Y_TOP, KB_Y_BOT),
  }))

  const archPts = data.map((d, i) => ({
    x: toX(i, count, KB_X_LEFT, KB_X_RIGHT),
    y: toY(d.archivedFacts, dataMin, dataMax, KB_Y_TOP, KB_Y_BOT),
  }))

  // X-axis label density: show every Nth date to avoid crowding
  const labelStep = count <= 7 ? 1 : count <= 14 ? 2 : 5

  return (
    <div className={styles.chartContainer} aria-label="KB growth line chart">
      <svg
        viewBox={`0 0 ${KB_SVG_W} ${KB_SVG_H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        className={styles.svg}
      >
        {/* Y-axis grid lines + tick labels */}
        {yTicks.map(tick => {
          const y = toY(tick, dataMin, dataMax, KB_Y_TOP, KB_Y_BOT)
          return (
            <g key={tick}>
              <line
                x1={KB_X_LEFT}
                y1={y}
                x2={KB_X_RIGHT}
                y2={y}
                className={styles.gridLine}
              />
              <text
                x={KB_X_LEFT - 6}
                y={y}
                className={styles.axisLabel}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* X-axis baseline */}
        <line
          x1={KB_X_LEFT}
          y1={KB_Y_BOT}
          x2={KB_X_RIGHT}
          y2={KB_Y_BOT}
          className={styles.axisLine}
        />

        {/* Y-axis line */}
        <line
          x1={KB_X_LEFT}
          y1={KB_Y_TOP}
          x2={KB_X_LEFT}
          y2={KB_Y_BOT}
          className={styles.axisLine}
        />

        {/* X-axis date labels */}
        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== count - 1) return null
          const x = toX(i, count, KB_X_LEFT, KB_X_RIGHT)
          return (
            <text
              key={d.date}
              x={x}
              y={KB_Y_BOT + 14}
              className={styles.axisLabel}
              textAnchor="middle"
            >
              {formatDateAxis(d.date)}
            </text>
          )
        })}

        {/* archivedFacts line (amber) — drawn first so emerald sits above */}
        <polyline
          points={buildPolylinePoints(archPts)}
          className={styles.lineArchived}
          fill="none"
        />

        {/* newFacts line (emerald) */}
        <polyline
          points={buildPolylinePoints(newPts)}
          className={styles.lineNew}
          fill="none"
        />

        {/* Data point dots — newFacts */}
        {newPts.map((pt, i) => (
          <circle
            key={`new-${i}`}
            cx={pt.x}
            cy={pt.y}
            r={3}
            className={styles.dotNew}
          >
            <title>{`${data[i]?.date ?? ''}: ${data[i]?.newFacts ?? 0} new facts`}</title>
          </circle>
        ))}

        {/* Data point dots — archivedFacts */}
        {archPts.map((pt, i) => (
          <circle
            key={`arch-${i}`}
            cx={pt.x}
            cy={pt.y}
            r={3}
            className={styles.dotArchived}
          >
            <title>{`${data[i]?.date ?? ''}: ${data[i]?.archivedFacts ?? 0} archived facts`}</title>
          </circle>
        ))}
      </svg>

      {/* Legend */}
      <div className={styles.legend} aria-label="Chart legend">
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchNew}`} aria-hidden="true" />
          New facts
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchArchived}`} aria-hidden="true" />
          Archived facts
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Agent Activity SVG bar chart (AC-7)                                 */
/*                                                                      */
/*  ViewBox: 600 × 240                                                  */
/*  Margins: top=16, right=16, bottom=48, left=52                       */
/*  Stacked bars per date. Top 5 agents by total writes; rest = Other   */
/* ------------------------------------------------------------------ */

const BAR_SVG_W = 600
const BAR_SVG_H = 240
const BAR_MARGIN = { top: 16, right: 16, bottom: 48, left: 52 }
const BAR_X_LEFT  = BAR_MARGIN.left
const BAR_X_RIGHT = BAR_SVG_W - BAR_MARGIN.right
const BAR_Y_TOP   = BAR_MARGIN.top
const BAR_Y_BOT   = BAR_SVG_H - BAR_MARGIN.bottom
const BAR_GAP_RATIO = 0.2  // 20% gap between bar groups

interface AgentActivityChartProps {
  agents: AgentActivitySeries[]
}

interface StackedBar {
  date: string
  segments: Array<{ agentLabel: string; writes: number; colorIndex: number }>
  total: number
}

function AgentActivityChart({ agents }: AgentActivityChartProps) {
  // Compute total writes per agent across all dates to find top 5
  const agentTotals: Array<{ agentId: string; total: number }> = agents.map(a => ({
    agentId: a.agentId,
    total: a.data.reduce((sum, d) => sum + d.writes, 0),
  }))
  agentTotals.sort((a, b) => b.total - a.total)

  const top5 = agentTotals.slice(0, 5).map(a => a.agentId)
  const otherAgentIds = new Set(agentTotals.slice(5).map(a => a.agentId))

  // Build a union of all dates across all agents
  const dateSet = new Set<string>()
  for (const a of agents) {
    for (const d of a.data) dateSet.add(d.date)
  }
  const dates = Array.from(dateSet).sort()

  // Build index: agentId → (date → writes)
  const agentDateMap = new Map<string, Map<string, number>>()
  for (const a of agents) {
    const dm = new Map<string, number>()
    for (const d of a.data) dm.set(d.date, d.writes)
    agentDateMap.set(a.agentId, dm)
  }

  // Build stacked bar data per date
  const bars: StackedBar[] = dates.map(date => {
    const segments: StackedBar['segments'] = []

    // Top 5 agents (each with a distinct color slot)
    for (let i = 0; i < top5.length; i++) {
      const agentId = top5[i]
      if (!agentId) continue
      const writes = agentDateMap.get(agentId)?.get(date) ?? 0
      if (writes > 0) {
        segments.push({ agentLabel: agentId, writes, colorIndex: i })
      }
    }

    // "Other" bucket
    let otherWrites = 0
    for (const agentId of otherAgentIds) {
      otherWrites += agentDateMap.get(agentId)?.get(date) ?? 0
    }
    if (otherWrites > 0) {
      segments.push({ agentLabel: 'Other', writes: otherWrites, colorIndex: 5 })
    }

    const total = segments.reduce((s, seg) => s + seg.writes, 0)
    return { date, segments, total }
  })

  const maxTotal = Math.max(1, ...bars.map(b => b.total))
  const yTicks = useMemo(() => niceYTicks(0, maxTotal, 4), [maxTotal])

  const barCount = dates.length
  const slotW = barCount > 0 ? (BAR_X_RIGHT - BAR_X_LEFT) / barCount : 0
  const barW  = slotW * (1 - BAR_GAP_RATIO)
  const barOffset = slotW * BAR_GAP_RATIO / 2

  // Legend entries: top 5 + "Other" if relevant
  const legendEntries: Array<{ label: string; colorIndex: number }> = top5.map((id, i) => ({
    label: id,
    colorIndex: i,
  }))
  if (otherAgentIds.size > 0) {
    legendEntries.push({ label: 'Other', colorIndex: 5 })
  }

  // X-axis date label density
  const labelStep = barCount <= 7 ? 1 : barCount <= 14 ? 2 : 5

  return (
    <div className={styles.chartContainer} aria-label="Agent activity bar chart">
      <svg
        viewBox={`0 0 ${BAR_SVG_W} ${BAR_SVG_H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        className={styles.svg}
      >
        {/* Y-axis grid lines + tick labels */}
        {yTicks.map(tick => {
          const y = toY(tick, 0, maxTotal, BAR_Y_TOP, BAR_Y_BOT)
          return (
            <g key={tick}>
              <line
                x1={BAR_X_LEFT}
                y1={y}
                x2={BAR_X_RIGHT}
                y2={y}
                className={styles.gridLine}
              />
              <text
                x={BAR_X_LEFT - 6}
                y={y}
                className={styles.axisLabel}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* X-axis baseline */}
        <line
          x1={BAR_X_LEFT}
          y1={BAR_Y_BOT}
          x2={BAR_X_RIGHT}
          y2={BAR_Y_BOT}
          className={styles.axisLine}
        />

        {/* Y-axis line */}
        <line
          x1={BAR_X_LEFT}
          y1={BAR_Y_TOP}
          x2={BAR_X_LEFT}
          y2={BAR_Y_BOT}
          className={styles.axisLine}
        />

        {/* X-axis date labels */}
        {dates.map((date, i) => {
          if (i % labelStep !== 0 && i !== barCount - 1) return null
          const cx = BAR_X_LEFT + i * slotW + slotW / 2
          return (
            <text
              key={date}
              x={cx}
              y={BAR_Y_BOT + 14}
              className={styles.axisLabel}
              textAnchor="middle"
            >
              {formatDateAxis(date)}
            </text>
          )
        })}

        {/* Stacked bars */}
        {bars.map((bar, i) => {
          const barX = BAR_X_LEFT + i * slotW + barOffset
          let stackBase = BAR_Y_BOT

          return (
            <g key={bar.date}>
              {bar.segments.map(seg => {
                const segH = (seg.writes / maxTotal) * (BAR_Y_BOT - BAR_Y_TOP)
                const segY = stackBase - segH
                stackBase = segY
                return (
                  <rect
                    key={seg.agentLabel}
                    x={barX}
                    y={segY}
                    width={barW}
                    height={segH}
                    className={styles[`barColor${seg.colorIndex}` as keyof typeof styles] ?? styles.barColorOther}
                    rx={1}
                  >
                    <title>{`${bar.date} — ${seg.agentLabel}: ${seg.writes} writes`}</title>
                  </rect>
                )
              })}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className={styles.legend} aria-label="Agent color legend">
        {legendEntries.map(entry => (
          <span key={entry.label} className={styles.legendItem}>
            <span
              className={`${styles.legendSwatch} ${styles[`barColor${entry.colorIndex}` as keyof typeof styles] ?? styles.barColorOther}`}
              style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, flexShrink: 0 }}
              aria-hidden="true"
            />
            <span className={styles.legendAgentId}>{entry.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  KB Growth chart section — wraps query + period toggle (AC-6)       */
/* ------------------------------------------------------------------ */

function KbGrowthSection() {
  const [period, setPeriod] = useState<Period>('30d')

  const { data, isLoading, error } = useQuery<KbGrowthResponse, Error>({
    queryKey: ['metrics', 'kb-growth', period],
    queryFn: () => apiFetch<KbGrowthResponse>('/metrics/kb-growth', { period }),
    staleTime: 5 * 60_000,
  })

  const isEmpty = data && (data.truncated || data.data.length < 2)

  return (
    <section className={styles.chartSection}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitleGroup}>
          <h2 className={styles.chartTitle}>KB Growth</h2>
          <span className={styles.chartSubtitle}>New and archived facts over time</span>
        </div>
        <PeriodToggle period={period} onChange={setPeriod} />
      </div>

      {isLoading && (
        <div className={styles.chartLoadingState}>
          <Spinner size="sm" label="Loading KB growth data" />
        </div>
      )}

      {!isLoading && error && (
        <div className={styles.chartError} role="alert">
          Failed to load KB growth data: {error.message}
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <MetricsEmptyState />
      )}

      {!isLoading && !error && data && !isEmpty && (
        <KbGrowthChart data={data.data} />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Agent Activity chart section — wraps query + period toggle (AC-7)  */
/* ------------------------------------------------------------------ */

function AgentActivitySection() {
  const [period, setPeriod] = useState<Period>('30d')

  const { data, isLoading, error } = useQuery<AgentActivityResponse, Error>({
    queryKey: ['metrics', 'agent-activity', period],
    queryFn: () => apiFetch<AgentActivityResponse>('/metrics/agent-activity', { period }),
    staleTime: 5 * 60_000,
  })

  const isEmpty = !data || data.agents.length === 0 || data.agents.every(a => a.data.length < 2)

  return (
    <section className={styles.chartSection}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitleGroup}>
          <h2 className={styles.chartTitle}>Agent Activity</h2>
          <span className={styles.chartSubtitle}>Writes per agent over time (top 5)</span>
        </div>
        <PeriodToggle period={period} onChange={setPeriod} />
      </div>

      {isLoading && (
        <div className={styles.chartLoadingState}>
          <Spinner size="sm" label="Loading agent activity data" />
        </div>
      )}

      {!isLoading && error && (
        <div className={styles.chartError} role="alert">
          Failed to load agent activity data: {error.message}
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <MetricsEmptyState />
      )}

      {!isLoading && !error && data && !isEmpty && (
        <AgentActivityChart agents={data.agents} />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                       */
/* ------------------------------------------------------------------ */

export function MetricsDashboard() {
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery<MetricsSummaryResponse, Error>({
    queryKey: ['metrics', 'summary'],
    queryFn: () => apiFetch<MetricsSummaryResponse>('/metrics/summary'),
    staleTime: 2 * 60_000,
  })

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">⊡</span>
          <div>
            <h1 className={styles.pageTitle}>Metrics</h1>
            <p className={styles.pageSubtitle}>KB growth, agent activity, and write statistics</p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className={styles.summarySection}>
        {summaryLoading && (
          <div className={styles.summaryLoading}>
            <Spinner size="sm" label="Loading summary" />
          </div>
        )}
        {summaryError && (
          <div className={styles.summaryError} role="alert">
            Summary unavailable: {summaryError.message}
          </div>
        )}
        {summary && !summaryLoading && (
          <SummaryCards summary={summary} />
        )}
      </div>

      {/* Charts */}
      <div className={styles.chartsArea}>
        <KbGrowthSection />
        <AgentActivitySection />
      </div>
    </div>
  )
}
