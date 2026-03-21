# The Health Dashboard

## What the Health Dashboard Shows

The Health Dashboard (`/health`) runs a set of checks against your local Iranti setup and displays the results in a structured card layout. Each check reports one of four severity levels:

| Severity | Meaning |
|---|---|
| **Healthy** (green) | The check passed with no issues. |
| **Informational** (grey) | A status note — no action required, but worth knowing. |
| **Warning** (amber) | Something is misconfigured or degraded, but the system can still run. |
| **Critical** (red) | The check failed and likely blocks one or more core functions. |

The overall status line at the top summarizes the worst severity seen across all checks: **Healthy**, **Degraded** (at least one warning), or **Error** (at least one critical failure).

---

## Core Health Checks

| Check | What it means |
|---|---|
| **DB Reachability** | Can the control plane connect to PostgreSQL? If this is critical, nothing else works. |
| **DB Schema Version** | Is the database schema up to date? A warning here means you may be running a newer version of the control plane against an older Iranti schema. |
| **Anthropic Key** | Is `ANTHROPIC_API_KEY` present in `.env.iranti`? Warning if missing — Iranti will fail writes that require LLM calls. |
| **OpenAI Key** | Same check for `OPENAI_API_KEY`. |
| **Default Provider** | Is `IRANTI_DEFAULT_PROVIDER` set? If not, Iranti uses a built-in fallback. |
| **MCP Integration** | Does your project have a `.mcp.json` with an Iranti server entry? |
| **CLAUDE.md Integration** | Does your project have a `CLAUDE.md` that references Iranti? |
| **Runtime Version** | What version of Iranti is running. |
| **Staff Events Table** | Does the `staff_events` table exist? If warning, run `npm run migrate`. |

---

## Memory Decay Card

The Memory Decay card shows the configuration of Iranti's Archivist decay policy. Decay is an Ebbinghaus-style mechanism that lowers a fact's effective confidence over time based on access frequency and time elapsed since last access. Facts that fall below the decay threshold are automatically archived.

### Fields

| Field | What it means |
|---|---|
| **Enabled** | Whether decay is active. **Amber** means enabled — this is an intentional amber: decay being active is a notable operator state. **Green** means disabled. A tooltip or label clarifies the color direction so it isn't confused with a warning. |
| **Stability base** | How many days a fact can go without access before the first decay cycle begins. Set by `IRANTI_DECAY_STABILITY_BASE`. Default is 30 days. |
| **Stability range** | The base-to-max window, shown as "N–N days". The max is set by `IRANTI_DECAY_STABILITY_MAX` (default 365 days). Facts accessed regularly accrue stability and decay more slowly; facts left untouched decay faster. |
| **Decay threshold** | The confidence floor. When a fact's decayed confidence drops below this value, the Archivist archives it. Set by `IRANTI_DECAY_THRESHOLD`. Default is 10. |

### If decay is disabled

The card shows: "Memory decay is disabled. Facts are archived only by expiry, low confidence (< 30), or Resolutionist resolution."

### When to enable decay

Enable decay for long-lived Iranti instances where the knowledge base accumulates facts over weeks or months and you want stale, rarely-accessed information to be cleaned up automatically. Decay is most useful when:

- The KB spans multiple projects or topics and accumulates facts across many agent sessions.
- You want the KB to self-prune — facts that haven't been accessed or updated in a long time likely aren't load-bearing anymore.

### When NOT to enable decay

Do not enable decay if:

- The instance is short-lived (per-session or per-task). Decay won't have time to run meaningfully, and it adds noise to Health checks.
- You're debugging write or conflict behavior. Decay archiving will remove facts you may need to inspect.
- The KB is the source of truth for shared memory across agents and you cannot afford to lose a fact because it wasn't recently read. Shared cross-agent memory should be actively refreshed, not decayed.

If `IRANTI_DECAY_ENABLED` is not set in the environment, decay defaults to disabled and the card degrades gracefully — it will not error.

---

## Vector Backend Card

The Vector Backend card shows which vector backend Iranti is using for semantic search and whether it's reachable.

Iranti uses the vector backend to populate the embedding column on each fact. The `iranti_search` tool (and `GET /kb/search`) performs hybrid search: lexical matching plus semantic similarity. If the vector backend is inactive or misconfigured, semantic search returns degraded or zero results — lexical matching still works, but similarity-based retrieval does not.

### Backend options

| Backend | How it works |
|---|---|
| **pgvector** | Uses the pgvector extension on your primary PostgreSQL database. No separate service needed. The existing DB reachability check covers this — if the DB is reachable and the pgvector extension is installed, this backend is healthy. |
| **qdrant** | Separate Qdrant service. The control plane probes the configured `IRANTI_QDRANT_URL` to check reachability. |
| **chroma** | Separate Chroma service. The control plane probes `IRANTI_CHROMA_URL`. |
| **unknown** | `IRANTI_VECTOR_BACKEND` is not set in the environment. Iranti defaults to pgvector in this case. |

### Status indicators

| Status | What it means |
|---|---|
| **ok** | The backend is configured and reachable. |
| **warn** | The backend type is set to qdrant or chroma but the URL is not configured (`IRANTI_QDRANT_URL` / `IRANTI_CHROMA_URL` is missing). The probe is not attempted. |
| **error** | The qdrant or chroma service URL is configured but the service is not responding. |

For `pgvector`, the card shows "Uses primary database connection" — no separate reachability probe is performed.

### "Vector search inactive"

If the card reports that vector search is inactive, the embedding column is not being populated. Semantic similarity queries (`iranti_search`) will return zero or degraded results.

**To fix (pgvector):** Confirm the pgvector extension is installed in your PostgreSQL database:

```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

If it's missing, install it:

```sql
CREATE EXTENSION vector;
```

Then restart Iranti so it re-initializes the embedding pipeline.

**To fix (qdrant or chroma):** Confirm the service is running at the URL configured in `IRANTI_QDRANT_URL` or `IRANTI_CHROMA_URL`. A quick check:

```bash
curl http://localhost:6333/health   # qdrant default
curl http://localhost:8000/api/v1   # chroma default
```

If the service is down, start it. If the URL is wrong, correct it in your `.env.iranti` and restart Iranti.

### Hybrid search fallback (Iranti v0.2.13+)

Iranti v0.2.13 added a fallback to in-process semantic scoring when pgvector is unavailable. If this applies to your setup, the card notes: "pgvector unavailable — Iranti is falling back to in-process semantic scoring (v0.2.13+). Search quality may be reduced." This is informational severity — the system is working, but at reduced search quality.

---

## Attendant Status Card

The Attendant card is informational. It does not perform a live health probe — the Iranti `/health` endpoint does not expose Attendant stats, so a definitive health check is not currently possible.

**What the Attendant does:** The Attendant manages per-agent working memory. It handles session start (`iranti_handshake`), context retrieval (`iranti_observe`), per-turn injection decisions (`iranti_attend`), and session resumption (`iranti_reconvene`). It runs one instance per agent.

**Known limitation:** The automatic injection classifier used by `iranti_attend` (when called without `forceInject: true`) has a known parse failure in the current Iranti release. The classifier returns `classification_parse_failed_default_false`, which causes the Attendant to skip injection. This means automatic context injection does not work reliably without `forceInject`.

**Workaround:** Call `iranti_attend` with `forceInject: true` in all agents that depend on per-turn memory injection:

```json
{
  "agent": "your_agent_id",
  "currentContext": "...",
  "forceInject": true
}
```

This bypasses the classifier and always injects the working memory brief before the turn. This is the recommended approach until the upstream fix (CP-T025) ships.

The card surfaces this limitation so operators know the status, not as a warning requiring action — the system is operational with the workaround in place.
