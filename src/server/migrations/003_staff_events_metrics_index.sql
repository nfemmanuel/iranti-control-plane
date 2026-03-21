-- Migration: 003_staff_events_metrics_index
-- Spec ref: CP-T060 (Metrics Dashboard — Backend)
--
-- Adds a compound index on staff_events (timestamp, agent_id, action_type) to
-- support the aggregate GROUP BY queries used by the metrics endpoints.
--
-- The existing idx_staff_events_timestamp covers time-ordered streaming (timestamp DESC).
-- This compound index covers the metrics query pattern:
--   WHERE timestamp > $period_start AND action_type = ANY($types)
--   GROUP BY DATE(timestamp), agent_id
--
-- Using BRIN would not help here because we need per-agent selectivity.
-- A B-tree compound index is appropriate for this query shape.

CREATE INDEX IF NOT EXISTS idx_staff_events_metrics
  ON staff_events (timestamp, agent_id, action_type);
