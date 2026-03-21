# Using the Agent Registry

## What the Agent Registry Shows

The Agent Registry (`/agents`) shows every agent that has registered with the connected Iranti instance. An agent appears here after its first successful `iranti_handshake` call — that call registers the agent's profile and begins tracking its activity.

The view is read-only. It gives operators a live picture of who is writing to the knowledge base, how productive each agent is, and whether any agent shows elevated rejection or escalation rates that might indicate a problem.

---

## The Agent List

The main table shows one row per registered agent, sorted by `lastSeen` descending (most recently active first).

| Column | What it shows |
|---|---|
| **Agent ID** | The authenticated agent identity used in all writes. This is the `agentId` value passed to `iranti_handshake` and recorded on every fact the agent writes. It maps to the `createdBy` field in the knowledge base. |
| **Display Name** | The human-readable name registered at handshake time, if different from the agent ID. If no display name was registered, the agent ID is shown. |
| **Last Seen** | When this agent last made a write to the knowledge base, shown as relative time (e.g., "2 hours ago"). Hover to see the absolute ISO timestamp. |
| **Active** | A green dot means the agent has made at least one write in the last 24 hours. A grey dot means no writes in that window. This is derived from Iranti's `isActive` flag, not calculated client-side. |
| **Writes** | Total facts written by this agent across its lifetime — creates and updates combined. |
| **Rejections** | Facts the Librarian rejected, for any reason: losing a conflict, failing idempotency checks, or hitting namespace protection. Shown in red if the rejection rate is high relative to total writes. |
| **Escalations** | Conflicts escalated to the Resolutionist. Shown in amber if non-zero. |
| **Avg Confidence** | Mean confidence score across all facts this agent has written, as a percentage. |

---

## Interpreting Health Signals

The numeric columns are not just counts — they're diagnostics. Use them together.

**High rejection rate**

If `Rejections` is more than roughly 10% of `Writes`, the agent is regularly losing conflicts or writing in ways the Librarian blocks. This typically means:

- The agent is writing facts that conflict with existing higher-confidence facts from another agent.
- The agent is trying to write to a protected namespace it doesn't have access to.
- A `requestId` collision is causing idempotency rejections (duplicate writes being blocked as already resolved).

When you see a high rejection rate, open the Conflict Review view (`/conflicts`) and filter by this agent's ID to see recent escalations. Also check the Staff Activity Stream (`/activity`) filtered to `Agent ID = [agent]` and `Component = Librarian` to read the rejection reasons directly.

**Non-zero escalations**

Escalations mean the Librarian encountered ambiguous conflicts it couldn't resolve without LLM arbitration, and the LLM either returned `ESCALATE` or failed. Occasional escalations are normal for agents operating in contested fact space. A growing escalation count without corresponding resolutions suggests the Resolutionist queue is backed up — check `/conflicts` for pending items.

**Low average confidence**

An agent writing facts at consistently low confidence (below 60) isn't necessarily a problem, but it signals that the agent is uncertain about what it's writing. If the agent is a data pipeline or extraction agent, low confidence may indicate that its extraction quality has degraded. If it's a human-authored fact agent, low confidence may reflect intentional hedging.

**Inactive agent with escalations**

An agent that is `inactive` (grey dot) and has non-zero escalations should be checked. If the agent has stopped writing but left unresolved escalations, those conflicts will remain in the Resolutionist queue indefinitely. Resolve or dismiss them in `/conflicts`.

---

## Agent Detail Panel

Click any row to open the agent detail panel. It shows everything in the list view plus:

- **Description** — the agent's registered description, if provided at handshake time.
- **Capabilities** — a list of the agent's declared capabilities (e.g., `["code_review", "architecture_analysis"]`). Shown only if non-empty.
- **Model** — the AI model the agent declared at handshake (e.g., `claude-sonnet-4-6`).
- **Team Assignment** — which team this agent has been assigned to, if any. Team assignment is set via `POST /agents/:agentId/team` on the Iranti API.
- **Properties** — raw JSONB properties registered at handshake time. Shown as expandable JSON. Useful for per-agent configuration metadata.

All stats from the list view are also repeated here in full — `totalWrites`, `totalRejections`, `totalEscalations`, `avgConfidence`, `lastSeen`, `isActive`.

---

## Empty State

If no agents have registered yet, the view shows:

> No agents registered yet. Agents appear here after their first `iranti_handshake` call.

This is not an error. It means no agent has called `iranti_handshake` against this Iranti instance, or the instance is new. Once an agent calls `iranti_handshake` (via the MCP tool, SDK, or direct API call to `POST /memory/handshake`), it will appear in this list.

Note that agents must call `iranti_handshake` — writing facts alone does not register an agent in the registry.

---

## 503 State

If the agent registry is unavailable, the view shows the same 503 error state used by other views. This happens when:

- The connected Iranti instance is unreachable (the control plane cannot reach `http://localhost:3001` or your configured Iranti URL).
- The API key configured in `.env.iranti` does not have `agents:read` scope.

To diagnose, check the Health Dashboard (`/health`) first — if `DB Reachability` is failing, Iranti itself may be down. If health is green but the Agent Registry still shows 503, the issue is likely the API key scope. Confirm that the `X-Iranti-Key` value in `.env.iranti` was issued with `agents:read` included.

---

## Notes on Data Freshness

Agent stats (`totalWrites`, `totalRejections`, etc.) are accumulated by Iranti in real time as writes occur. They are not recalculated on load — the counts you see are the live running totals maintained by Iranti's internal counters.

`lastSeen` updates on every write. `isActive` is derived server-side from whether `lastSeen` falls within the last 24 hours.

The list does not auto-refresh. Reload the page to get the latest stats.
