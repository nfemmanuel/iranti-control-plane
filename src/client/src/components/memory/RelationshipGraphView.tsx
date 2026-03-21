/* Iranti Control Plane — Relationship Graph View */
/* CP-T032 — SVG radial graph for entity relationships, no external graph library */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { RelationshipGraph, RelationshipGraphNode, RelationshipGraphEdge } from '../../api/types'
import { Spinner } from '../ui/Spinner'
import styles from './RelationshipGraphView.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface NodePosition {
  x: number
  y: number
  node: RelationshipGraphNode
}

type ViewMode = 'graph' | 'list'

/* ------------------------------------------------------------------ */
/*  Radial layout                                                       */
/*                                                                      */
/*  Root entity at center. Neighbor nodes arranged on a circle         */
/*  of radius R around it.  For depth=2, the non-root non-direct       */
/*  neighbors get pushed to an outer ring.                             */
/* ------------------------------------------------------------------ */

function computeRadialLayout(
  nodes: RelationshipGraphNode[],
  edges: RelationshipGraphEdge[],
  svgWidth: number,
  svgHeight: number
): NodePosition[] {
  const cx = svgWidth / 2
  const cy = svgHeight / 2

  const root = nodes.find(n => n.isRoot)
  if (!root) return []

  const nonRoot = nodes.filter(n => !n.isRoot)

  // Determine which nodes are directly connected to root
  const directlyConnected = new Set<string>()
  for (const e of edges) {
    const feKey = `${e.fromEntityType}::${e.fromEntityId}`
    const teKey = `${e.toEntityType}::${e.toEntityId}`
    const rootKey = `${root.entityType}::${root.entityId}`
    if (feKey === rootKey) directlyConnected.add(teKey)
    if (teKey === rootKey) directlyConnected.add(feKey)
  }

  const direct = nonRoot.filter(n => directlyConnected.has(`${n.entityType}::${n.entityId}`))
  const indirect = nonRoot.filter(n => !directlyConnected.has(`${n.entityType}::${n.entityId}`))

  const positions: NodePosition[] = []

  // Root at center
  positions.push({ x: cx, y: cy, node: root })

  // Direct neighbors on inner ring
  const innerR = Math.min(svgWidth, svgHeight) * 0.28
  if (direct.length > 0) {
    direct.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / direct.length - Math.PI / 2
      positions.push({
        x: cx + innerR * Math.cos(angle),
        y: cy + innerR * Math.sin(angle),
        node: n,
      })
    })
  }

  // Indirect neighbors (depth=2) on outer ring
  const outerR = Math.min(svgWidth, svgHeight) * 0.44
  if (indirect.length > 0) {
    indirect.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / indirect.length - Math.PI / 2
      positions.push({
        x: cx + outerR * Math.cos(angle),
        y: cy + outerR * Math.sin(angle),
        node: n,
      })
    })
  }

  return positions
}

/* ------------------------------------------------------------------ */
/*  Edge label position — midpoint with slight perpendicular offset    */
/* ------------------------------------------------------------------ */

function edgeMidpoint(x1: number, y1: number, x2: number, y2: number) {
  return { mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
}

/* ------------------------------------------------------------------ */
/*  Graph canvas                                                        */
/* ------------------------------------------------------------------ */

const NODE_R = 24       // root node radius
const NEIGHBOR_R = 20  // neighbor node radius
const SVG_W = 560
const SVG_H = 440

interface GraphCanvasProps {
  graph: RelationshipGraph
  onNodeClick: (entityType: string, entityId: string) => void
}

function GraphCanvas({ graph, onNodeClick }: GraphCanvasProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  const positions = useMemo(
    () => computeRadialLayout(graph.nodes, graph.edges, SVG_W, SVG_H),
    [graph.nodes, graph.edges]
  )

  const posMap = useMemo(() => {
    const m = new Map<string, NodePosition>()
    for (const p of positions) {
      m.set(`${p.node.entityType}::${p.node.entityId}`, p)
    }
    return m
  }, [positions])

  const hoveredNode = hoveredKey
    ? positions.find(p => `${p.node.entityType}::${p.node.entityId}` === hoveredKey)
    : null

  return (
    <div className={styles.svgWrapper} aria-label="Entity relationship graph">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className={styles.svg}
        role="img"
        aria-label={`Relationship graph for ${graph.rootEntity.entityType}/${graph.rootEntity.entityId}`}
      >
        {/* Defs — arrowhead marker */}
        <defs>
          <marker
            id="cp-graph-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="var(--color-border-strong)" />
          </marker>
        </defs>

        {/* Edges */}
        {graph.edges.map((edge, i) => {
          const fk = `${edge.fromEntityType}::${edge.fromEntityId}`
          const tk = `${edge.toEntityType}::${edge.toEntityId}`
          const fp = posMap.get(fk)
          const tp = posMap.get(tk)
          if (!fp || !tp) return null

          const { mx, my } = edgeMidpoint(fp.x, fp.y, tp.x, tp.y)

          return (
            <g key={i}>
              <line
                x1={fp.x}
                y1={fp.y}
                x2={tp.x}
                y2={tp.y}
                className={styles.edge}
                markerEnd="url(#cp-graph-arrow)"
              />
              <text
                x={mx}
                y={my}
                className={styles.edgeLabel}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {edge.relationshipType}
              </text>
            </g>
          )
        })}

        {/* Nodes */}
        {positions.map(({ x, y, node }) => {
          const nodeKey = `${node.entityType}::${node.entityId}`
          const isRoot = node.isRoot
          const r = isRoot ? NODE_R : NEIGHBOR_R
          const isHovered = hoveredKey === nodeKey

          return (
            <g
              key={nodeKey}
              className={`${styles.node} ${isRoot ? styles.nodeRoot : styles.nodeNeighbor} ${isHovered ? styles.nodeHovered : ''}`}
              transform={`translate(${x}, ${y})`}
              onClick={() => {
                if (!isRoot) onNodeClick(node.entityType, node.entityId)
              }}
              onMouseEnter={() => setHoveredKey(nodeKey)}
              onMouseLeave={() => setHoveredKey(null)}
              role={isRoot ? 'presentation' : 'button'}
              aria-label={isRoot ? undefined : `Navigate to ${node.entityType}/${node.entityId}`}
              style={{ cursor: isRoot ? 'default' : 'pointer' }}
            >
              <circle r={r} className={isRoot ? styles.circleRoot : styles.circleNeighbor} />
              {/* Entity type label (top) */}
              <text
                y={-6}
                className={styles.nodeTypeLabel}
                textAnchor="middle"
                dominantBaseline="auto"
              >
                {node.entityType.length > 12 ? node.entityType.slice(0, 10) + '…' : node.entityType}
              </text>
              {/* Entity id label (bottom) */}
              <text
                y={8}
                className={styles.nodeIdLabel}
                textAnchor="middle"
                dominantBaseline="auto"
              >
                {node.entityId.length > 12 ? node.entityId.slice(0, 10) + '…' : node.entityId}
              </text>
            </g>
          )
        })}

        {/* Tooltip for hovered node */}
        {hoveredNode && !hoveredNode.node.isRoot && (
          <g>
            <rect
              x={hoveredNode.x + 10}
              y={hoveredNode.y - 32}
              width={180}
              height={40}
              rx={4}
              className={styles.tooltip}
            />
            <text
              x={hoveredNode.x + 16}
              y={hoveredNode.y - 18}
              className={styles.tooltipText}
              dominantBaseline="middle"
            >
              {hoveredNode.node.entityType}
            </text>
            <text
              x={hoveredNode.x + 16}
              y={hoveredNode.y - 4}
              className={styles.tooltipSubText}
              dominantBaseline="middle"
            >
              {hoveredNode.node.entityId.length > 22
                ? hoveredNode.node.entityId.slice(0, 20) + '…'
                : hoveredNode.node.entityId}
              {hoveredNode.node.factCount > 0 && ` · ${hoveredNode.node.factCount} fact${hoveredNode.node.factCount !== 1 ? 's' : ''}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  List view — flat table of edges                                     */
/* ------------------------------------------------------------------ */

function EdgeListView({
  graph,
  onNodeClick,
}: {
  graph: RelationshipGraph
  onNodeClick: (entityType: string, entityId: string) => void
}) {
  const rootKey = `${graph.rootEntity.entityType}::${graph.rootEntity.entityId}`

  return (
    <div className={styles.listWrapper}>
      <table className={styles.listTable} aria-label="Relationship list">
        <thead>
          <tr>
            <th>Direction</th>
            <th>Relationship</th>
            <th>Other entity</th>
            <th>Confidence</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {graph.edges.map((edge, i) => {
            const fromKey = `${edge.fromEntityType}::${edge.fromEntityId}`
            const isFrom = fromKey === rootKey
            const otherType = isFrom ? edge.toEntityType : edge.fromEntityType
            const otherId = isFrom ? edge.toEntityId : edge.fromEntityId
            return (
              <tr key={i} className={styles.listRow}>
                <td className={styles.listCellDir}>
                  <span className={isFrom ? styles.dirFrom : styles.dirTo}>
                    {isFrom ? 'outgoing' : 'incoming'}
                  </span>
                </td>
                <td className={styles.listCellType}>{edge.relationshipType}</td>
                <td className={styles.listCellEntity}>
                  <button
                    className={styles.entityBtn}
                    onClick={() => onNodeClick(otherType, otherId)}
                    type="button"
                  >
                    <span className={styles.entityTypeText}>{otherType}</span>
                    <span className={styles.entitySep}>/</span>
                    <span className={styles.entityIdText}>{otherId}</span>
                  </button>
                </td>
                <td className={styles.listCellMeta}>
                  {edge.confidence != null ? edge.confidence : '—'}
                </td>
                <td className={styles.listCellMeta}>{edge.source ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main: RelationshipGraphView                                         */
/* ------------------------------------------------------------------ */

interface RelationshipGraphViewProps {
  entityType: string
  entityId: string
}

export function RelationshipGraphView({ entityType, entityId }: RelationshipGraphViewProps) {
  const [depth, setDepth] = useState<1 | 2>(1)
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery<RelationshipGraph, Error>({
    queryKey: ['relationship-graph', entityType, entityId, depth],
    queryFn: () =>
      apiFetch<RelationshipGraph>(
        `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/relationships/graph`,
        { depth }
      ),
    enabled: Boolean(entityType && entityId),
  })

  const handleNodeClick = (et: string, ei: string) => {
    navigate(`/memory/${encodeURIComponent(et)}/${encodeURIComponent(ei)}`)
  }

  if (isLoading) {
    return (
      <div className={styles.loadingCenter}>
        <Spinner size="md" label="Loading relationship graph" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <span className={styles.errorIcon} aria-hidden="true">⚠</span>
        <p className={styles.errorTitle}>Failed to load relationship graph</p>
        <p className={styles.errorBody}>{error.message}</p>
      </div>
    )
  }

  if (!data || data.nodes.length <= 1) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
        <p className={styles.emptyTitle}>No relationships recorded</p>
        <p className={styles.emptyBody}>
          No relationships recorded for this entity. Relationships are created when Iranti agents write
          cross-entity facts or establish provenance links.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Controls bar */}
      <div className={styles.controls}>
        {/* Depth toggle */}
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Depth</span>
          <div className={styles.depthToggle} role="group" aria-label="Graph depth">
            <button
              type="button"
              className={`${styles.depthBtn} ${depth === 1 ? styles.depthBtnActive : ''}`}
              onClick={() => setDepth(1)}
              aria-pressed={depth === 1}
            >
              1
            </button>
            <button
              type="button"
              className={`${styles.depthBtn} ${depth === 2 ? styles.depthBtnActive : ''}`}
              onClick={() => setDepth(2)}
              aria-pressed={depth === 2}
            >
              2
            </button>
          </div>
        </div>

        {/* View mode toggle */}
        <div className={styles.controlGroup}>
          <button
            type="button"
            className={`${styles.viewModeBtn} ${viewMode === 'graph' ? styles.viewModeBtnActive : ''}`}
            onClick={() => setViewMode('graph')}
            aria-pressed={viewMode === 'graph'}
            title="Graph view"
          >
            ⬡ Graph
          </button>
          <button
            type="button"
            className={`${styles.viewModeBtn} ${viewMode === 'list' ? styles.viewModeBtnActive : ''}`}
            onClick={() => setViewMode('list')}
            aria-pressed={viewMode === 'list'}
            title="List view"
          >
            ≡ List
          </button>
        </div>

        {/* Node / edge counts */}
        <div className={styles.graphStats}>
          <span className={styles.statItem}>
            <span className={styles.statCount}>{data.nodes.length}</span> nodes
          </span>
          <span className={styles.statSep} aria-hidden="true">·</span>
          <span className={styles.statItem}>
            <span className={styles.statCount}>{data.edges.length}</span> edges
          </span>
        </div>

        {/* Truncation warning */}
        {data.truncated && (
          <span className={styles.truncationWarning} role="alert">
            ⚠ Graph truncated — too many relationships at this depth
          </span>
        )}
      </div>

      {/* Canvas or list */}
      {viewMode === 'graph' ? (
        <GraphCanvas graph={data} onNodeClick={handleNodeClick} />
      ) : (
        <EdgeListView graph={data} onNodeClick={handleNodeClick} />
      )}

      {/* CP-T062 — B9 blocker note: semantic relationships via GET /kb/related are not yet available */}
      <p className={styles.semanticNote} role="note">
        This graph shows explicit relationships. Semantic relationships via vector similarity (
        <code className={styles.semanticNoteCode}>GET /kb/related</code>) are not yet available
        from the control plane — this requires MCP read tool support (B9). Check{' '}
        <a href="/health" className={styles.semanticNoteLink}>Vector Backend status</a>.
      </p>
    </div>
  )
}
