# Control Plane Review Notes — 2026-03-22

## Purpose
These notes capture operator-review findings, semantic mismatches, and product observations gathered during live review of the Iranti Control Plane.

This file exists as a durable handoff artifact in case agent context is lost or memory is compacted.

## Review Context
- Repo: `C:\Users\NF\Documents\Projects\iranti-control-plane`
- Live Iranti runtime:
  - root: `C:\Users\NF\.iranti-runtime`
  - instance: `local`
  - API: `http://localhost:3001`
- Review mode:
  - page-by-page operator review
  - truthfulness and operator-semantics focus
  - do not treat control-plane-local heuristics as runtime truth

## Core Semantic Rules Reconfirmed
- `.env.iranti` is a project binding pointer, not authoritative runtime config.
- `IRANTI_INSTANCE_ENV` is the authoritative instance-level config path.
- The Iranti CLI and live runtime are the oracle for system semantics.
- Integration/setup status should not be allowed to degrade overall runtime health unless they actually impair the active operator workflow.
- Internal ticket references, PR chatter, and control-plane implementation notes should not dominate operator-facing health surfaces.

## Recent Health/Diagnostics Corrections Already Landed
These were observed as part of the health-truthfulness cleanup work.

### Before -> After semantic fixes
1. Runtime version
- Before: showed control-plane package version (`0.1.0`) as if it were the Iranti runtime version.
- After: probes and displays live Iranti runtime version (`v0.2.21`).

2. Default provider
- Before: surfaced as not configured even while the live instance was configured for OpenAI.
- After: reflects the real active provider state (`openai`).

3. Anthropic key warning
- Before: missing Anthropic key elevated as a warning even though Anthropic was not the active provider.
- After: treated as non-problematic when Anthropic is not the active provider.

4. Attendant status
- Before: static internal note referencing `CP-T025`, PR state, and engineering chatter.
- After: live probe-driven warning based on actual behavior (classifier parse failure / injection reliability caveat).

5. Staff events table messaging
- Before: internal ticket/migration phrasing like `CP-T001 migration not applied`.
- After: plain-language remediation without ticket chatter.

6. Invalid command guidance
- Before: remediation text referenced `iranti migrate`, which is not a real operator command.
- After:
  - control-plane-local migration hints point to `npm run migrate` where appropriate
  - runtime/db schema checks point to `iranti doctor --instance local`

7. Authority-model leakage in remediation copy
- Before: API key and DB remediation copy pointed users at `.env.iranti`.
- After:
  - DB remediation points to instance-level surfaces
  - provider key remediation points to `iranti add api-key <provider> --instance local`

8. Overall health severity
- Before: optional integration/setup checks like MCP / `CLAUDE.md` could degrade the whole system to warning.
- After: overall health is computed from runtime checks only; setup/integration checks are downgraded out of top-level degradation.

### Remaining health-adjacent cleanup noted but not handled in that slice
- `ActivityStream.tsx` and `ArchiveExplorer.tsx` still contain `CP-T025` tooltip references.
- Some remediation text API-key hints were noted as still low-priority follow-up work during the slice, though core authority-model leakage was corrected.
- Need to ensure all remaining operator-facing copy avoids Unix-only process-management advice on Windows.

## Review Notes — Home / Overview Page

### Screenshot reviewed
- Overview page with:
  - `System Status`
  - `Knowledge Base`
  - `Recent Activity`
  - `Active Agents`
  - quick actions

### Findings
1. System status interaction mismatch
- The individual health items/chips visually read like separate links or drill-down targets.
- In practice they behave as one large link to Health & Diagnostics.
- This is misleading affordance design.
- The visual grammar promises per-check interactivity that does not exist.

2. Knowledge Base appears empty
- The widget showed:
  - total facts: `0`
  - last 24 hours: `0`
  - active this week: `0`
- This is almost certainly semantically wrong or at least misleading.
- Given the live environment, there should already be:
  - seeded Staff Namespace facts
  - system-level facts
  - project / benchmark / agent facts in at least some categories
- The most likely explanations are:
  - metric source is wrong
  - scope is narrower than the label implies
  - widget is driven by activity/event-stream data rather than actual KB truth rows
  - card is reading a control-plane-local metric source rather than the Iranti knowledge base

3. KB card mixes knowledge-base truth with activity-stream readiness
- The text under the card implied activity/migration requirements.
- That confuses two separate concepts:
  - whether the KB contains facts
  - whether the control plane has activity metrics enabled
- If the issue is event/activity data, the card should not make the KB itself look empty.

4. Recent Activity empty state is likely over-reporting absence
- The empty state suggested no recent Staff activity and referred to migration/event-stream enablement.
- This likely means:
  - the control plane lacks its own event-stream data
  - not that the underlying Iranti system has done nothing
- The page currently risks telling the operator “nothing exists” when the truth is “this control-plane-local stream is not populated.”

5. Active Agents also appears empty
- “No agents seen recently” may be technically true under a narrow definition.
- It may still be misleading if:
  - agents exist in Iranti memory
  - agent activity is present elsewhere
  - the card is really measuring recent control-plane-observed activity, not actual known agents

6. Overall homepage tone exaggerates emptiness
- Taken together, the page tells a strong story of:
  - empty KB
  - no activity
  - no active agents
- That appears to understate the actual state of the system.
- The result is a homepage that feels emptier than the real product.

### Main conclusion for Home
- The homepage is currently likely more misleading than empty.
- The most important issue is metric/source semantics, not mere presentation.
- Cross-page consistency is a major issue because Home implies absence while Memory later shows substantial data.

## Review Notes — Memory Explorer

### Screenshots reviewed
- Memory Explorer entity-type overview
- `researcher` entity-type detail table with expanded row details

### Findings
1. Memory page contradicts Home page
- Memory Explorer clearly shows a populated KB:
  - multiple entity types
  - substantial fact counts
  - recent updates
- This directly contradicts the Home page’s “0 total facts” story.
- This is a serious cross-page semantic mismatch.

2. Memory Explorer is comparatively truthful
- The entity-type cards make the KB feel real and populated.
- This page makes it much easier to understand that Iranti actually contains data.
- Compared to Home, this page is far closer to the system’s likely truth.

3. Entity-type overview is useful but under-explained
- Entity types shown included:
  - `researcher`
  - `project`
  - `agent`
  - `system`
  - `codebase`
  - `benchmark`
  - `roadmap`
  - `ticket`
  - `__diagnostics__`
- A new operator is unlikely to understand:
  - what these categories represent
  - which are user-domain facts
  - which are benchmark artifacts
  - which are control-plane/internal facts
- `__diagnostics__` in particular looks like internal leakage rather than a polished product concept.

4. Detailed table is powerful but expert-oriented
- The `researcher` table shows:
  - entity
  - key
  - summary
  - confidence
  - source
  - written by
  - valid-from
  - update timing
- This is good for power users and engineers.
- It is not especially guided for operators who are trying to answer practical questions quickly.

5. Expanded row detail is one of the strongest surfaces in the product
- The expanded row shows:
  - entity
  - key
  - value
  - confidence
  - stability
  - last accessed
  - provenance/source
  - valid-from
  - valid-until
- This is where the Iranti data model becomes understandable.
- The detail pane is a strong candidate for what operator-facing truthfulness should look like.

6. Atomic fact model becomes visible, but not well contextualized
- The table exposes multiple overlapping atomic facts such as:
  - `primary_research_area`
  - `secondary_research_area`
  - `research_focus`
  - `education`
  - `degree`
  - `degree_institution`
- For an experienced Iranti reader, this is sensible atomic decomposition.
- For an operator, it can look like duplication or clutter.
- The page does not currently explain whether overlapping facts are:
  - intentional atomic structure
  - alternative summaries
  - source variations
  - possible conflict surfaces

7. Provenance labels are accurate but not legible
- Labels like:
  - `B6_closeout_trial2`
  - `B6_closeout_baseline`
- are meaningful in benchmarking context, but not operator-friendly.
- Provenance is important; label readability still needs work.

8. Filters are powerful but not guided
- Present filters include:
  - text search
  - entity type
  - entity ID
  - key
  - source
  - written by
  - min confidence
  - active only
- Capability is strong.
- Guidance is weak.
- The page does not explain what kinds of questions these filters are best suited to answer.

### Main conclusion for Memory
- Memory Explorer is currently one of the more truthful and useful pages.
- It is still:
  - expert-heavy
  - under-explained
  - somewhat leaky with internal categories
- Biggest strategic takeaway:
  - this page strongly suggests the Home page metrics are wrong or misleading.

## Review Notes — Archive

### Screenshots reviewed
- Archive list page
- blank page after clicking an archive item

### Findings
1. Archive page has a visible missing-relation dependency
- Banner text:
  - `Unable to load flagged facts: relation "archive_flags" does not exist`
- This means the page is partially wired to a control-plane-local schema/table that is not present.
- That is not necessarily an Iranti runtime problem.
- But it is being surfaced directly on the page as a broken dependency.

2. Page still renders archive rows despite the flags failure
- The archive list itself is populated.
- So the failure is partial, not total.
- This suggests the page currently combines:
  - core archive browsing
  - extra flag/review overlay functionality
- and the overlay dependency is missing.

3. Clicking any archive row leads to a blank page
- This is a more severe issue than the missing `archive_flags` relation.
- It means the primary drill-down behavior for archive inspection is broken.
- From an operator perspective, that makes the page non-functional for actual review, even though the list loads.

4. Blank detail page is likely a route/render failure, not an empty-state
- The screenshot shows a blank page at `/control-plane/archive`.
- That suggests one of:
  - item click is navigating to a route that fails to render
  - details panel/router state is broken
  - an exception is occurring without visible error handling
- This is not a cosmetic issue.
- It blocks the operator from understanding archived facts beyond the table row.

5. Archive content currently looks noisy and somewhat internal
- Rows shown include:
  - `__diagnostics__/probe`
  - roadmap phase status entries
  - benchmark/diagnostic artifacts
- This may be technically accurate, but again mixes:
  - real archive semantics
  - internal/control-plane diagnostics
  - benchmarking closeout artifacts
- The result is a page that feels more like an implementation exhaust view than a clean operator archive browser.

6. Archived reason text is truncated and not very interpretable
- `Superseded by ne...`
- likely means “superseded by newer value” or similar
- but the operator cannot actually inspect the detail because click-through is broken
- so the truncation becomes more damaging than it otherwise would be

7. Flag/review model is not clearly explained
- The top section is labeled `FLAGGED FOR REVIEW`
- but because `archive_flags` is missing, the operator has no clear idea:
  - what is flaggable
  - what flags mean
  - whether this is core product behavior or control-plane-local review metadata
- This is currently more confusing than helpful.

8. The page mixes two states:
- archive browsing appears partly available
- review/flag workflow is broken
- row/detail navigation is broken
- the user is not given a clear distinction between:
  - what still works
  - what is unavailable

### Main conclusion for Archive
- Archive is currently not trustworthy as a usable review surface.
- The page loads enough to suggest capability, but the broken click-through and missing `archive_flags` relation make it operationally incomplete.
- Severity is higher than Home-page truthfulness issues because this is direct broken behavior, not just misleading summary logic.

### Priority interpretation
- Broken archive detail navigation should be treated as a real functional defect.
- The missing `archive_flags` relation may be:
  - a missing control-plane migration
  - an optional feature wired as if mandatory
- but it is secondary to the row-click blank-page failure.

### Questions to validate later
1. Is `archive_flags` intended to be a required control-plane-local table?
2. If optional, why is the page treating its absence as a prominent review failure?
3. What exact route/state transition happens when a row is clicked?
4. Should diagnostic rows like `__diagnostics__/probe` be visible in the main operator archive view?
5. Is the Archive page intended for:
- operator review of real contested/superseded knowledge
- internal debugging of archive state
- both

### Cross-page implication
- Memory Explorer currently feels more usable than Archive.
- Archive appears to expose more broken or unfinished secondary features than operator-ready review workflows.

## Review Notes — Activity / Staff Activity

### Screenshot reviewed
- Staff Activity page with:
  - banner describing Phase 1 / Phase 2 coverage
  - component filters
  - level filters
  - mode `Live`
  - `Reconnecting...`
  - `0 events`

### Findings
1. Internal roadmap/phase language is visible again
- The banner says:
  - `Phase 1 event coverage`
  - `Attendant — Phase 2 (pending CP-T025)`
  - `Resolutionist — Phase 2 (pending CP-T025)`
  - `Full Staff observability ships in Phase 2`
- This is internal roadmap/ticket language, not operator-facing explanation.
- It leaks implementation planning directly into the product.
- This is the same class of problem previously removed from Health surfaces.

2. The page appears “Live” but is not actually convincingly live
- Status/mode indicates:
  - `LIVE`
  - `Mode: Live`
  - tailing events
- But the content area shows:
  - `No activity`
  - `Reconnecting...`
  - `0 events`
- That makes the page feel broken or disconnected rather than simply quiet.

3. “Reconnecting...” with no further context undermines trust
- If the stream is unavailable, the page should say whether:
  - the event stream is not configured
  - the server-sent event/websocket connection failed
  - there is truly no recent activity
- “Reconnecting...” alone reads like a transport failure, not a meaningful empty state.

4. Component toggles are over-promising relative to current capability
- The page lets the operator filter:
  - Librarian
  - Attendant
  - Archivist
  - Resolutionist
- But the banner simultaneously says some of those are only partially covered or pending Phase 2 work.
- This means the UI is presenting filters for streams that may not truly exist yet.
- That mismatch increases confusion.

5. The page lacks operator framing
- An operator needs to know:
  - what activity can be seen right now
  - what cannot yet be observed
  - whether the system is idle or the stream is unhealthy
- Right now the page mostly exposes implementation state rather than operational meaning.

6. This is another example of internal project management leaking into the product
- `pending CP-T025`
- `ships in Phase 2`
- these are team-internal coordination phrases
- they should not be first-order UI content for operators

7. Cross-page consistency problem continues
- Home says little/no recent activity.
- Activity page says live stream, but also reconnecting, but also no activity, but also partial coverage.
- The product still lacks a consistent story about whether:
  - there is no activity
  - activity exists but is not observable here
  - the activity stream itself is degraded

### Main conclusion for Activity
- The page currently feels like an unfinished internal observability console, not a trustworthy operator activity surface.
- The biggest problem is not aesthetics.
- It is semantic incoherence:
  - internal roadmap status in the UI
  - ambiguous live/reconnecting/no-activity state
  - component filters that may exceed actual implemented observability

### Questions to validate later
1. Is the underlying live stream actually broken, or simply idle?
2. What observable event coverage truly exists right now per Staff component?
3. Should this page surface partial-coverage information at all, or should unsupported streams simply not be presented yet?
4. Is `Reconnecting...` a transient frontend state, or a persistent transport bug?
5. What operator action is this page supposed to support:
- debugging live system behavior
- reviewing recent actions
- triaging failures
- all of the above

### Priority interpretation
- This is not as severe as Archive’s blank-page defect.
- But it is a substantial product-trust problem.
- The page currently reads like internal implementation status exposed directly to the user.

## Review Notes — Logs / Staff Logs

### Screenshot and operator evidence reviewed
- Staff Logs page
- manual `npm run migrate` attempt from repo root

### Operator evidence
Running the remediation command shown by the UI:

```powershell
npm run migrate
```

Result:
- root script enters `src/server`
- then tries to import `./migrations/runner.js`
- Node throws `ERR_MODULE_NOT_FOUND`
- missing file:
  - `C:\Users\NF\Documents\Projects\iranti-control-plane\src\server\migrations\runner.js`

So the current remediation guidance shown in the Logs page is not just awkward; it is broken in this environment.

### Findings
1. The page is blocked on a missing `staff_events` table
- Empty state says:
  - `Staff events table not found`
  - `Run npm run migrate to create the staff_events table`
- This is a hard dependency on a control-plane-local table, not a live Iranti runtime capability.

2. The suggested remediation command currently fails
- This is more severe than the Activity page’s internal roadmap chatter.
- The UI is actively instructing the operator to run a command that errors with `ERR_MODULE_NOT_FOUND`.
- That turns a missing feature into a trust-breaking remediation failure.

3. Logs page currently has zero operator value
- Filters exist for:
  - component
  - level
  - severity
  - event type
  - agent id
  - date range
  - export format
- but none of this matters because the underlying log source is absent and the recovery path is broken
- so the page is effectively a dead surface right now

4. This appears to be a control-plane-local logging/event-stream subsystem, not core Iranti logs
- The page should make that distinction clearer.
- Right now it is presented as “Staff Logs,” which sounds like a trustworthy product surface.
- In reality it appears to depend on a local CP table/migration path that is not operational.

5. Cross-page consistency issue with Activity
- Activity page also suggests partial event observability and reconnecting state.
- Logs page confirms the underlying `staff_events` support is not actually available here.
- That means the product is currently exposing multiple observability pages whose underlying data source is not properly installed or not properly recoverable.

6. Severity is higher because remediation is broken
- For Health and Activity, there were truthfulness problems.
- For Logs, there is a direct functional/operator problem:
  - missing table
  - broken migration command

### Main conclusion for Logs
- Logs is currently non-functional as an operator surface.
- The failure is not just lack of data; it is the combination of:
  - missing `staff_events` table
  - broken `npm run migrate` remediation path
- This should be treated as a real functional defect, not a low-priority polish issue.

### Questions to validate later
1. Is `staff_events` supposed to be a required control-plane-local table for Phase 2?
2. Why does the migration script reference a missing `runner.js`?
3. Is the intended migration path:
- build-first then run migration
- TypeScript-source execution
- bundled dist execution
- something else
4. Should Logs and Activity be hidden, disabled, or clearly marked unavailable until the backing event stream is truly operational?

### Priority interpretation
- This is one of the stronger operator-trust failures seen so far.
- Unlike Home’s misleading emptiness, this is an explicit broken remediation path.

## Review Notes — Instances

### Screenshot reviewed
- `/control-plane/instances` route renders as a blank page

### Findings
1. Instances route is blank
- No visible shell/content/error/empty-state is rendered.
- This is not a weak-information issue; it is a broken route or broken render.

2. Severity is high because Instances should be a core operator surface
- The control plane’s stated mission includes instance management.
- A blank Instances page means one of the most central operator workflows is currently inaccessible from the UI.

3. This reinforces a broader routing/render stability problem
- Archive detail click led to a blank page.
- Instances is also blank.
- This suggests the product may have multiple route-level failures rather than one isolated broken screen.

4. No operator fallback is offered
- There is no empty state, no inline error, no diagnostics, no guidance.
- The route simply appears dead.
- That is especially damaging on a core management page.

### Main conclusion for Instances
- This is a direct functional defect.
- It should be treated as a core route/render failure, not a polish issue.

### Cross-page implication
- There is now a pattern of non-trivial navigation targets resolving to blank pages.
- The problem is no longer just semantic inconsistency or internal chatter.
- Some routes are simply failing to render in a recoverable way.

## Review Notes — Health & Diagnostics

### Screenshots reviewed
- Health page summary cards
- Diagnostics table after running probes

### Findings
1. Health page is much better than earlier versions, but it is still not fully stable in meaning
- It now reflects more live truth than before:
  - live Iranti version (`v0.2.21`)
  - default provider `openai`
  - OpenAI key present
  - Anthropic not active, therefore not treated as a real problem
- That is good progress.

2. The top-level summary and the diagnostics section still tell slightly different stories
- Top status says:
  - `Operational`
- Diagnostics summary says:
  - `2 warnings — system functional but degraded`
- That is not necessarily wrong, but the relationship between those two states is not obvious.
- An operator can reasonably ask:
  - is the system healthy
  - or degraded
  - or both

3. Staff Events Table card is still awkwardly placed in top-level health
- It is now labeled `INFO`, which is better.
- But it still occupies prominent space in the main health grid.
- Since it is a control-plane-local feature rather than core Iranti runtime health, its prominence may still be too high.

4. `npm run migrate` guidance remains suspicious because the operator has already shown that command currently fails
- The card says:
  - run `npm run migrate` from the control-plane directory
- But the operator evidence from the Logs page review shows that command currently fails with `ERR_MODULE_NOT_FOUND`.
- So even if the semantic intent is now better, the remediation path is still not trustworthy in practice.

5. MCP Integration and `CLAUDE.md` are marked `HEALTHY`
- This is better than when such setup items could degrade the overall system.
- But these still read more like setup/integration checks than true runtime health signals.
- They may be useful, but they are not in the same conceptual category as:
  - database connection
  - schema version
  - vector backend
  - provider auth

6. The Attendant warning is more truthful, but still somewhat product-internal
- Current message:
  - classifier parse failure
  - memory injection may be unreliable
  - use `forceInject: true` in `iranti_attend`
- This is substantially better than ticket/PR chatter.
- But it still assumes a technically sophisticated operator.
- For a normal operator, it is not obvious:
  - when this matters
  - what it breaks
  - whether the system is broadly okay

7. Vector Search warning needs interpretation help
- It says:
  - `vectorScore=0`
  - in-process fallback may be active
- This is meaningful for an engineer.
- For an operator, it does not clearly answer:
  - is search broken
  - is search slower
  - is search lower quality
  - should I act now or ignore it

8. Diagnostics table is one of the more useful surfaces so far
- It is concrete.
- It is probe-based.
- It distinguishes passes and warnings cleanly.
- Compared to Home, this section feels grounded.

9. But the overall severity model still needs refinement
- If the system is truly operational, then warnings should clearly mean:
  - degraded but usable
  - informational but non-blocking
  - setup-related only
- Right now the page still requires interpretation rather than providing it.

### Main conclusion for Health
- Health is no longer obviously misleading the way Home was.
- It is one of the stronger pages now.
- But it still has two unresolved trust problems:
  1. top-level operational vs diagnostics degraded wording is not fully reconciled
  2. `npm run migrate` remains shown as remediation even though operator evidence says it currently fails

### Cross-page implication
- Health is better than Home, Activity, Logs, and Archive.
- But it is still entangled with control-plane-local subsystems (`staff_events`) whose remediation path is not actually working.
- The page is closer to trustworthy than many others, but not fully settled.

## Review Notes — Metrics

### Screenshot reviewed
- Metrics page showing:
  - total KB facts: `0`
  - written in last 24h: `0`
  - active agents (7d): `0`
  - rejection rate (7d): `0.0%`
  - charts saying `Not enough history yet`

### Findings
1. Metrics appears empty in a way that is probably not literally true
- Given Memory Explorer shows populated KB content, `TOTAL KB FACTS = 0` is highly suspicious.
- This is likely the same semantic/source problem observed on the Home page.
- The most likely possibilities are:
  - metrics are reading a different source than Memory Explorer
  - metrics only count control-plane-local analytics history
  - metrics require a separate aggregation/event pipeline that is currently not active
  - labels are too broad for what is actually being measured

2. “Not enough history yet” may be partly true for charting, but does not explain zero totals
- It is plausible that time-series graphs need 48 hours of accumulated history.
- It is not plausible that the underlying KB literally has zero facts if Memory Explorer is accurate.
- So the charts may be missing history, but the top summary cards still look semantically wrong.

3. The page does not distinguish between:
- lack of historical metrics
- lack of data in the underlying system
- lack of metric-pipeline population
- That makes the empty state hard to trust.

4. `Active agents (7d) = 0` may be measuring a narrow concept
- This may be technically true if no tracked recent-agent metric stream is populated.
- But without clarification, it again contributes to the false impression that the system has no activity.

5. Rejection rate is especially hard to interpret
- `0.0%` could mean:
  - no rejections occurred
  - no data exists
  - no measurement exists
- The page currently gives no help distinguishing those possibilities.

6. Cross-page contradiction remains strong
- Home says KB empty.
- Memory says populated.
- Metrics also says KB empty.
- So the issue is likely not Memory over-reporting; it is more likely that Home/Metrics are driven by a different or broken metric source.

### Main conclusion for Metrics
- Metrics does not currently feel trustworthy as a representation of actual system state.
- It may be accurately representing “metrics history not populated,” but it is labeled in a way that reads as “system has no facts or activity.”
- This is primarily a semantic/source problem, not just a visual empty state.

### Questions to validate later
1. What is `TOTAL KB FACTS` actually counting?
2. Is the page reading:
- the Iranti knowledge base directly
- an aggregated metrics table
- event-stream-derived rollups
- a control-plane-local analytics cache
3. Which cards should show real-time truth vs “history available”?
4. Should summary cards degrade to `unknown` / `metrics unavailable` instead of hard-zero when the pipeline is not populated?

### Cross-page implication
- Metrics reinforces the conclusion that the product currently has multiple summary surfaces that under-report the real system state.

## Review Notes — Conflicts / Conflict Review

### Screenshots reviewed
- `Pending` tab with empty-state message
- `Resolved` tab with empty-state message

### Findings
1. No obvious semantic breakage from the screenshots alone
- `Pending` says:
  - `No pending conflicts`
  - `The Resolutionist has nothing to review. All facts are consistent.`
- `Resolved` says:
  - `No resolved escalations`
  - `Resolved escalations will appear here.`
- This may be true.
- Nothing in the screenshots alone proves the page is lying the way Home or Metrics likely are.

2. But the empty-state layout is inconsistent between tabs
- One empty state appears positioned nearer the top portion of the content area.
- The other appears more centered vertically in the page.
- That inconsistency makes the page feel less intentional and slightly unfinished.

3. Pending copy is stronger than Resolved copy
- `All facts are consistent` is a broad claim.
- Depending on how conflicts/escalations are tracked, this might be stronger than what the UI can truly know.
- It may only mean:
  - no pending escalation items exist
- rather than:
  - the whole system has no unresolved logical inconsistency

4. Resolved tab is more cautious and therefore better phrased
- `Resolved escalations will appear here` is narrower and safer.
- Pending tab may be over-speaking compared to that.

5. The page is visually sparse but not obviously broken
- Unlike Archive or Instances, it does render.
- Unlike Activity, it does not leak internal roadmap chatter.
- This feels more like a UX/wording consistency issue than a hard functional failure.

### Main conclusion for Conflicts
- Conflicts is comparatively calm and not obviously broken from the screenshots provided.
- The main issues are:
  - inconsistent empty-state placement
  - pending-tab wording may be slightly stronger than warranted

### Questions to validate later
1. Does “no pending conflicts” actually mean no pending escalation files / archive rows, or is the page using a broader notion?
2. Are there any known archived/escalated conflict rows that should have appeared here?
3. Should the two tabs use a consistent empty-state layout and positioning?

### Priority interpretation
- Lower severity than Archive, Logs, Instances, Home, or Metrics.
- More of a polish/semantic-precision issue unless later evidence shows conflicts actually exist and are missing.

## Review Notes — Providers / Provider Manager

### Screenshot reviewed
- Provider Manager page showing:
  - default provider
  - fallback chain
  - task routing table
  - provider cards and provider detail

### Direct answer to operator questions
1. Yes, the task text is visibly cut off.
- The task names are readable:
  - Classification
  - Relevance Filtering
  - Conflict Resolution
  - Summarization
  - Task Inference
  - Extraction
- But the explanatory text beneath them is truncated/faded off and not fully legible from the screenshot.
- So the UI is trying to provide rationale, but the content is not actually readable enough to help the operator.

2. From this page alone, it is not obvious how an operator knows task routing actually works.
- The page suggests task overrides can be configured.
- It also says changes take effect after restart.
- But the UI does not obviously show:
  - whether the chosen override was actually persisted
  - whether the running Iranti instance has been restarted since the change
  - whether a real task execution used the selected override
  - any runtime readback that proves the router is now using that model

### Findings
1. Provider Manager is one of the more substantial/operator-relevant pages
- It surfaces real operator jobs:
  - choose default provider
  - manage fallback chain
  - inspect provider connection state
  - set per-task model overrides
- This is one of the more product-central surfaces.

2. Task routing explanation is cut off
- The secondary description under each task is partially hidden/truncated.
- That weakens the operator’s ability to understand:
  - what the task type means
  - why a heavier or lighter model might be appropriate
- The page visually implies explanatory help, but does not fully deliver it.

3. Runtime-effect visibility is weak
- The page shows configuration controls.
- It does not clearly show proof of effective runtime behavior.
- For example, it is unclear whether the operator can answer:
  - “Did my override save?”
  - “Has the instance restarted since this change?”
  - “Which model was actually used for the last classification/conflict task?”

4. Restart requirement is stated, but not operationally closed
- The banner says settings take effect after restarting the Iranti instance.
- That is good.
- But the page does not appear to help close that loop.
- There is no visible confirmation like:
  - pending restart
  - last restart time after config change
  - running config vs saved config

5. The page mixes different concepts in one surface
- instance-level configuration:
  - default provider
  - fallback chain
  - task routing
- provider-level operational state:
  - key present
  - connected / not configured
- provider-detail extras:
  - API key scope
  - balance & quota
- This is not inherently wrong, but it increases the burden on layout clarity.

6. Provider cards are semantically improved compared to earlier health surfaces
- OpenAI is clearly shown as default and connected.
- Anthropic is shown as not configured without implying it is an operational failure.
- That is a good direction.

7. Balance/quota area looks incomplete or speculative
- It says live balance requires `org:read` scope and suggests checking dashboard directly.
- It also says threshold will apply when live balance is supported.
- This makes the balance/quota section feel partially implemented or placeholder-like.
- Not necessarily wrong, but it does make the detail panel feel less complete.

8. Scope text is confusing in the context of provider keys
- “Scopes restrict which agent or project namespaces this key services”
- That sounds more like Iranti client-key semantics than upstream provider-key semantics.
- If this is referring to control-plane/Iranti usage scoping, it needs especially clear explanation.
- Otherwise operators may confuse:
  - provider API key behavior
  - Iranti client API key behavior

### Main conclusion for Providers
- Provider Manager looks more substantial than many other pages and appears closer to a real operator tool.
- But one core trust question remains unresolved:
  - configuration is visible, but effective runtime use is not clearly proven from the UI.
- The page needs a stronger answer to:
  - “How do I know this setting actually took effect?”

### Questions to validate later
1. Are task descriptions intentionally truncated, or is this a layout issue?
2. After changing task routing and restarting, is there any runtime readback proving the router used the new model?
3. Should the page distinguish:
- saved config
- running config
- last observed model usage
4. Is the provider-key “scope” wording semantically correct for this panel, or is it borrowing the wrong mental model?
5. Should incomplete balance/quota support be present here yet?

### Priority interpretation
- This page is more promising than Home, Activity, Logs, Archive, or Instances.
- The main issue is not that it looks broken.
- The main issue is trust closure:
  - can the operator verify that the settings they changed are actually in effect?

### Provider Manager — expected functionality checklist
This is the explicit checklist Claude should later verify against. The goal is not just “the page renders,” but “the page actually supports the operator job end-to-end.”

#### A. Instance-level provider configuration
1. Show the real active default provider from live runtime/instance config.
2. Let the operator change the default provider.
3. Persist the change to the authoritative instance env, not the project binding.
4. Show the current fallback chain from the authoritative instance env.
5. Let the operator add providers to the fallback chain.
6. Let the operator remove providers from the fallback chain.
7. Let the operator reorder the fallback chain.
8. Clearly distinguish:
- saved config
- running config
- whether restart is required for the running process to adopt the new config

#### B. Provider key management
1. Show whether each provider key is configured.
2. Show masked key presence only, never raw secrets.
3. Let the operator add a missing provider key.
4. Let the operator update/rotate an existing provider key.
5. Let the operator remove a provider key.
6. Reject placeholder/test values cleanly.
7. Persist provider-key writes to the authoritative instance env.
8. Refresh readback so the UI reflects the new stored state.
9. If reachability is shown, make it clear whether it is:
- last checked state
- live checked state
- merely inferred from key presence

#### C. Provider status/readback
1. Show which provider is default.
2. Show which providers are configured vs not configured.
3. Show whether a provider is connected/reachable, if that check exists.
4. Show the path/source of truth indirectly through correct behavior, not by exposing raw implementation details.
5. Avoid marking non-default, non-fallback providers as operational failures merely because they are unconfigured.

#### D. Task routing / model override management
1. Show all supported Iranti task types that can be routed/overridden.
2. Make the task labels and descriptions fully readable.
3. Show the provider default model for each task.
4. Let the operator choose an override model per task.
5. Let the operator clear an override per task.
6. Let the operator reset all overrides.
7. Persist task overrides to the authoritative instance env.
8. Clearly tell the operator that restart is required if that is true.
9. Make it possible to verify that a saved override is actually in effect after restart.
10. Ideally distinguish:
- default model
- configured override
- currently effective model in the running process

#### E. Runtime-effect trust closure
This is the biggest gap seen in review so far.
The page should eventually help answer:
1. Did my change save?
2. Did the running instance restart after the change?
3. Is the running instance using the saved config?
4. What model/provider did the last relevant task actually use?

Without this, the page remains configuration-heavy but trust-light.

#### F. Safety and operator guidance
1. Do not confuse provider API-key semantics with Iranti client-key semantics.
2. Use operator-facing wording, not internal implementation language.
3. If balance/quota support is incomplete, label it honestly.
4. Do not expose partially implemented subfeatures as if they are reliable.
5. If a feature is config-only for now, be explicit that verification must happen elsewhere.

#### G. Claude verification targets for later
When Claude is asked to verify/fix this page later, it should explicitly check:
1. default provider save works end-to-end
2. fallback chain add/remove/reorder works end-to-end
3. provider key add/update/remove works end-to-end
4. task routing save/clear/reset works end-to-end
5. saved config survives refresh
6. running config behavior after restart is observable
7. non-default missing providers are not shown as unhealthy
8. task descriptions are readable
9. scope/quota wording is semantically correct
10. the operator can tell whether the page is showing:
- persisted config
- live running state
- or both

## Review Notes — Agents

### Screenshot reviewed
- `/control-plane/agents` route renders as a blank page

### Findings
1. Agents route is blank
- No visible shell/content/error/empty-state is rendered.
- This matches the blank-route failure pattern already observed on:
  - Instances
  - Archive detail

2. This is a core product surface, not an edge case
- Agent visibility is central to Iranti as a multi-agent memory system.
- A blank Agents page removes one of the most important explanatory/operator surfaces in the whole product.

3. Severity is high
- This is not merely a missing metric or weak copy issue.
- It is another route-level failure on a core navigation item.

4. It deepens the pattern of route/render instability
- At this point there are multiple pages or navigation targets that fail to render anything useful.
- That indicates a broader frontend routing/render robustness problem, not a one-off accident.

### Main conclusion for Agents
- This is a direct functional defect on a core page.
- The product currently cannot be considered stable at the navigation/surface level while key pages like Agents and Instances render blank.

### Cross-page implication
- Blank routes now affect multiple high-value navigation destinations.
- This weakens trust in the whole shell, even when individual working pages like Memory or Health are useful.

## Review Notes — Sessions / Session Recovery

### Screenshots reviewed
- Sessions page with:
  - tabs: `All`, `Interrupted`, `Active`, `Complete`, `Abandoned`
  - banner: `Could not load sessions — Iranti may be unreachable.`

### Findings
1. Sessions is not blank, but it is not usable
- Unlike Instances or Agents, the page does render its shell and tabs.
- But the actual content collapses immediately into a single generic error state.
- So this is a different failure mode than the blank routes:
  - route renders
  - data/load behavior appears broken or under-specified

2. The error message is probably semantically weak
- Message:
  - `Could not load sessions — Iranti may be unreachable.`
- That is a broad fallback diagnosis.
- It may be true.
- But if the rest of the product is successfully talking to Iranti on the same machine, the message is likely too generic or inaccurate.

3. Cross-page inconsistency is likely present again
- Health/Diagnostics indicates Iranti is reachable.
- Other pages have successfully read data from the runtime/DB.
- So a sessions-page error blaming reachability is suspicious unless:
  - the sessions endpoint is different/broken
  - auth/scopes differ for session-recovery APIs
  - the runtime feature is unavailable despite general connectivity

4. The page does not help the operator understand the failure
- It does not say whether the issue is:
  - API unavailable
  - auth/scope mismatch
  - feature not enabled
  - no sessions exist
  - session-recovery support unavailable on the bound instance
- The operator gets only a generic “may be unreachable.”

5. Tabs become meaningless when the data source does not load
- The page offers multiple session states:
  - interrupted
  - active
  - complete
  - abandoned
- But none of these tabs can be trusted if the page cannot load data.
- So the page promises a real operational surface but currently gives only a global failure banner.

6. This is still a core operator surface
- Session recovery is not as universally central as Instances or Agents, but it is a meaningful workflow.
- In the current state it is neither clearly unavailable nor clearly functional.

### Main conclusion for Sessions
- Sessions is currently a rendered-but-nonfunctional surface.
- It is not a blank-route issue.
- It is a weak/generic failure-state issue on a core-ish operational page.

### Questions to validate later
1. Is Iranti actually unreachable from this page, or is the failure specific to the sessions API path?
2. Does the bound project key have the scopes needed for session recovery endpoints?
3. Is session recovery data absent, or is loading failing before the empty state can be shown?
4. Should the page distinguish:
- feature unavailable
- no sessions found
- auth problem
- runtime unreachable

### Priority interpretation
- Lower severity than blank core routes, but higher severity than simple copy polish.
- The page currently fails to provide trustworthy diagnosis of its own failure.

## Cross-Page Mismatch Summary
These are the most important contradictions observed so far.

1. Home says the KB is empty.
- Memory shows hundreds of facts across multiple entity types.

2. Home suggests no meaningful system activity.
- Memory shows recent updates across several entity categories.

3. Home’s widgets appear to reflect control-plane-local activity/migration state.
- Memory appears to reflect actual Iranti KB content.

4. The product currently has two competing stories:
- “system is mostly empty”
- “system is populated and queryable”

This must be resolved in favor of truth.

5. Activity surfaces do not yet tell a stable story about whether the system is:
- idle
- partially observable
- disconnected
- or internally unfinished

6. Logs and Activity both imply staff-event observability, but the Logs page shows the required backing table is absent and the suggested migration command currently fails

7. Multiple navigation targets now produce blank pages or dead surfaces:
- Archive detail
- Instances

8. Health now largely reflects live runtime truth, but still contains remediation guidance (`npm run migrate`) that conflicts with operator-tested reality

9. Metrics, like Home, appears to under-report actual KB population and activity, likely because it is reading a different or unpopulated source

10. Provider configuration is visible, but proof of effective runtime use is not yet obvious from the page itself

11. Multiple core routes render blank pages or dead views:
- Instances
- Agents
- Archive detail

12. Sessions blames generic reachability even though other parts of the product appear able to reach the live Iranti runtime

## Product-Level Interpretation So Far
- Health/Diagnostics is improving toward real operator truth.
- Memory Explorer is comparatively strong and truthful.
- Home/Overview is currently the least trustworthy summary surface reviewed so far.
- Activity feels more like exposed implementation status than an operator-ready live console.
- Logs is currently a broken surface with a broken remediation path.
- Instances is a core route that currently appears outright broken.
- Health is one of the stronger pages, but its remediation trustworthiness is still undermined by the broken migration path.
- Metrics currently appears semantically closer to Home than to Memory, and is therefore hard to trust as a system summary surface.
- Conflicts looks comparatively stable so far, though its empty-state wording/layout still needs refinement.
- Providers looks comparatively promising, but still lacks strong proof-of-effect for task-routing changes.
- Agents is another core route that currently appears outright broken.
- Sessions is a rendered page with a weak/generic failure state rather than a usable recovery surface.
- The system still leaks some internal implementation concepts, but the more important problem is semantic inconsistency across pages.

## Things To Keep Watching In Subsequent Page Reviews
As more pages are reviewed, pay attention to:
- whether top-level summaries reflect live Iranti truth or control-plane-local proxies
- whether setup/integration notes are incorrectly presented as runtime degradation
- whether internal concepts (`ticket IDs`, PR references, internal migration names, diagnostic entity types) leak into operator surfaces
- whether the control plane is telling the same story across:
  - Home
  - Memory
  - Archive
  - Activity
  - Agents
  - Sessions
  - Metrics

## Open Questions To Validate Later
1. What exactly is the Home page `Knowledge Base` widget counting?
2. Is it reading:
- real Iranti KB totals
- event/activity-derived metrics
- a CP-local analytics table
- a subset of entities/facts
3. Should `__diagnostics__` appear as a first-class entity type to operators?
4. Should “Active Agents” mean:
- recently observed agent activity
- known registered agents
- recent writes
- recent handshakes
5. Which surfaces are intended for:
- advanced truth browsing
- everyday operator workflows
- internal engineering debugging

## Operational Notes
- Multiple control-plane/dev server processes accumulated during iterative testing.
- Cleanup on Windows should use Windows-native process control (`taskkill`, PID shutdown, service-aware stop), not Unix-only guidance like `pkill`.
- Do not assume `pkill -f "dist/index.js"` exists or is correct on the target Windows environment.

## Follow-Up Candidate Slices
Not to fix immediately here, but likely future work:
1. Home page KB/activity/agents metric truthfulness
2. Cross-page consistency between Home and Memory
3. Internal entity/type leakage cleanup (for example `__diagnostics__`)
4. Operator-friendly provenance labels / explanations
5. Remaining internal chatter cleanup in Activity / Archive-adjacent surfaces
6. Archive detail blank-page failure
7. Clarify whether `archive_flags` is required, optional, or improperly surfaced
8. Activity page live/reconnecting/coverage truthfulness
9. Broken `npm run migrate` path for `staff_events` / Logs surface
10. Blank Instances route
11. Health severity model and remediation trustworthiness
12. Metrics source/label mismatch
13. Conflict Review empty-state consistency / wording precision
14. Provider task-routing readability and proof-of-effect
15. Blank Agents route
16. Sessions failure-state diagnosis and trustworthiness

## Sessions

### What The UI Shows
- The `Sessions` route renders its shell correctly.
- The page header and framing load: `Session Recovery`, subtitle text, and tab set (`All`, `Interrupted`, `Active`, `Complete`, `Abandoned`).
- Instead of data or an empty-state per tab, the content collapses into a single red error banner: `Could not load sessions � Iranti may be unreachable.`
- The user captured the same generic error state across multiple tabs.

### Interpretation
- This does **not** look like the same failure class as the blank `Instances` and blank `Agents` routes.
- The route itself appears mounted and the page component renders.
- The likely failure is deeper in data loading, endpoint wiring, or error handling.
- The error message is overly coarse. Given other parts of the product can reach Iranti, `Iranti may be unreachable` may be semantically wrong even if the sessions-specific request failed.

### UX / Product Concerns
- The page gives the operator almost no information beyond a generic reachability guess.
- There is no distinction between:
  - Iranti being actually down
  - the sessions endpoint failing
  - no session records existing
  - auth/scope problems
  - version / compatibility mismatch
- Because the tab shell renders, the user expectation is that category-specific empty states or results should appear, not one global failure banner.

### Severity / Classification
- Functional issue: the Sessions surface is not usable in its current state.
- Different from route-level blank screens; this is a rendered page with a coarse failure mode.
- Should be tracked separately from `Agents` / `Instances` blank-route defects.

### What To Validate Later
- Whether the underlying sessions API call is failing, returning empty, or being blocked by compatibility/version gating.
- Whether the error message is inaccurate relative to actual Iranti reachability.
- Whether the page should degrade to per-tab empty states instead of one global banner.
- Whether the route assumes session-recovery features that are absent or version-gated on this instance.

## Getting Started

### What The UI Shows
- The `Getting Started` route renders its shell correctly.
- The page does not show onboarding content, setup progress, or actionable first steps.
- Instead it collapses into a centered error state:
  - `Could not load setup status`
  - `Instance not found`
  - `Retry`

### Interpretation
- This is not a blank-route rendering failure.
- The page component loads, but the underlying setup-status lookup fails.
- The message `Instance not found` is surprising because the left nav clearly shows an active selected instance (`iranti-control-pl... :3001`).
- That creates a direct trust problem: the product appears to know an instance is selected while also claiming the instance is not found.

### UX / Product Concerns
- `Getting Started` is supposed to be the safest and clearest onboarding surface, but here it is another generic failure page.
- The error state provides almost no operator help beyond a retry button.
- There is no indication whether the issue is:
  - missing control-plane instance registry data
  - mismatch between selected UI instance and backend instance name
  - setup-status API failure
  - stale binding / runtime metadata
  - version incompatibility
- Because this is the onboarding page, low-quality error handling hurts trust more here than on an advanced page.

### Severity / Classification
- Functional issue: onboarding/setup surface is unusable in its current state.
- Similar class to `Sessions`: page renders, data lookup fails, and the UI falls back to a coarse error state.
- Not the same class as the blank `Instances` / `Agents` route failures.

### Cross-Page Implication
- There may be a broader instance-resolution or selected-instance context bug affecting multiple pages.
- `Getting Started` saying `Instance not found` and `Sessions` saying `Iranti may be unreachable` suggest several routes are using weak fallback messages instead of precise failure reasons.

### What To Validate Later
- Whether the active instance in the left nav matches the backend lookup key used by the page.
- Whether the setup-status endpoint is failing on instance resolution even though the runtime is otherwise reachable.
- Whether the page is depending on control-plane-local metadata that is absent while the runtime itself is healthy.
- Whether more precise operator guidance can be shown when onboarding state cannot be resolved.
