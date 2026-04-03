-- Migration: 004_create_fleet_ledger
-- Spec ref: Fleet Ledger MVP 2026-04-02
-- Creates the mirrored_staff_events and instance_ledger_watermarks tables
-- for the control-plane fleet ledger pull-mirror model.
--
-- mirrored_staff_events: CP-local copy of staff_events from all instances.
-- instance_ledger_watermarks: tracks ingestion progress and health per instance.
-- Uniqueness on (instance_id, remote_event_id) makes upserts idempotent.

CREATE TABLE IF NOT EXISTS mirrored_staff_events (
  id                BIGSERIAL PRIMARY KEY,

  -- Which Iranti instance this event came from
  instance_id       TEXT NOT NULL,

  -- Original event_id from the source instance (UUID as TEXT)
  remote_event_id   TEXT NOT NULL,

  -- When the event occurred on the source instance
  timestamp         TIMESTAMPTZ NOT NULL,

  -- Staff component that emitted the event
  staff_component   VARCHAR(32) NOT NULL,

  -- What happened within the component
  action_type       VARCHAR(64) NOT NULL,

  -- Agent that triggered the event (may be null)
  agent_id          TEXT,

  -- Raw source surface value (mcp, api, cli, etc.) — preserved as-is
  source            TEXT,

  -- Raw host value from metadata.host — preserved as-is
  host              TEXT,

  -- Session ID extracted from metadata.sessionId if present
  session_id        TEXT,

  -- Entity targeting (nullable)
  entity_type       TEXT,
  entity_id         TEXT,
  key               TEXT,
  reason            TEXT,

  -- Event level
  level             VARCHAR(16) NOT NULL DEFAULT 'audit'
    CHECK (level IN ('audit', 'debug')),

  -- Full metadata JSONB from source
  metadata          JSONB,

  -- When this CP ingested the event
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency constraint: same event from same instance cannot be inserted twice
  UNIQUE (instance_id, remote_event_id)
);

-- Index 1: Primary stream query — time-ordered across all instances
CREATE INDEX IF NOT EXISTS idx_mirrored_events_timestamp
  ON mirrored_staff_events (timestamp DESC);

-- Index 2: Per-instance time-ordered stream (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_mirrored_events_instance_timestamp
  ON mirrored_staff_events (instance_id, timestamp DESC);

-- Index 3: Filter by agent
CREATE INDEX IF NOT EXISTS idx_mirrored_events_agent
  ON mirrored_staff_events (agent_id);

-- Index 4: Filter by action type
CREATE INDEX IF NOT EXISTS idx_mirrored_events_action_type
  ON mirrored_staff_events (action_type);

-- Index 5: Filter by session
CREATE INDEX IF NOT EXISTS idx_mirrored_events_session
  ON mirrored_staff_events (session_id);

-- Index 6: Filter by host
CREATE INDEX IF NOT EXISTS idx_mirrored_events_host
  ON mirrored_staff_events (host);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS instance_ledger_watermarks (
  -- The stable instance identifier (sha256 prefix of instance dir path)
  instance_id             TEXT PRIMARY KEY,

  -- Timestamp + remote_event_id of the last successfully ingested event.
  -- Both are needed because timestamp alone is not unique across events.
  last_event_timestamp    TIMESTAMPTZ,
  last_remote_event_id    TEXT,

  -- Poll tracking
  last_polled_at          TIMESTAMPTZ,
  last_poll_succeeded     BOOLEAN NOT NULL DEFAULT true,
  last_poll_error         TEXT,
  consecutive_failures    INTEGER NOT NULL DEFAULT 0,

  -- Running count of events ingested from this instance
  total_events_ingested   BIGINT NOT NULL DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
