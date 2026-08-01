# 37. Context Management — Context Lens (cross-job context)

> SSOT document for how ANT's cross-job context is stored, distilled, assembled, and injected.
> Related code: [`core/context/`](../../packages/ant-cli/src/core/context/), [`core/executionTier/contextProfile.ts`](../../packages/ant-cli/src/core/executionTier/contextProfile.ts)

## 0. Three-layer model — "why the ring never fills"

| Layer | Unit | Management mechanism |
|---|---|---|
| **per-call** | The prompt of a single LLM call | What the token ring shows: `(input + cacheCreation + cacheRead) / model context window`. When the node changes, the display switches to the new call's baseline |
| **in-job** | Conversation history inside one job | `compactRun`/`compactTurns` (compacts when the history budget reaches ~90%, keeps the hot tail) — out of scope for this document |
| **cross-job** | Context carried between jobs | **Context Lens** (this document) |

**FAQ — why the ring never fills no matter how long the chat gets**: the chat transcript (chat.jsonl) structurally never enters the LLM prompt. Cross-job context is injected only as a **bounded** assembly distilled from feature.jsonl (4K–12K token cap per profile), which is ~1% of a 1M-class context window and therefore visually undetectable. This is design, not a defect — in large jobs (Tier 3 makes ~90–100 calls per job) the cache breaks at every task boundary, so unbounded chat injection is harmful on both the token-cost and context-rot axes.

## 1. Two logs — storage is lossless, injection is bounded

| File | Role | LLM injection |
|---|---|---|
| `sessions/chat.jsonl` | UI SSOT — every display event (assistant_message, thinking, chat_status, choice cards) | **Forbidden** (Chat Clear invariant below). Two exceptions: the P1 transitional rich tail (ask/direct), migration backfill |
| `sessions/feature.jsonl` | LLM context SSOT | The only source |

### feature.jsonl line types (6 kinds)

| Type | Written at | Lifetime |
|---|---|---|
| `user_turn` | Job start (submit) | Until boundary. ask/inline-ask are `ephemeral: true` |
| `user_turn_meta` | triage (intent) / decompose (executionTier) patch | Same as user_turn |
| `breadcrumb` | Job end — **file-output trace** (anchors + noun-form summary) | Semi-permanent (survives boundary) |
| `assistant_turn` | Job end — **conversation trace** (`finalText` + `digest`) — P2 | Until boundary, recency demotion |
| `context_summary` | Once when the band-2 budget is exceeded — checkpoint (`summary` + `constraintLedger`) — P3 | Only the latest is valid |
| `boundary` | Hard Reset only (`user_reset`; auto boundary is retired) | Cursor |

**breadcrumb vs assistant_turn responsibility split**: breadcrumb answers "which files were touched" (navigation anchors, semi-permanent); assistant_turn answers "what was discussed and what was decided" (referent resolution, recency demotion). Their lifetimes differ, so they are not merged.

## 2. Distillation (write path) — once at job end

[`core/context/assistantTurn.ts`](../../packages/ant-cli/src/core/context/assistantTurn.ts) `distillAssistantTurn` — called at the same seam as breadcrumbs (code/design learn, inline-ask dispatch), but runs **independently of** the BC gate (explain/touched=0 skip) — a conversation is context even when it changes no files.

- `finalText`: the turn's final user-facing utterance — harvested from chat.jsonl as `assistant_message` (excluded when kind is system_notice/rendered_payload/thinking_chunk) + `chat_status[task_response]`, tail-capped at ~800tok. ask uses the graph's `response` directly.
- `digest` (TurnDigest): `decisions[]` / `constraints[]` (must quote the user's wording) / `outcome` / `openQuestions?`.
  - **Deterministic absorption of choice_resolved**: clarify/choice card responses are already structured on disk, so they enter decisions without an LLM (the highest-confidence source, always leading).
  - Only Tier 2+ makes one small LLM call (`infra/turn-digest/system.md`, 8s timeout); Tier 0/1 and ask use template extraction. On failure, fall back to the template — distillation never blocks learn.

## 3. Assembly (read path) — 3-band Lens

`hydrateFeatureContext` (once per job in resolve; triage re-hydrates per turn) → `FeatureContext`:

| Band | Content | Source |
|---|---|---|
| **1 Verbatim** | Most recent K exchanges: raw user text + assistant finalText + that turn's BC anchors | `exchanges[]` (user_turn ⋈ assistant_turn ⋈ breadcrumb by turnId) |
| **2 Structured** | Digests of the turns outside band 1 | `digests[]` |
| **3 Compressed** | Rolling summary + **Constraint Ledger** + (folded) old BCs | `context_summary` checkpoint |

A band is **fidelity by recency**, not a line type. Overflow cascade: band 1 overflow → demote to the on-disk digest (0 LLM calls) → band 2 overflow → fold into a checkpoint (1 LLM call, free afterwards).

- **ephemeral demotion**: ask turns are dropped first during K trimming regardless of age, and never enter band 2.
- **Migration backfill**: old turns without an assistant_turn are reconstructed from chat.jsonl for the trailing 6 only (`backfillExchangesFromChat`) — converges to 0 as assistant_turns accumulate.

### Compaction trigger — `estimateCarryoverTokens` × `FEATURE_CONTEXT_THRESHOLD`

- **Measurement SSOT**: `estimateCarryoverTokens(ctx)` (featureContextBuilder) — sums **all channels**: userTurns + breadcrumbs + assistant finals + digests + summary + ledger (2.8 chars/tok). The compaction trigger and the `GET context/estimate` gauge consume the same function, so "gauge number = trigger quantity" is structurally guaranteed. (Previously two inline expressions counted different channels, so the gauge and the trigger diverged.)
- **Meaning**: `FEATURE_CONTEXT_THRESHOLD` (24k) is a **fold trigger point, not an injection cap**. Actual per-call injection is bounded separately by the §4 profile caps. Evaluation happens at the **next job's hydrate on entry** (resolve; triage per-turn re-hydration uses `skipCompaction=true`) — the gauge exceeding the trigger point during/after a job is a normal state, and there is no manual compaction.
- **Wiring**: code/planner/visual/**design** resolve all pass llm/promptPort so compaction runs at any job's entry (compaction is **shared maintenance that benefits every subsequent job** — checkpointing, ledger incorporation, etc.; consumer-perspective skipping is forbidden). The tier gate is NoopCompact only for Tier 0 Reflex.
- **No double gate**: `compactJob` does not re-evaluate the threshold internally for pre-partition callers (`recentWindowSize <= 0` — compactFeatureContext). The single owner of the fold decision is compactFeatureContext, which measured the store (if re-evaluation is revived: the store exceeds the threshold but the to-be-folded old subtotal is below it, causing a permanent no-op regression).

### Recall escape hatch — `read_state` scope='history'

The raw text of folded turns disappears only from the prompt surface — it stays in feature.jsonl. When the digest/rolling summary is insufficient, the LLM can call `read_state` with `scope: 'history'` to browse the raw user_turn/assistant_turn text since the boundary via roster/search (the `ctx.featureHistory` seam — the code tool node injects a SessionPort lazy closure; a scope extension of the existing read_state, no new tool). The ledger (Standing Constraints) never needs browsing — it is a floor injected unconditionally into every profile.

### Constraint Ledger — "constraints stated in chat do not silently disappear"

The checkpoint's `constraintLedger` is a **deterministic verbatim-carry**: previous ledger ∪ the constraints of the folded digests, dedupe only. The LLM never rewrites the ledger, so drops are structurally impossible. Supersession is handled not by deletion but by a read-time rule ("the current instruction wins"). **Injection floor**: every profile, including lean, always renders the ledger.

## 4. Adaptive profiles (SSOT: `contextProfileFor(node, tierId)`)

| Profile | Band 1 | assistant cap | Band 2 |
|---|---|---|---|
| rich | K=6 | 1680 chars (~600tok) | ≤12 digests |
| standard | K=3 | 840 chars | ≤8 |
| lean | K=6 (user only) | 0 (strip) | ≤1 |

| Node | Profile | Rationale |
|---|---|---|
| triage / detect | lean | Runs every turn + the last intent is the key signal (rot-sensitive) |
| decompose | standard | Once per job; it decides the tier itself, so tier-conditioning is impossible |
| plan | standard (lean for Tier 4) | Receives ~22 calls per Tier 3 job; Tier 4's refs are the ground truth |
| direct (Tier 0/1) | rich | Conversational rim, 1–3 calls (transitional: P1 chat tail) |
| ask agent | rich | P1 chat tail (`buildChatTail`) — the Lens migration is a follow-up. Two arrival paths: inline-ask dispatch (`orchestrator.ts`) + full-job ask fallback (`agents/architect/graph/ask/fullJobAskFallback.ts` — E2-5, see §8 below) |

Rendering is a single partial [`jobs/shared/injections/context-lens.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/context-lens.md) — Recent Exchanges / Standing Constraints / Prior Exchange Digests.

## 5. Chat Clear vs Hard Reset

| | Chat Clear (broom) | Hard Reset (trash can, 2-click) |
|---|---|---|
| Action | chat.jsonl collapse (clears the screen only) | Physically deletes feature.jsonl + chat.jsonl |
| ANT's memory | **Kept** | **Fully erased** |
| User intent | "Tidy up the scrollback" | "Fresh start — the accumulated context is noise" |

**Chat Clear invariant** (load-bearing): the context pipeline never live-sources chat.jsonl — the exceptions are fixed at 4 sites and enforced by [`tests/policy/chat-clear-invariant.test.ts`](../../packages/ant-cli/tests/policy/chat-clear-invariant.test.ts). Therefore Clear cannot touch ANT's memory.

## 6. triage consumption-state discriminator axis (P1b — green-padding-drake RCA)

design breadcrumbs carry a derived annotation `consumption: 'pending' | 'consumed'` (computed deterministically from whether a subsequent code-job user_turn exists, excluding the current turn). triage rules.md bifurcates the routing of failure reports on this state:

- Latest same-surface spec is **pending** (unconsumed) → the report joins the pending spec (`rev-spec`) — nothing has been implemented yet, so the "built behaviour" is unrelated to that spec, and a parallel second document would force manual merging.
- **consumed** → a new remediation as before (`gen-spec`) — keeps the high-ironing-mouse direction.

Wording lock: [`tests/prompt/triage-rev-gen-discriminator.test.ts`](../../packages/ant-cli/tests/prompt/triage-rev-gen-discriminator.test.ts) (both directions).

## 7. Regression guard inventory

| Test | What it locks |
|---|---|
| `tests/parallel/worker-feature-context-propagation.test.ts` | P0 — worker sharedContext featureContext propagation (code+design) |
| `tests/prompt/triage-rev-gen-discriminator.test.ts` | P1b — consumption-state axis in both directions + pending-marker render |
| `tests/context/chat-tail-builder.test.ts` | P1 — rich tail harvesting/cap/exclusion rules |
| `tests/prompt/recent-conversation-injection.test.ts` | P1 — ask/direct template render |
| `tests/context/assistant-turn-distill.test.ts` | P2 — distillation (harvest / choice absorption / LLM fallback / no-throw) |
| `tests/context/lens-projection.test.ts` | P2 — band assembly + profile caps + ephemeral demotion + II-3 matrix |
| `tests/prompt/context-lens-render.test.ts` | P2/P3 — partial render + plan substitution + ledger floor |
| `tests/context/context-summary-checkpoint.test.ts` | P3 — checkpoint apply/reuse (0 LLM calls)/ledger verbatim-carry |
| `tests/policy/chat-clear-invariant.test.ts` | Chat Clear invariant (chat reads fixed at 4 sites) |
| `tests/context/full-job-ask-fallback.test.ts` | E2-5 — full-job ask fallback (rich tail → runAskGraph → ephemeral distill, wired via the architect/index.ts branches) |
| `tests/context/context-lens-endpoints.test.ts` | E2-4 BE — `GET context/lens` band bodies + `POST context/pin` route-absence (404) guard |
| ant-ui `tests/store/contextLensSlice.test.ts` | E2-4 FE — estimate/lens AsyncFields transitions + feature-key guard |
| `tests/verification/unit/featureContextBuilder.test.ts` | Measurement SSOT — `estimateCarryoverTokens` sums all channels + digest tokens count toward the compaction trigger |
| `tests/tools/read-state.test.ts` | read_state — run scope + history scope (roster/search/unwired graceful) |

## 8. User-facing surfaces (E2-4) + full-job ask fallback (E2-5)

- **Carry-over gauge** — the `FeatureContextGauge` in the chat header displays `GET context/estimate` (`estimatedTokens / capTokens`). **The gauge itself has no tooltip** — clicking it opens exactly one surface, the Context panel (structural removal of the past defect where a click-triggered tooltip and the panel popped simultaneously). The bar turns amber when the trigger point is exceeded. Refresh: feature switch (`useFeatureLogSync`) + job-end SSE (`chatSseHandler`) — no polling.
- **Context panel** — clicking the gauge opens `ContextLensPanel`, which browses the band bodies via `GET context/lens` (Standing Constraints + rolling summary / Recent Exchanges / Digests). The header always shows a **fixed status line** (`{tokens} / {cap}` + "auto-compacts when the next job starts" when exceeded); the deeper semantics (cross-job vs per-call ring; the ring always includes the carry-over in actual usage) live in a hover **ⓘ info tooltip**. **Read-only surface** — user pins were removed (the ledger grows only automatically, via job-end distillation + deterministic compaction incorporation; the `POST context/pin` route/types/actions are all retired).
- **full-job ask fallback (E2-5)** — when a regular job's (learn/design/code) triage classifies `group==='ask'`, the graph ends at `__end__` (routeToAskGraph is not wired). The three ask branches in `architect/index.ts` run `answerFullJobAsk` (`graph/ask/fullJobAskFallback.ts`) at a seam outside the graph — wiring isomorphic to inline-ask dispatch (P1 rich tail → `runAskGraph` → ephemeral `assistant_turn` distillation, jobType `'ask'`). On failure: log + placeholder-message fallback (an ask failure never becomes a job crash). The learn graph declares a `turnId` channel for this (undeclared channels are dropped at every node transition).

## 9. Explicitly out of scope

- **In-job execution quality / model generation fidelity** — the Lens covers cross-job context only.
- **Multi-tab** — a separate epic. Only the groundwork is in place: the `scopeId?` field in the `assistant_turn`/`context_summary` schemas.
- **P1 chat tail retirement** — once `assistant_turn` lines have accumulated sufficiently in real use (a few weeks after P2 ships), switch ask/direct to the Lens rich profile and remove the `chatTailBuilder` body.
