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

Two disjoint disk trees (`core/pipelines/paths.ts`), both SSOT:

**Definitions are scoped TEMPLATES** — the agents scope model
(`core/pipelines/scopeRoots.ts` mirrors `customAgents/scopeRoots.ts`, minus
builtin and the env escape hatch), merged closest-wins:

```
personal: {ws}/{org-anchored}/{user}/.ant/pipelines/{pipelineId}/   ← team kind anchors under INDIVIDUAL
org:      {ws}/{orgId}/.ant/pipelines/{pipelineId}/                 ← team kind only, ACL-governed
  each definition dir holds: pipeline.yaml + owner.json (authorship coords)
                             + availability.json (enabled/disabled state machine)
ACL:      {ws}/{orgId}/.ant/pipeline-acl.json                       ← {owner, editors[]} per id
```

The org ACL shares ONE rule set with agents
(`helpers/orgAclStore.ts`: `canEditOrgResource` / `computeOrgResourcePermissions`
/ `createOrgGateResolver` — the former `orgAgentAclStore` generalized in
place; `agent-acl.json`'s on-disk format is unchanged). Promote is the agents
flow verbatim: team kind only, user-scope only, ACL entry FIRST then
`fs.rename` MOVE with best-effort rollback. Both anchor forks flow through
`core/config/tenantAnchor.ts::resolveTenantUserDir` — never a re-encoded copy.

**Activations are the SCHEDULING UNIT** and live in the ACTIVATOR's account,
anchored at the ACTIVE org context (NO individual fork — projectIds are only
unique per `{org}/{user}`, and an activation binds a project):

```
{ws}/{orgId}/{userId}/.ant/pipeline-activations/{projectId}/activation.json
{ws}/{orgId}/{userId}/.ant/pipeline-activations/{projectId}/runs/{runId}.jsonl
{ws}/{orgId}/{userId}/.ant/pipeline-activations/{projectId}/runs/index.jsonl ← 1 line per terminal run
```

A pipeline cannot live inside an agent directory because its steps cross
agents. **The definition itself is project-free** (def v2 — `projectId` was a
v1 field, now rejected loudly; `enabled` lives in the availability sidecar):
one definition may be activated by MANY users onto MANY projects
concurrently. The activation record is **self-describing**
(`PipelineActivation`: `pipelineId`, `pipelineScope`, `projectId`,
`activatedAt`, `activatedBy?`, reserved `featureId?`): it no longer sits
inside the pipeline dir, and `pipelineScope` PINS which scope root resolves
the definition at fire time — never closest-wins, so a later same-id
definition in a nearer scope cannot hijack a running schedule. One activation
per project is STRUCTURAL (one dir per projectId); absence = deactivated.
Runs colocate with the activation and SURVIVE deactivation (deactivate
unlinks only `activation.json`) — history belongs to the activator, and
billing follows: every step of a fired run bills the ACTIVATOR, whose
standing is re-judged per dispatch. Every step's session/artifacts land in
the bound universal container.

**Availability (`availability.json`, missing = disabled/draft)** gates
ACTIVATABILITY, not execution, and binds the whole write surface:
- editing / deleting / promoting a definition requires **disabled**;
- activating requires **enabled**;
- disabling requires **zero activations** — never cascaded, never
  force-deactivated (not even by an org admin): holders deactivate
  themselves, and the 409 lists them.

Consequence: a definition can never change while any activation exists, so
there is no "re-sync crons on save" machinery at all; in-flight runs are
additionally protected by the frozen `defSnapshot`. Two race guards close the
enable/activate window: disable re-scans after writing and rolls back if an
activation landed; activate re-reads availability after writing its record
and rolls back if the pipeline was disabled concurrently.

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

A step's `directive` is **optional**: an empty/absent one dispatches
`defaultStepDirective(intent)` (shared, English — single owner in
`@ant/shared/pipeline.ts`, synthesized by the coordinator before
`renderDirective`; the FE only hints that the default applies). A step's
`context` pins are container-relative paths **or artifact globs** in the
`hooks.stop` artifact vocabulary (`validateArtifactGlob`) — a glob addresses
the artifacts tree only and is expanded into concrete paths (newest-first,
bounded) inside `validateUniversalTurnMeta` under the coordinator's
`expandContextGlobs` flag. One owner; the interactive `@ctx` ingress never
passes the flag, so chat pins stay concrete-path-only. Zero matches fail the
step with the same `invalid-context-path` shape as a missing concrete pin.
This is the static chaining channel — an upstream step's stop-hook globs ARE
its output contract, so the FE suggests them as pins (`upstreamOutputs.ts`);
it is orthogonal to (and does not consume) the reserved `{{steps.*}}` axis.

Cron parsing is server-only (`core/pipelines/cron.ts`, `cron-parser@4` — the
same major BullMQ uses internally, so the preview and the firing cannot
drift). `@ant/shared` stays dependency-free by package doctrine, which is why
`getNextFires` is NOT next to the validator; the FE round-trips
`POST …/preview-fires`.

Redis keys (`REDIS_KEYS.PIPE`, all rebuildable):

Activation-unit keys are keyed by **project** (one activation per project is
structural), so one pipeline runs concurrently on many projects:

| Key | Role |
|---|---|
| `ant:pipe:run:{runId}` | live RunRecord JSON (single writer under the run lock; 7d past terminal) |
| `ant:pipe:active:{org}:{user}:{projectId}` | per-ACTIVATION overlap guard, value = runId (NX; released at terminal; reconciler heals a crash-orphaned guard) |
| `ant:pipe:fired:{org}:{user}:{projectId}:{fireEpoch}` | fire idempotency NX (48h) |
| `ant:pipe:job:{jobId}` | jobId → (runId, stepId, projectId, owner) reverse mapping for the status consumer |
| `ant:pipe:hitl:{gateId}` / `ant:pipe:card:{cardId}` | armed gate record / card → gate reverse mapping |
| `ant:lock:pipe-run:{runId}` | per-run mutation lock |
| `ant:pipe:actv:{org}:{user}:{projectId}` | activation projection (JSON; 600s TTL, refreshed by reconciler + activate route) |
| `ant:pipe:proj:{org}:{user}:{projectId}` | projectId → pipelineId — **the job-start mutual-exclusion gate read** (same TTL/refresh; a lapse fails OPEN, never closed) |

There is deliberately NO Redis reverse index `pipelineId → activations`: the
remaining consumers (activation lists, the disable gate, the reconciler) use
bounded disk scans (`listAccountActivations` per account,
`findActivationsForPipeline` = one readdir per org member), so no extra
consistency surface exists to drift.

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

Fire semantics (`PipelineRunCoordinator.handleFire`, addressed by
`(activator, projectId)`):
- **Activation is the fire authority**: no `activation.json` ⇒ the fire is an
  orphan scheduler and skips (the reconciler removes the cron entry); an
  `activation.pipelineId` mismatch means the project switched pipelines after
  the fire was armed — stale, skip. The definition resolves ONLY at the
  activation's pinned scope (`resolveDefRoot(ctx, activation.pipelineScope)`);
  a disabled or unresolvable definition skips (defensive — the availability
  machine forbids reaching this live). The run's `projectId` and
  `activationSnapshot` are frozen at fire time, exactly like `defSnapshot`.
- `maxConcurrentRuns` is enforced at fire (skip + log, caps doctrine) by
  counting the activator's live runs across their activations.
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
the function. It scans the ACTIVATION dirs
(`{ws}/*/*/.ant/pipeline-activations/*` — definition dirs are never scanned
for scheduling), resolves each activation's definition at its pinned scope,
and upserts one scheduler per enabled+resolvable activation
(`schedulerId = pipe|{org}|{user}|{projectId}` — the projectId keying means
switching a project's pipeline upserts the SAME scheduler, no orphan window).
A broken activation (missing/invalid/disabled def) is unscheduled and logged,
never auto-deleted — the API surfaces it as `state: 'broken'` and the
activator deactivates it from the Execution view. Orphan scheduler ids with
no disk counterpart are removed (this sweep also garbage-collects pre-1.6
pipelineId-keyed ids). Activate/deactivate routes upsert/remove
synchronously; reconciliation is the safety net for hand-edited files and
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

### Mutual exclusion — an active pipeline OWNS its project

Unattended runs must be neither superseded nor delayed by a human, so the
exclusion is total and three-directional:

1. **Activate requires a quiet project.** `POST /:id/activate {projectId}`
   gates in order: enabled (409 `pipeline-disabled`) → universal project
   (400 `project-not-universal`) → project free (409
   `project-has-active-pipeline` — the PROJECT side stays ≤1; the pipeline
   side is unbounded, more projects welcome) → NO live job of any kind,
   running or paused (409 `project-has-live-job`, via
   `findDuplicateActiveJob` unfiltered).
2. **Interactive starts are rejected while activated.** Every job-start path
   (`execute`, `resume`, `continue`, `inline-ask`) re-judges
   `findProjectPipelineActivation` (`core/scheduling/UniversalDispatchGate`)
   and answers 409 `project-pipeline-active` (+ a chat conflict line on
   execute). The gate reads the `ant:pipe:proj` PROJECTION — disk stays SSOT;
   a Redis flush with a dead reconciler fails OPEN for ≤10 min, an accepted
   trade-off. This gate is a SEPARATE axis from `decideProjectJobGate`
   (project×jobType truth table) — never fold it in there. This structurally
   removes the old defect where an interactive execute could supersede-kill a
   paused pipeline step.
3. **The write surface is availability-locked** (§1): PUT/DELETE/promote
   answer 409 `pipeline-enabled` while enabled, and disable answers 409
   `pipeline-has-activations` while anyone holds an activation — so an
   activated definition is transitively immutable. Deactivation (own
   activation only, `{projectId}` addressed): cron off → live run cancelled +
   running step jobs killed (`coordinator.deactivate` mirrors the
   `/jobs/:id/stop` legs) → `activation.json` unlinked (runs stay) →
   projections cleared → SSE.

The coordinator itself never calls the exclusion gate — the pipeline is
exempt from its own lock. The project-level duplicate gate's **bounded
re-arm** (60s × 60) survives as a safety net only: with interactive starts
rejected, the one remaining collision is the seal race between a finishing
step's job and the next dispatch.

`JobPayload` carries attribution: `firedBy?: 'user'|'schedule'|'chain'`,
`pipelineRunId?`, `pipelineStepId?` — persisted onto `JobStatusData` and
`JobProjectMapping` so kanban/chat surfaces can badge pipeline work. Run
history is owned by the run JSONL — never duplicated into job records.

### Chat parity — a step is a first-class turn

`dispatchJobStep` mints a `turnId` and appends a durable, live-broadcast
`user_turn` (with `pipeline` attribution on the line —
`ChatUserTurnLine.pipeline`) BEFORE enqueue, passing it as `seedTurnId` so
the worker's copy dedupes — same contract as `/chat/user-message`. The run's
first step also carries a "run started" `system_notice` on that turn, and
`finalizeRun` anchors a completed/failed/partial/cancelled notice to the LAST
step turn (doc §5 anchor rule: no rootless lines; a run that never dispatched
a job step emits nothing). The coordinator forwards `stateTracker` into
`UniversalDispatchService` — parity with the HTTP path's in-memory kanban
cache.

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
mid-step (clarify end-and-resume re-dispatches under a new id — shipped, §5b) while
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
`awaitingClarify` is NOT an outcome: the step parks `awaiting_clarify` until
a human answers (§5b). The DAG the run executes is the
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

## 5b. Clarify HITL — jobId re-pointing, open-ended wait

A step job that ends with a sealed `awaitingClarify` (universal
end-and-resume, doc 44) did not fail and did not succeed — it asked a
question. The coordinator reads the seal (`getSessionFilePath` — never a
hand-rolled join) and parks the step:

```
seal detected → enterAwaitingClarify (guard: running ∧ same jobId)
              → step 'awaiting_clarify' + ClarifyRecord {clarifyId, jobId, question, round}
              → run 'awaiting_human' (chat lock + ant:pipe:active stay held)
answer       → applyClarifyAnswer (guard: awaiting_clarify ∧ clarify.jobId match)
              → step 'dispatched' → dispatchJobStep(…, directiveOverride = answer)
              → NEW jobId (runner's dangling-tool_use detection = structural resume)
```

- **Funnel key is `ant:pipe:job:{jobId}`** — the reverse map written at
  dispatch is deliberately NOT deleted while awaiting (it dies only after the
  answer lands, gate-precedent post-apply ordering). Its TTL and the run
  projection's are re-set to the `ACTIVE` bound (30d) on entering the wait —
  `saveRun` derives the TTL from awaiting state, so an open-ended human wait
  never outlives its own projection.
- **Two answer channels, one authority.** The chat clarify card (child-minted,
  carries `customJobRef`) resolves through the NX choice-resolved and then the
  `clarifying` branch calls `applyClarifyAnswer` — interactive clarify cards
  no-op instantly (no `ant:pipe:job` mapping). The inbox/API channel is
  `POST /api/definitions/pipelines/runs/:runId/steps/:stepId/clarify` (own-run
  `hasRunLog` check). The coordinator's status guard is the double-submit
  authority; an API-path answer leaves the chat card visually open but inert
  (a later click no-ops). The FE card skips `runJob` on a pipeline-owned
  project — dispatch is the coordinator's, and the interactive route would
  409 anyway.
- **The wait is open-ended — no timeout arm.** Pipelines are long-running by
  design; the escape hatches are run cancel (sweeps `awaiting_clarify`,
  deletes the funnel key) and deactivation. Waits beyond the 30d `ACTIVE`
  bound fall into the same pre-existing limit as any 30d run.
- **Multi-round works by construction**: the resumed job may seal
  `awaitingClarify` again under its new jobId → round+1 re-entry. The
  `clarifyRoundsUsed` budget (3) is per-(agent, job) session, shared with
  interactive use — exhaustion degrades gracefully (the agent stops asking).
- Stale outcome-retries cannot clobber a waiting step (`applyOutcome` refuses
  `awaiting_clarify`); a lock-starved park re-arms via the bounded
  `clarify-enter` control job (`outcome-retry` parity).
- Clarify waits ride the approvals inbox as `kind: 'clarify'` rows
  (`gateId`/`cardId` carry the clarifyId) with an inline answer form; JSONL
  events reuse `awaiting_human` / `human_resolved` with
  `detail.kind = 'clarify'`.

**Run-log visibility**: the activation's `runs/` dir is grafted into the
universal artifacts tree as the reserved read-only `pipeline-runs` node
(`getPipelineRunsRootOf` — structural containerPath↔actRoot mapping, no
activation required, so history stays browsable after deactivation). Every
artifact mutation route blocks the prefix (`reserved-name-pipeline-runs`);
delete is blocked outright, root-clear included — the run log is the record.

---

## 6. Identity, billing, tenancy

**Activator delegation** (user-locked): the scheduling identity is the
ACTIVATOR's — an activation's presence under their account root IS the claim,
its coordinates ride the fire job data (never a token), and the fire path
builds `UserContext` from them directly (the HTTP execute path's JWT
extraction has no scheduler equivalent, by design). All fired work bills to
the activator; per-step gates above are what keep a revoked activator from
continuing to spend — an org member who leaves keeps firing until
`checkTeamMembership` fails their steps, and only THEY (in their own context)
can deactivate. The definition's `owner.json` is authorship bookkeeping only;
edit authority for org pipelines is the ACL (`pipeline-acl.json`), exactly
the agents model.

Caps are first-class (`DEFAULT_PIPELINE_CAPS` in shared): `maxPipelines` 20
(personal creations), `maxStepsPerPipeline` 20, `minCronIntervalMinutes` 5
(enforced by sampling the next 10 fires — the expression is judged by what it
does), `maxConcurrentRuns` 3 (enforced at fire — skip + log — by counting the
activator's live runs across their activations).

---

## 7. HTTP / FE surface

Routes (`pipelines.routes.ts`, mounted **account-scoped `/api/definitions/pipelines`** —
definitions are cross-project): list (scope-merged closest-wins; entries
carry `scope` / per-caller `readonly` / `enabled` / `org` permission
projection / `activations: PipelineActivationView[]` — own rows plus, for
org-scope pipelines, other members' rows with `mine: false`; the response
also carries `orphanActivations`, own activations whose pinned def no longer
resolves; server-computed `nextFireAt` — the FE never parses cron) · create
(personal root, DISABLED draft, cross-scope id collision 409) / get / put +
delete (`findWritablePipeline` funnel: 403 `org-pipeline-forbidden` per ACL;
409 `pipeline-enabled` while enabled) · `enable` (re-validates the def — a
broken draft never publishes) + `disable` (409 `pipeline-has-activations`
listing holders; post-write re-scan rollback) · `promote` / `permissions` /
`editors` (accountAgents mirror) · `activations` · `activate` / `deactivate`
/ `run-now` (all `{projectId}`-addressed; run-now 409
`pipeline-not-activated` / `existingRunId`) · `activatable-projects` ·
`preview-fires` · `runs?projectId=&userId=` (per-activation history; a
member's `userId` is readable for org-scope pipelines by live members,
read-only) + `runs/:runId` (own runs only — the caller's own run log must
exist; `?projectId=` disk fallback) + `runs/:runId/cancel` (own only) ·
`approvals` (the caller's own activations) + `approvals/:gateId`. The one
project-scoped read is `GET /api/projects/:projectId/active-pipeline` →
`{ active: ActivePipelineInfo | null }` — the chat surface's lock signal.

SSE: ONE `pipeline` event, cause-discriminated
(`runUpdate | approvalRequested | approvalResolved | defChanged |
availabilityChanged | activationChanged`) — the gitState pattern.
`activationChanged` carries `activation | null` + `activatedBy` plus the
projectId (on deactivate: the PREVIOUS project, so the FE can clear its
lock). Published **user-scoped** (no projectId on the envelope) so the
approvals inbox folds even while another project is open; org members see
each other's activation changes on refetch (panel bootstrap), not live — v1.

FE (`presentation/components/Pipelines/`): the `pipelines` main-panel tab is
ACCOUNT-scoped — it renders regardless of the selected project, survives
project switches (`identityTransition` no longer closes it), and its GNB
entry is a standalone launcher button (Waypoints icon + label) to the RIGHT
of the Agents/Code segmented control, never inside it (it opens a tab, not a
view mode; no pressed state). The panel is an AgentSettings-style resizable
split — rail beside `PipelineWorkspace`. The rail follows the AgentTree
model: approval inbox pinned, then SCOPE GROUPS (`My pipelines` /
`Organization pipelines` — both headers always render, each with its own
empty copy; the org copy branches on team-active), rows with
Draft/Enabled/Running pills + per-caller readonly pill + activation count,
invalid rows, orphan-activation rows (deactivate-only), and the footer SPACE
toggle — Workspace / Codespace, icon-only when the rail is narrow; Codespace
is reserved and shows an unsupported notice (pipelines are Workspace-only
today; pure FE state, locally persisted). The workspace splits into TWO
views: **Wiring** (배선도 — the n8n-style canvas — reactflow + dagre —
trigger/step/gate nodes, insert-after "+" menus, inspector drawer; read-only
with a banner while enabled or shared-readonly; detail footer carries the
Enable/Disable card, `OrgAccessCard` + `PromoteZone` — the SHARED
`components/shared/org/` pair the agents screen also uses — and the danger
zone) and **Execution** (activation rows — own rows actionable with run-now /
deactivate / expandable per-activation run history via
`ActivationRunHistory`; members' rows read-only with the activator shown;
`broken` flagged — plus the "activate on project…" picker gated on enabled,
and the read-only live-monitor canvas). The standalone run-history view is
gone — history is a property of an activation. Every editor surface edits ONE
draft object (`pipelineSlice.pipelineDraft` vs `pipelineSavedDef`); saving is
gated by the shared validator client-side plus the `preview-fires` verdict;
selecting a pipeline keeps the current view (only a new draft forces Wiring).
Chat surfaces: `useChatPolicy` locks the input with `pipeline-active` /
`pipeline-running` (judged BEFORE `isRunning`), `PipelineActiveBanner` sits
in the chat input, the stop button on a pipeline step confirms and routes to
`cancelPipelineRun` (never raw stopJob), and pipeline-originated turns / the
work board carry `PipelineOriginChip`. The `pipeline_approval` chat card is a
standard ChoiceCard variant. UI-authored definitions stay implicit-linear
(`needs` omitted); an explicit-`needs` DAG still renders, but node insertion
degrades to append (v2 opens free-DAG editing on the same wire contract — no
migration).

The canvas is not the only author. A universal job that declares an `apis`
self entry composes definitions through the same
`POST|PUT /definitions/pipelines` routes under the self-api pin — reading a
finished agent's jobs and intents from `/definitions/agents`, writing the DAG,
and checking the trigger through `preview-fires`. The **`pipeline-builder`
builtin** (`core/data/agents/pipeline-builder/`, doc 44's authoring split — it
owns exactly the half `agent-builder` filters out: schedules and cross-intent
run order) is this path's shipped consumer; a user-scope pipeline-authoring
agent works identically, because the pin admits by `declaresSelfApi`, which
reads the DEFINITION, not the scope. Its allow list mirrors the pin route for
route (agents resource GET-only — the lane guard in
`tests/customAgents/builtin-agents.test.ts` pins both builtins' halves).
Everything such a job writes lands as a disabled draft and stays immutable
once enabled, so the availability machine (§1) is what makes machine authoring
safe: the job drafts, a person publishes and activates. There is no YAML
import route and none is needed — the API takes `{ id, def }` as JSON, and the
agent composes `def` directly.

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
  must always be able to rebuild them from the definition + activation trees.
- **A second gate-resolve path.** Every channel (card, inbox, API, timeout,
  future magic-link) goes through `appendChoiceResolved`'s NX and then
  `applyResolvedGate`. Two paths = double-applied gates.
- **Silently ignoring a definition key.** Reserved knobs get an explicit
  "not supported yet" validation error.
- **Cron parsing in the FE or in `@ant/shared`.** Server-side only
  (`core/pipelines/cron.ts`); the FE round-trips `preview-fires`. A
  presentational describer (`ant-ui Pipelines/cronDescribe.ts`) that
  pattern-matches the expression TEXT for display is fine — the ban is on
  fire-time computation, and anything the describer does not recognize falls
  back to the raw expression.
- **Storing tokens for scheduled identity.** Owner coordinates only.
- **Folding the pipeline exclusion gate into `decideProjectJobGate`.** It is
  an orthogonal axis (project ownership, not project×jobType) — a separate
  named gate (`findProjectPipelineActivation`), re-judged per start.
- **Promoting `ant:pipe:actv` / `ant:pipe:proj` to source of truth, or making
  the exclusion gate fail closed.** `activation.json` is SSOT; the TTL'd
  projection lapse must fail OPEN (a dead reconciler must not brick every
  project's job starts).
- **Dispatching a step without its chat turn.** The user_turn (pipeline
  attribution + seedTurnId) precedes enqueue; a step invisible in chat
  regresses the observability axis this overhaul added.
- **Raw-stopping a pipeline step's job from the FE.** The chat stop control
  must confirm + `cancelPipelineRun`; a raw stop kills the step under the
  scheduler and the run seals `failed(interrupted)` instead of `cancelled`.
- **Cascading or force-deactivating on disable.** Disable refuses while ANY
  activation exists (`pipeline-has-activations`, holders listed) — not even
  an org admin may kill another member's activation; they deactivate
  themselves. No hidden "clean up their binding" path. The ONE carve-out is
  the **project delete/rename cascade** (`stopProjectRuntime`'s
  `pipelineCleanup` step): the binding's project itself is going away, and
  activations are keyed under the activator's own account, so only the
  deleting user's binding can exist there — without the sweep the reconciler
  re-registers the cron forever against the dead project. The cascade calls
  the same `deactivatePipelineBinding` legs as the deactivate route (one
  deactivation authority — never a second leg copy).
- **Resolving a fired definition closest-wins.** The fire/reconcile path uses
  ONLY the activation's pinned `pipelineScope` — falling back across scopes
  lets a same-id definition hijack a running schedule.
- **Auto-deleting a broken activation.** Missing/invalid defs unschedule and
  surface as `broken`; the activation file is the activator's to remove.
- **A second ACL rule set.** Pipelines and agents share
  `orgAclStore.ts` (`canEditOrgResource` / gate resolver) — a diverging copy
  re-opens the per-caller-authority drift the generalization closed.
- **Widening the self-api pin past the DEFINITION surface.** A pipeline-
  authoring agent reaches this API with a `scope: 'self-api'` token, and
  `createSelfApiScopeGuard` admits exactly the authoring shapes, relative to
  `/definitions/pipelines`: `GET|POST` on the root, `GET|PUT|DELETE` on `:id`,
  `GET :id/permissions`, `POST preview-fires`, `GET activatable-projects`. Everything else — `enable`,
  `disable`, `activate`, `deactivate`, `run-now`, `promote`, `editors`,
  `approvals/**`, `runs/**`, `download` — is a person's decision and stays
  refused: activating takes a project over (§3) and running one spends the
  activator's credits (§6), neither of which an LLM-composed call may do. The
  list is **deny-except** for exactly that reason — a route added to
  `pipelines.routes.ts` later is refused until someone lists it on purpose.
  A `:id` rule must exclude the reserved literals (`preview-fires`,
  `activatable-projects`, `approvals`, `runs`): Express separates them by
  registration order, the guard matches independently.
- **Relying on the definition's `allow` list to keep a job out of the
  operational surface.** It is user-editable and one save away from `* *` —
  and a pipeline-authoring agent is user-authored, so its `allow` is whatever
  its owner saved. The bound is the guard, never the list.

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

Guards: `tests/pipelines/{pipeline-def-validation,chain-executor,pipeline-dispatch-policy,pipeline-activation}.test.ts`,
`tests/http/pipeline-routes-policy.test.ts` (availability machine, activate
gate order, multi-project activation, promote/ACL, per-caller readonly,
org-visible activations);
FE: `tests/store/pipelineActivation.test.ts`, `tests/chat/chatPolicyPipelineActive.test.ts`,
`tests/store/identity-transition.test.ts` (pipelines tab survives project switches),
`tests/components/pipelineOriginChip.test.tsx`.

---

## 9. Phasing

- **Phase 0 (shipped)**: dispatch service/gate extraction, `JobPayload`
  attribution, shared contract + SSE event.
- **Phase 1 (shipped)**: cron + run-now, linear chains with
  `on: success|failure|always`, approval gates (in-app card + timeout arm),
  run JSONL + projections, CRUD/preview/approvals routes, reconciliation,
  full FE tab (rail / canvas editor / runs / inbox), chat card variant.
- **Phase 1.5 (shipped — the definition/activation overhaul)**: def v2
  (projectId/enabled → `activation.json`, 1:1 both ways), account-scoped
  `/api/definitions/pipelines` + `active-pipeline` read, three-directional mutual
  exclusion (quiet-project activate gate, `project-pipeline-active` job-start
  gate, `pipeline-activated` edit/delete lock, deactivate = cancel + kill),
  chat parity (pre-enqueue user_turn + run lifecycle notices + stateTracker),
  readable attribution end-to-end, FE three-view workspace (editor /
  execution / run history) + standalone GNB launcher + chat lock
  banner/policy, defect fixes (`ant:pipe:active` healing, `maxConcurrentRuns`
  enforcement, outcome-retry on lock starvation).
- **Phase 1.6 (shipped — the scoping/multi-activation overhaul)**:
  definitions became scoped templates (personal + org roots, agents
  precedent; `orgAclStore` generalized in place; promote/permissions/editors
  mirror), the ACTIVATION became the scheduling unit (self-describing record
  in the activator's account keyed by projectId; N activations per pipeline,
  one per project structurally; runs colocate and survive deactivation;
  billing/identity = activator), the AVAILABILITY state machine replaced the
  edit lock (enable = publish, disable = reclaim, disabled-only writes,
  holder-gated disable — no cascade), org-visible activation rows
  (`mine: false`, read-only), projectId-keyed schedulers/projections (same
  pipeline runs concurrently across projects), FE two-view workspace (Wiring
  배선도 / Execution with per-activation history — the standalone run-history
  view retired), scope-grouped rail + Workspace/Codespace space toggle
  (Codespace reserved), shared `components/shared/org/` Promote/OrgAccess
  cards.
- **Phase 1.7 (shipped)**: clarify-await (§5b — `awaiting_clarify` step
  state, jobId re-pointing, open-ended wait, two-channel answer funnel) and
  the read-only `pipeline-runs` artifacts-tree graft.
- **Phase 2**: A3 approval-await integration (consumes
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
