-- Migration: 002_create_archive_flags
-- Spec ref: CP-T049 (Archivist Decision Transparency)
--
-- Flag storage decision (OQ-1):
--   A separate `archive_flags` table was chosen over a JSONB column on the archive
--   row for the following reasons:
--
--   1. The archive table is an upstream Iranti schema — altering it with an ALTER TABLE
--      risks colliding with upstream migrations and makes the control plane's concerns
--      bleed into Iranti's core schema.
--
--   2. A relational table gives us a proper FK with CASCADE DELETE, so flags are
--      automatically cleaned up if the archive row is ever garbage-collected by Iranti.
--      The ticket risk assessment specifically called this out as a mitigation concern.
--
--   3. It is easier to query "all flagged facts" with a JOIN than to scan JSONB columns
--      across the entire archive table.
--
--   4. Flags are a control-plane-owned concept; keeping them in a control-plane-owned
--      table keeps the schema responsibility clean.

CREATE TABLE IF NOT EXISTS archive_flags (
  -- Primary key
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The archive row this flag refers to. Stored as TEXT because the archive table's
  -- id column type may vary (bigint, uuid, or other) — we store it as a string reference
  -- and do NOT add a FK constraint so we don't depend on the archive table's PK type.
  -- If a FK is desired after confirming the archive id type, add it with CASCADE DELETE.
  archive_id      TEXT NOT NULL,

  -- Operator note — why they are flagging this fact
  note            TEXT,

  -- When the flag was created
  flagged_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Which operator/agent created the flag (from session context; nullable)
  created_by      TEXT
);

-- Index: look up flags by archive_id (primary access pattern)
CREATE INDEX IF NOT EXISTS idx_archive_flags_archive_id ON archive_flags (archive_id);

-- Only one active flag per archive row (operators can edit the note by clearing and re-flagging)
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_flags_unique_per_row ON archive_flags (archive_id);
