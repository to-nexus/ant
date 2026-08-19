# 46 · Pipeline Scheduling — file-defined chains of universal runs

The universal runtime ([44](44-universal-job.md)) executes one turn when a
human presses one button. Pipelines make it self-driving: a **Pipeline** is
one YAML definition (a cron trigger + a step DAG), a **Run** is one firing of
it, a **Step** is one DAG node — a universal job dispatch, or an approval
gate that issues no job. Chaining is cross-job and cross-agent
(`customJobRef` per step); a step's node address is `(customJobRef,
intent ≤ 1)`, exactly the schedule-node shape 44 reserved. Everything runs
server-side (multi-replica safe) — this is a cloud-service scheduler, not a
client-resident loop.

Doc 45 §4 recorded the design constraints before any code existed; this doc
records what was actually built and the invariants that keep it correct.
Sections: vocabulary & storage → trigger engine → dispatch path → chain
executor → HITL gates → identity/billing → failure/audit → HTTP/FE surface →
rules → phasing.

---

## 1. Storage — disk is SSOT, Redis is a rebuildable projection

Definitions live at the ACCOUNT scope, sibling of `.ant/agents`
(`core/pipelines/paths.ts`):

```
{ws}/{org}/{user}/.ant/pipelines/{pipelineId}/pipeline.yaml
{ws}/{org}/{user}/.ant/pipelines/{pipelineId}/owner.json      ← owner coords sidecar
{ws}/{org}/{user}/.ant/pipelines/{pipelineId}/runs/{runId}.jsonl
{ws}/{org}/{user}/.ant/pipelines/{pipelineId}/runs/index.jsonl ← 1 line per terminal run
```

A pipeline cannot live inside an agent directory because its steps cross
agents. It pins ONE `projectId` — every step's session/artifacts land in that
universal container. Team-org users anchor under the INDIVIDUAL org, the same
fork as `deriveCustomAgentScopeRootsForTenant` (never a new one).

The definition contract is `@ant/shared/pipeline.ts`. `validatePipelineDef`
follows the `validateMcpServers` precedent — plain messages, empty = valid;
callers pick the failure shape (store throws `PipelineValidationError`, HTTP
answers 400, the editor form-disables). Server-side rules that need I/O live
in `validatePipelineDefServer` (`core/pipelines/store.ts`): the cron
minimum-interval cap and the gate-anchor rule (an approval step must have an
upstream step — its chat card anchors to the producing job's turn).

**Unknown and reserved YAML keys are rejected loudly** (`retry`,
`remindAfter`, `overlap: cancelPrevious`, `{{steps.*}}` templates each get a
"not supported yet" message) — an author must never conclude a silently
ignored knob works. Directive templating is a whitelist substitution
(`{{trigger.fireDate}}`, `{{trigger.fireEpoch}}`, `{{run.id}}`), never a
template engine.

Cron parsing is server-only (`core/pipelines/cron.ts`, `cron-parser@4` — the
same major BullMQ uses internally, so the preview and the firing cannot
drift). `@ant/shared` stays dependency-free by package doctrine, which is why
`getNextFires` is NOT next to the validator; the FE round-trips
`POST …/preview-fires`.

Redis keys (`REDIS_KEYS.PIPE`, all rebuildable):

| Key | Role |
|---|---|
| `ant:pipe:run:{runId}` | live RunRecord JSON (single writer under the run lock; 7d past terminal) |
| `ant:pipe:active:{org}:{user}:{pipelineId}` | overlap guard, value = runId (NX; released at terminal) |
| `ant:pipe:fired:{org}:{user}:{pipelineId}:{fireEpoch}` | fire idempotency NX (48h) |
| `ant:pipe:job:{jobId}` | jobId → (runId, stepId, owner) reverse mapping for the status consumer |
| `ant:pipe:hitl:{gateId}` / `ant:pipe:card:{cardId}` | armed gate record / card → gate reverse mapping |
| `ant:lock:pipe-run:{runId}` | per-run mutation lock |

---

## 2. Trigger engine — BullMQ Job Scheduler on a dedicated `ant-pipelines` queue

A hand-rolled tick loop (cron math + due-index ZSET + cluster lock) was
rejected: `Queue.upsertJobScheduler` (BullMQ 5.81.3) is natively
cluster-safe — the next fire exists as ONE delayed job in Redis and any
replica's worker collects it.

The `ant-pipelines` queue (`infrastructure/scheduling/PipelineQueue.ts`)
carries **control jobs only** — `fire`, `gate-timeout`, `step-retry` — never
LLM work. Control jobs are idempotent (fire NX / gate NX downstream), so this
queue runs `attempts: 3` + backoff. **`ant-jobs` keeps `attempts: 1`** — that
invariant belongs to a different queue and is untouched (a BullMQ retry would
replay an LLM job's payload without `isResume`).

Fire semantics (`PipelineRunCoordinator.handleFire`):
- `fireEpoch` = the intended slot (job creation time + delay, minute-rounded).
- **Missed fires** (worker downtime > 10 min): `onMissed: skip` drops,
  `runOnce` executes once on recovery.
- **Overlap**: the `ant:pipe:active` NX is the guard. `skip` drops the fire;
  `queue` releases the fire-NX and re-arms itself every 60s (bounded).
  `cancelPrevious` is reserved (validator rejects).
- `runNow` rides the same fire path with `firedBy: 'manual'` — the test
  button and the cron path cannot diverge.

Reconciliation (`PipelineReconciler`) is the StaleJobRecovery template
verbatim: boot-time run + 90s `setInterval().unref()` in
`ExpressServerAdapter`, cluster lock (`ant:lock:pipeline-reconcile`) inside
the function. It scans `{ws}/*/*/.ant/pipelines/**`, upserts a scheduler per
enabled definition (`schedulerId = pipe|{org}|{user}|{pipelineId}`), and
removes orphans whose id has no disk counterpart. CRUD routes upsert/remove
synchronously; reconciliation is the safety net for hand-edited YAML and
missed writes.

---

## 3. Dispatch — one owner, one gate set (Phase-0 extraction)

`RouteConfigurator.createExecuteJob()`'s body was extracted verbatim into
**`core/scheduling/UniversalDispatchService`** (jobId minting, workspace
ensure, enqueue, `setJobStatus`/`setJobMapping`, tracker cache). The HTTP
route delegates to it; the coordinator dispatches through it. A scheduled
fire therefore CANNOT bypass anything an interactive execute does — the
bypass is structurally impossible, not reviewed away.

The universal accept gates moved to **`core/scheduling/UniversalDispatchGate`**
(`resolveUniversalExecuteContext`, `validateUniversalTurnMeta`,
`findDuplicateActiveJob`, `checkStartCredits` with an injected ledger);
`job.routes.ts` imports them, the coordinator composes them. Owner-standing
gates (`checkApproval` / `checkTeamMembership`, still owned by
`helpers/approvalGate.ts`) are re-judged **at every step dispatch**, never
once at registration — admin revocation and credit drain take effect
mid-chain (step fails with `account-not-approved` / `membership-revoked` /
`insufficient-credits`).

The project-level duplicate gate (`universal` = one live job per project) is
handled by **bounded re-arm**: a chained step that collides with an
interactive run retries every 60s (up to 1h) instead of failing — queueing
behind a human is normal, not an error.

`JobPayload` gained attribution only: `firedBy?: 'user'|'schedule'|'chain'`,
`pipelineRunId?`, `pipelineStepId?`. Run history is owned by the run JSONL —
never duplicated into job records.

---

## 4. Chain executor — pure math, coordinator does I/O

`core/pipelines/ChainExecutor.ts` is a pure function set:
`planAdvance(def, run)` / `applyStepOutcome(def, run, stepId, outcome)` →
`{ run', dispatches }`. No Redis, no clock, table-tested
(`tests/pipelines/chain-executor.test.ts`).

Semantics: implicit edges (no `needs` = previous step in file order; explicit
`[]` = root), a step becomes ready when every need is terminal, its `on`
condition judges the outcomes (`success` default / `failure` / `always`), a
non-matching condition **skips** and skips cascade (a skipped need is neither
success nor failure). `defaults.onStepFailure: abort` (default) cancels
still-pending steps on the first failure and seals `failed`; `continue`
lets independent branches finish and seals `partial` on mixed outcomes.

**FlowProducer was rejected**, not overlooked: ① a step's jobId can change
mid-step (clarify end-and-resume re-dispatches under a new id — Phase 2) while
a Flow tree is frozen at enqueue; ② a human gate can wait weeks, holding Flow
parent state hostage to queue retention; ③ this repo's rule is pub/sub
fan-out, never BullMQ-internal hooks; ④ the per-project duplicate gate needs
self-paced sequencing anyway — eager child enqueue is actively harmful.

The coordinator (`infrastructure/scheduling/PipelineRunCoordinator.ts`) is an
ADDITIONAL subscriber on `job:status:updates` (note: no `ant:` prefix —
`CHANNEL_DOMAINS.JOB = 'job'`), beside RouteConfigurator's. It resolves
`ant:pipe:job:{jobId}`, takes the per-run lock, applies the executor's plan,
dispatches what unblocked, appends JSONL, publishes SSE. An interruption
(pause) on a pipeline job is a step **failure** (`interrupted: {reason}`) —
unattended chains have nobody to resume. A job that completes but sealed
`awaitingClarify` fails the step as `awaiting_clarify_unsupported` (v1;
clarify-await hand-off is the Phase 2 axis). The DAG the run executes is the
**frozen `defSnapshot`** compiled at fire time — editing the YAML never
mutates an in-flight run.

---

## 5. HITL gates — one resolve funnel, durable timeout arms, zero polling

An approval step suspends the run without holding any worker slot:

```
armGate: HITL record (Redis) + pipeline_approval choice card + delayed timeout arm
resolve: ChatService.appendChoiceResolved (NX ant:choice:resolved:{cardId})
         └─ winner → PipelineRunCoordinator.applyResolvedGate → chain advances
```

Every channel funnels through the SAME NX-guarded choice-resolved:

| Channel | Path |
|---|---|
| chat card click | `POST /chat/choice-resolved` → `pipeline_approval` branch (after `result.resolved`) |
| pipelines tab inbox / API | `POST …/pipelines/approvals/:gateId` → `appendChoiceResolved` → `applyResolvedGate` |
| timeout arm | `gate-timeout` control job → `appendChoiceResolved('Timed out')` → NX decides the winner |

One authority, one audit line (chat.jsonl + run JSONL `human_resolved` with
`decidedBy/decidedAt/via`), one idempotency key. The card is written
server-side via `ChatService.appendChoicePresented` (the `resume_confirm`
precedent) — `ChatAPIClient.sendChoiceCard` is job-runner-child-only and
silently no-ops in the API process, which is exactly the trap this sentence
exists to prevent. The card anchors to the **nearest upstream job step's
jobId** (a card with no turn anchor is silently dropped by ChatService —
hence the validator's "no rootless gates" rule).

Timeout arms are delayed jobs on `ant-pipelines` (`gto-{gateId}`), cancelled
on resolve. There is no polling sweep anywhere in this feature.

The reserved v2 contract (user-locked as backlog): a
`NotificationChannelPort { kind: 'inApp'|'slack'|'email' }` whose inbound leg
(HMAC magic-link `{cardId, choiceId, exp}`) lands in the same choice-resolved
funnel with `via: 'magic-link'`. No implementation ships in v1; the funnel
shape is what makes the extension migration-free.

---

## 6. Identity, billing, tenancy

**Owner delegation** (user-locked): a pipeline's existence under the owner's
account root IS the ownership claim. `owner.json` stores coordinates
(`userId/organizationId/organizationKind`) — never a token — written at save
time; the fire path builds `UserContext` from it directly (the HTTP execute
path's JWT extraction has no scheduler equivalent, by design). All work bills
to the owner; per-step gates above are what keep a revoked owner from
continuing to spend.

Caps are first-class (`DEFAULT_PIPELINE_CAPS` in shared): `maxPipelines` 20,
`maxStepsPerPipeline` 20, `minCronIntervalMinutes` 5 (enforced by sampling
the next 10 fires — the expression is judged by what it does),
`maxConcurrentRuns` (Phase 3 enforcement via `concurrencySlot`).

---

## 7. HTTP / FE surface

Routes (`pipelines.routes.ts`, mounted `/api/projects/:projectId/pipelines`,
`mergeParams`): list (server-computed `nextFireAt` — the FE never parses
cron) · create/get/put/patch(enabled)/delete · `preview-fires` ·
`run-now` (202, 409 + `existingRunId`) · `runs` + `runs/:runId` (Redis, disk
fallback) + `runs/:runId/cancel` · `approvals` + `approvals/:gateId`.

SSE: ONE `pipeline` event, cause-discriminated
(`runUpdate | approvalRequested | approvalResolved | defChanged`) — the
gitState pattern. Published **user-scoped** (no projectId on the envelope) so
the approvals inbox folds even while another project is open.

FE (`presentation/components/Pipelines/`): the `pipelines` main-panel tab
(universal projects; content-level kind split per the ActionsPanel doctrine)
is an AgentSettings-style resizable split — rail (approval inbox pinned +
pipeline rows) beside an **n8n-style canvas editor** (reactflow + dagre,
already vendored for `components/workflow/`): trigger/step/gate nodes,
edge-condition labels, insert-after "+" menus, node click → inspector drawer
(agent→job→intent cascade from `universalSlice.customAgents`, directive
template chips, `@ctx` pins, gate timeout policy), live-run status overlay so
the canvas doubles as the run monitor. Every surface edits ONE draft object
(`pipelineSlice.pipelineDraft` vs `pipelineSavedDef`); saving is gated by the
shared validator client-side plus the `preview-fires` verdict. The
`pipeline_approval` chat card is a standard ChoiceCard variant. UI-authored
definitions stay implicit-linear (`needs` omitted); an explicit-`needs` DAG
still renders, but node insertion degrades to append (v2 opens free-DAG
editing on the same wire contract — no migration).

---

## 8. Rules

### ❌ Forbidden

- **FlowProducer / BullMQ-internal hooks** for chaining. Fan-out is the
  `job:status:updates` subscriber; sequencing is the coordinator's.
- **Touching `ant-jobs` retry semantics.** `attempts: 1` there is load-bearing;
  scheduler-level retries live on `ant-pipelines` only.
- **Dispatching a pipeline step around `UniversalDispatchService` or the
  `UniversalDispatchGate` functions** — the whole point of the Phase-0
  extraction is that route and scheduler share one owner.
- **Promoting a `ant:pipe:*` projection to source of truth.** The reconciler
  must always be able to rebuild them from `.ant/pipelines/**`.
- **A second gate-resolve path.** Every channel (card, inbox, API, timeout,
  future magic-link) goes through `appendChoiceResolved`'s NX and then
  `applyResolvedGate`. Two paths = double-applied gates.
- **Silently ignoring a definition key.** Reserved knobs get an explicit
  "not supported yet" validation error.
- **Cron parsing in the FE or in `@ant/shared`.** Server-side only
  (`core/pipelines/cron.ts`); the FE round-trips `preview-fires`.
- **Storing tokens for scheduled identity.** Owner coordinates only.

### ✅ Correct

- New trigger kinds = new `on.*` fields compiled to the same fire path;
  `runNow` already proves the path is trigger-agnostic.
- New chain edge predicates = executor-only changes (`planAdvance` judges
  conditions; the coordinator never inspects step semantics).
- New approval channels = a new outbound presenter + the SAME resolve funnel.
- Extending caps = `PipelineCaps` + validator; enforcement stays at save
  (400/form-disable) and fire (skip + log).

```bash
rg -n "upsertJobScheduler|'ant-pipelines'" packages/ant-cli/src --glob '!**/infrastructure/scheduling/*'  # Expected: 0
rg -rn "from 'cron-parser'" packages/ant-ui/src packages/ant-shared/src                                   # Expected: 0
```

Guards: `tests/pipelines/{pipeline-def-validation,chain-executor,pipeline-dispatch-policy}.test.ts`.

---

## 9. Phasing

- **Phase 0 (shipped)**: dispatch service/gate extraction, `JobPayload`
  attribution, shared contract + SSE event.
- **Phase 1 (shipped)**: cron + run-now, linear chains with
  `on: success|failure|always`, approval gates (in-app card + timeout arm),
  run JSONL + projections, CRUD/preview/approvals routes, reconciliation,
  full FE tab (rail / canvas editor / runs / inbox), chat card variant.
- **Phase 2**: clarify-await (jobId re-pointing instead of
  `awaiting_clarify_unsupported`), A3 approval-await integration (consumes
  the runner-axis `pendingApproval` seal), per-step `retry`, `remindAfter`
  re-arms, `{{steps.*}}` output substitution, event triggers
  (`runCompleted` — pipeline→pipeline chaining).
- **Phase 3**: per-(project, customJobRef) duplicate-gate relaxation +
  tenant concurrency slots, parallel branches/fan-in + FE turn grouping,
  free-DAG canvas editing, `cancelPrevious`, caps admin surface.
- **Backlog (user-locked)**: Slack/email channels, webhook triggers.

---

## Read next

- [44-universal-job.md](44-universal-job.md) — the runtime a step executes on.
- [45-mcp-orchestration.md](45-mcp-orchestration.md) — §4's design
  constraints that shaped this doc; in-job reporting stays an MCP tool.
