-- Migration: Create staff_events table
-- Spec: docs/specs/staff-event-model.md, Section 3 (Persistence Strategy, Option 1)
-- Ticket: CP-T039
-- Created: 2026-03-20 by product_manager
--
-- IMPORTANT: This table uses snake_case column names intentionally.
-- It is NOT a Prisma-managed table. Do not rename columns to camelCase.
-- The events.ts polling adapter queries this table with snake_case column references.
--
-- This migration is idempotent (IF NOT EXISTS on all statements).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS staff_events (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  staff_component TEXT NOT NULL,           -- 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
  action_type     TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  source          TEXT NOT NULL,           -- 'claude_code' | 'api' | 'mcp' | 'cli'
  entity_type     TEXT,
  entity_id       TEXT,
  key             TEXT,
  reason          TEXT,
  level           TEXT NOT NULL,           -- 'audit' | 'debug'
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_staff_events_timestamp  ON staff_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_staff_events_component  ON staff_events (staff_component);
CREATE INDEX IF NOT EXISTS idx_staff_events_agent      ON staff_events (agent_id);
CREATE INDEX IF NOT EXISTS idx_staff_events_entity     ON staff_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_staff_events_level      ON staff_events (level);

-- Verify the table was created
-- Run after applying: \d staff_events
