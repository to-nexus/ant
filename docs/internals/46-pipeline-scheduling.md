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
answers 400, the editor form-disables). The gate-anchor rule (an approval step
must have an upstream step — its chat card anchors to the producing job's
turn) is pure structure and lives in the SHARED validator, so the FE save gate
catches it too. The one server-side rule that needs I/O lives in
`validatePipelineDefServer` (`core/pipelines/store.ts`): the cron
minimum-interval cap.

**Unknown and reserved YAML keys are rejected loudly** (`retry`,
`remindAfter`, `overlap: cancelPrevious`, `{{steps.<id>.verdict}}` templates
each get a "not supported yet" message) — an author must never conclude a
silently ignored knob works. Directive templating is a whitelist substitution
(`{{trigger.fireDate}}`, `{{trigger.fireEpoch}}`, `{{run.id}}`,
`{{run.prevSuccess.fireDate|fireEpoch}}` — the previous completed run's
epoch, frozen onto the RunRecord at fire, empty on the first run — plus the
step-output grammar below), never a template engine. **Context pins render
the STATIC vars too**, before glob expansion/existence checks
(`renderStaticVars` in the coordinator) — `reports/{{trigger.fireDate}}/**`
gives a business-key-partitioned manifest run-scoped pin isolation;
`{{steps.*}}` stays directive-only (a pin expands once at dispatch and cannot
carry another step's output — the validator refuses it).

Because that whitelist is CLOSED (`PIPELINE_TEMPLATE_VARS` +
`PIPELINE_STEP_OUTPUT_FIELDS` = 7 forms; anything else is a save error), the
inspector can present it in words rather than as raw tokens.
`Pipelines/templateTokens.ts` is the FE's one owner: `STATIC_TOKENS` /
`STEP_OUTPUT_TOKENS` are keyed as `Record` over those shared unions, so adding
a token upstream without labelling it is a TYPE error rather than a drift a
name grep might miss — two hand-copied lists used to answer "which variables
may I use here" and the pin's had lost the `run.prevSuccess.*` pair that
`pinTemplateErrors` accepts. `availableStaticTokens(def)` is now the single
gate for BOTH surfaces (`run.id` always; `trigger.*` with any trigger;
`run.prevSuccess.*` on a schedule — a manual-only pipeline has no previous
fire). Chip faces carry the human label with the raw token in the tooltip, and
clicking still inserts the raw token; `segmentTemplate` (lossless by
construction — re-concatenating its segments reproduces the input) drives the
read-only `TemplatePreview` under the directive box, which renders each
occurrence as the words it means, names a `{{steps.<id>.*}}` source by
`resolveStepIdentity`, and shows an unknown token or a dangling step ref as a
red pill rather than dropping it. The textarea remains the single buffer
holding the real bytes.

**Step-output substitution** (`{{steps.<id>.answer}}` /
`{{steps.<id>.artifacts}}`): on step completion the coordinator captures
`StepRecord.output` — the final assistant text of the seal's `session:main`
(jobId-guarded, canonical tags stripped via `stripRegisteredTags`,
`PIPELINE_STEP_OUTPUT_MAX_CHARS` = 16k, same bounded read as the clarify
detection) and the files THIS job wrote that satisfy its intent's `hooks.stop`
globs — read from the seal's own `lastTurnHooks[].matchedWrites`
(`core/pipelines/stepOutput.ts`), so on a domain-keyed glob
(`terms/*/notice-period.md`) the value is the run's own case, not every case in
the tree; the whole-tree `expandArtifactGlobsBounded` walk is only the fallback
for a seal carrying no write evidence (ledger-met hook, pre-record session).
The dispatch audit (`unresolvedTemplates`, `contextExpanded`) also lands on
`StepRecord.dispatch`, not only on the `step_dispatched` event. Capture is
best-effort: failure means an absent record, never a step failure. The
validator restricts references to the step's transitive `needs` closure
(never itself, never a gate) — the compile-time guarantee the referenced
step is terminal at render. A skipped/no-output upstream renders empty and is
recorded as `unresolvedTemplates` on the `step_dispatched` event. The rendered
directive stays under the existing `DIRECTIVE_MAX_CHARS` authority. SSE
`runUpdate` strips captured answers (the wire stays lean); the run JSONL and
the runs API serve them, and `finalizeRun`'s chat notice quotes the last
step's first answer line. This is the summary/scalar channel — structured
data still moves as artifacts + `context` pins (a producing intent writes a
manifest artifact and declares it in `hooks.stop`).

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
| `ant:pipe:runslots:{org}:{user}` | account-wide concurrent-run slot ZSET (member = projectId) — the `maxConcurrentRuns` fire gate (`reserveSlot`, count+reserve in one step; released at terminal under the holder check) |
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

> **An arm's BullMQ job id is never its logical id.** `armDelayed` stores arms
> as `{logicalId}#{seq}` and `cancelDelayed` clears every arm of the logical id,
> because BullMQ refuses to remove the job a worker is processing ("locked by
> another worker") and then silently ignores an `add` under an id that still
> exists. With a fixed id, any control job that re-arms ITSELF fired exactly
> once: `remindAfter` reminders stopped after the first, and the
> duplicate-block retry ladder stopped at round 1 — leaving the step
> `dispatched` with no error, no timeout and `MAX_DUPLICATE_RETRIES`
> unreachable (observed 2026-09-04; both halves reproduced against a scratch
> queue). The `#` delimiter keeps sibling ids apart, so `…-mail#…` never
> matches `…-mail-send#…`.

A hand-rolled tick loop (cron math + due-index ZSET + cluster lock) was
rejected: `Queue.upsertJobScheduler` (BullMQ 5.81.3) is natively
cluster-safe — the next fire exists as ONE delayed job in Redis and any
replica's worker collects it.

The `ant-pipelines` queue (`infrastructure/scheduling/PipelineQueue.ts`)
carries **control jobs only** — `fire`, `gate-timeout`, `gate-remind`,
`step-retry`, `step-timeout`, `outcome-retry`, `clarify-enter` — never
LLM work. Control jobs are idempotent (fire NX / gate NX downstream), so this
queue runs `attempts: 3` + backoff. **`ant-jobs` keeps `attempts: 1`** — that
invariant belongs to a different queue and is untouched (a BullMQ retry would
replay an LLM job's payload without `isResume`).

**`on.runCompleted` — pipeline→pipeline chaining**: fires when another
pipeline's run seals a matching terminal status (default `['completed']`;
`['failed']` is the error-workflow pattern). Scoped to the ACTIVATOR's own
activations (identity never crosses users, §6): `finalizeRun` scans
`listAccountActivations` (bounded disk scan — the no-reverse-index doctrine),
matches each activation's pinned definition, and `addNow`s the SAME fire path
with `firedBy: 'event'`, an un-rounded `fireEpoch` and `chainDepth + 1`;
`handleFire` skips past `MAX_CHAIN_DEPTH` (5) — the loop guard lives at fire,
caps doctrine. A pipeline never chains onto its own project — so a chained
definition can never pin the upstream run's artifacts (they sit in another
project's container); the builder contract forbids such pins and routes the
case through `{{trigger.*}}` and clarify. `schedule` and `runCompleted` may
coexist on one definition.

**The trigger block is optional**: a definition with no `on` is MANUAL-ONLY —
run-now is its only fire source, riding the identical fire path (activation
authority, overlap NX, caps — nothing forks). A manual-only activation
registers no scheduler; the reconciler still refreshes its `ant:pipe:actv` /
`ant:pipe:proj` projections and heals its overlap guard (the projection
refresh is deliberately DECOUPLED from the cron upsert — tying them together
would let the exclusion gate lapse permanently fail-open for manual-only
activations), and its orphan sweep compares against the set actually
UPSERTED, so a schedule removed by an edit is swept even while the activation
stays wanted.

Fire semantics (`scheduling/pipelineRun/fire.ts::handleFire`, addressed by
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

> **Non-occurrence is not an outcome, and abort ends the waits it orphans.**
> `always` judges the OUTCOME of a need, so a need that was skipped or
> cancelled does not satisfy it — matching it unconditionally made `always`
> the one edge that rejoins a branch and the one edge an abort cascade cannot
> stop: on 2026-09-04 an aborting run's `on: always` step consumed a
> *cancelled* need, dispatched a fresh job, and asked a human a question the
> run could no longer act on. `failure` keeps its "at least one need failed"
> shape (that is the error-handler edge); `always` now requires every need to
> have actually happened (succeeded or failed), and a root `always` step still
> runs. In the same cascade an ARMED gate stayed `awaiting_gate` while every
> step it guarded was cancelled — the inbox showed a decision with no
> consequence and the run could not seal (`awaiting_human` forever), so abort
> now cancels armed gates too, except those whose own `on` consumes failure
> (they ARE the failure path). The executor owns the state change; the
> coordinator's `mutateRun` funnel takes down the timeout/remind arms, the
> HITL record and the card for every step a plan turns `cancelled` while it
> still held an undecided gate, and appends a `step_completed`
> (`outcome: 'cancelled'`, `reason: 'gate-orphaned-by-abort'`) audit line.

**Verdict routing** (`on: verdict:<name>`): the decision vocabulary is
declared on the INTENT (`infer.md` frontmatter `outcomes: [..]` — the
business knowledge lives in the agent definition, never per-pipeline). The
universal runtime injects a verdict band into outcome-declaring turns and the
respond seal lifts the final reply's `<verdict>` tag (registered in the
output-tag matrix); `captureStepOutput` validates it against the declared
vocabulary and stamps `StepRecord.verdict`. No valid verdict = the step FAILS
(`missing-verdict`, retryable) unless the step's `onMissingVerdict` names a
fallback outcome. The executor's `verdict:` predicate matches a need that
SUCCEEDED with a verdict the edge names — `verdict:a|b` is the disjunction
form (`verdictEdgeOutcomes` in `@ant/shared` is the one parse site; the
catalog gate judges EVERY member, so a typo'd member errors as half a branch
that always skips). Non-matching branches skip and skips cascade, which is
the whole switch semantics ("new chain edge predicates = executor-only
changes", §8 Correct). The disjunction exists because a step owed to two of
three outcomes otherwise forces either step replication (two ids, one output
name — the F30 trap) or an unconditional step that re-judges what the
verdict already decided (observed live: a builder dropped ALL verdict edges
rather than replicate).

**At most ONE job step is in flight per run** (dispatched / running /
awaiting_clarify). Every step dispatches into the same project, so the
project-level duplicate gate would serialize ready siblings through bounded
60s re-arms — a valid fan-out definition could fail (`duplicate-job-timeout`)
purely on a sibling's duration. The executor defers ready job steps instead
(they stay `pending`, dispatched in file order on the blocker's seal event);
gates hold no project slot and still arm eagerly, and skip/cancel judgments
stay eager so cascades propagate immediately. `awaiting_clarify` counts as
in-flight because the answer re-dispatches that same step OUTSIDE the planner.
Consequence: fan-out expresses routing and failure isolation, not concurrency
— true parallel dispatch arrives with Phase 3's duplicate-gate relaxation, as
an executor-only change. The duplicate gate stays as the seal-race safety net
(a finishing job's status record lagging its pub/sub event), absorbed in 1–2
re-arms.

**FlowProducer was rejected**, not overlooked: ① a step's jobId can change
mid-step (clarify end-and-resume re-dispatches under a new id — shipped, §5b) while
a Flow tree is frozen at enqueue; ② a human gate can wait weeks, holding Flow
parent state hostage to queue retention; ③ this repo's rule is pub/sub
fan-out, never BullMQ-internal hooks; ④ the per-project duplicate gate needs
self-paced sequencing anyway — eager child enqueue is actively harmful.

The coordinator (`infrastructure/scheduling/PipelineRunCoordinator.ts` — a
delegation facade over the `pipelineRun/{fire,dispatch,gates,outcome,hitl,
lifecycle,runStore,seals,render,types}.ts` modules; cross-cluster calls ride
the `PipelineRunOps` ctx) is an
ADDITIONAL subscriber on `job:status:updates` (note: no `ant:` prefix —
`CHANNEL_DOMAINS.JOB = 'job'`), beside RouteConfigurator's. It resolves
`ant:pipe:job:{jobId}`, takes the per-run lock, applies the executor's plan,
dispatches what unblocked, appends JSONL, publishes SSE. An interruption
(pause) on a pipeline job is a step **failure** (`interrupted: {reason}`) —
unattended chains have nobody to resume — and the coordinator KILLS the
parked job (`killStepJob`): a paused job blocks the project's next dispatch
(the S7 signature), and the run already owns the verdict. One exception
earns a round instead of failing outright: `universal_stop_hook_unmet` gets
a single nudged re-dispatch (`HOOK_UNMET_RETRY` — budget floor 1, no
declared `retry` needed, preamble telling the model to ask through the
clarify tool or finish the artifact); it is interactive chat's "Resume to
continue", automated once, for the model that asked in prose and ended the
turn. A job that completes but sealed
`awaitingClarify` is NOT an outcome: the step parks `awaiting_clarify` until
a human answers (§5b). The DAG the run executes is the
**frozen `defSnapshot`** compiled at fire time — editing the YAML never
mutates an in-flight run.

---

## 5. HITL gates — one resolve funnel, durable timeout arms, zero polling

Three HITL rails, one taxonomy: an **approval gate** is an AUTHORED decision
node (a def step — armed eagerly, holds no project slot, binary
approve/reject routes succeeded/failed); **clarify** (§5b) is a RUNTIME
information request the executing job raises — the answer re-dispatches the
SAME step with a new jobId; **tool approval** (§5c) is a RUNTIME grant on an
approval-gated tool call — approve re-dispatches with a one-turn grant. All
three park the run `awaiting_human` and resolve through the ONE NX
choice-resolved funnel.

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

### 5a. Per-gate approvers — non-activator resolution (doc 48 D3 gap ①)

**Approval authority is PER GATE, and it lives on the ACTIVATION** —
`PipelineActivation.approvers?: Record<stepId, userId[]>` (lowercase org-member
ids, cap `DEFAULT_PIPELINE_CAPS.maxApproversPerGate`). Never the definition:
definitions are shared org templates, frozen while activated (which also pins
the gate-id key set for the activation's lifetime), and a name in the template
would force an org-wide deactivate to swap one approver. A gate absent from
the map = activator-only, exactly the pre-approver behavior.

- **Write funnel**: the `activate` body's optional `approvers`, and
  `PUT /definitions/pipelines/activations/:projectId/approvers` (activator
  only, no deactivate needed). Both validate keys against the def's approval
  step ids (`validatePipelineActivation(raw, { gateStepIds })` — loads WITHOUT
  gateStepIds stay lenient, sidecar restores must not throw) and re-check
  every listed member's LIVE org membership. A successful PUT re-fires
  `approvalRequested` for currently-armed gates to the new roster (S9). The
  route is OUTSIDE the self-api pin's allow list, and `activations` is a
  reserved `:id` literal — a job never grants approval rights.
- **Resolve authority** (`POST …/approvals/:gateId`): owner as before; a
  non-owner passes ONLY when the HITL is not `kind:'tool'`, same org, on the
  gate's roster **re-read live from the owner's activation.json**, and still a
  live member (fail-open on repo error, the `checkApproval` posture). Tool
  approval and clarify stay activator-scoped in v1. The chat leg still runs
  with `userContext: hitl.owner` (the card lives in the owner's project); the
  decider rides `decidedBy` + `resolvedLabel: "Approved by {caller}"`. The NX
  loser's 409 carries `decidedBy` only when the winner's apply has already
  landed on the run record — in the tightest race the loser's re-read precedes
  it and the field is omitted (observed live; the FE tolerates absence). A
  re-resolve AFTER apply is 404, not 409 — the armed HITL record is gone
  (existence non-disclosure). An optional `note`
  (≤ `PIPELINE_GATE_NOTE_MAX_CHARS`) lands on `gate.decisionNote` and the
  `human_resolved` line — the reject-reason channel.
- **Notice fan-out has ONE owner**: `NotificationChannelPort`
  (`core/pipelines/notifications.ts`), called by the gate arm/remind/resolved
  legs per recipient — audience = {activator} ∪ approvers[stepId], the roster
  re-read from disk at every emission. v1 ships `InAppChannel` (the Transfer
  precedent: user-scoped SSE publish, fire-and-forget, `GET /approvals`
  refetch is the durability); Phase C adds Slack/email adapters whose inbound
  leg (HMAC magic-link `{cardId, choiceId, exp}`) lands in the same
  choice-resolved funnel with `via: 'magic-link'` — channel adapters never
  touch permission code.
- **Discovery, not authority**: `ant:pipe:approver-of:{org}:{userId}` (JSON
  array of `{ownerUserId}|{projectId}`, TTL-bounded, reconciler-rebuilt,
  synced on activate/PUT/deactivate) feeds the approver's inbox scan
  (`listApproverPendingApprovals` — gate rows only, `role:'approver'` +
  `ownerUserId`) and the read-only run-detail branch
  (`approverRunAccess`: on any roster of the owning activation ∧ the owner's
  dir holds the run log). Every consumer re-verifies against the live
  activation, so a stale index entry grants nothing.
- **Observer surfaces**: `PipelineActivationView.approvers` (org-visible by
  design), `PipelineRunSummary.gates` (`{stepId, decision, decidedBy}` written
  at finalize — approval steps only, tool gates stay off the summary line).

Guards: `tests/http/pipeline-routes-policy.test.ts` (resolve decision table
S2/S6/S7/S8/S9 + roster ingresses), `tests/pipelines/pipeline-activation.test.ts`
(index sync/rebuild + `InAppChannel`), `tests/pipelines/pipeline-def-validation.test.ts`
(approver-map rows), `tests/http/account-agent-routes.test.ts` (self-api pin).

---

## 5b. Clarify HITL — jobId re-pointing, open-ended wait

> **The clarify budget bounds one dispatched turn-chain, not a session.**
> `UNIVERSAL_CLARIFY_BUDGET` (3) is a loop guard against an agent asking
> instead of working, so `inheritedClarifyRounds` carries the count only into
> the RESUME of a still-paused turn (`awaitingClarify`); a fresh turn — a new
> user message, a new step dispatch — starts at zero. Restoring it
> unconditionally turned it into a lifetime cap, and because every step of a
> pipeline shares ONE (agent, job) session across every run, three questions
> exhausted it permanently: on 2026-09-04 a run's `recipient-extract`,
> `publishing`, `mail-send` and `regulator-report` each recorded in its own
> deliverable that clarify was disabled and it had judged without user
> confirmation — `mail-send` listing the recipient count and send-HTML details
> as "needs operator correction". That silently voids the authoring pattern
> this contract recommends (the consuming step asks for the person's product
> through clarify).
>
> **A run is a memory boundary (fixed 2026-09-05).** The shared session had a
> second half: a step job inherited every previous RUN's conversation, so a new
> case's intake skipped its questions because the answers to a *different* case
> were already in context (same date, same project) — a run adopted another
> case's effective date, statute id and terms key without asking. The cross-run
> channels this design declares are explicit — the `{{run.prevSuccess.*}}`
> watermark and pinned artifacts — and a transcript is not one of them. So the
> STORED conversation channel is keyed by the run (`session:run:{runId}`,
> `core/customAgents/universalConversation.ts`), selected from
> `UniversalTurnMeta.runId` which ONLY the coordinator sets (the HTTP accept
> gate builds turn meta from the validator's `{intents, context, plan}`). The
> graph keeps working on `session:main` in memory — nodes stay channel-blind;
> the runner maps the stored channel in at restore and the seal maps it back
> out, carrying the interactive channel through untouched (the session state is
> replaced wholesale, so an omitted channel is deleted) and stamping
> `conversationChannel` for the out-of-process readers (the coordinator's
> `{{steps.*.answer}}` capture, the run-history input summary). Steps of the
> SAME run still share their channel — one run is one case; what a step owes
> the next is still artifacts + pins.

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

## 5c. Tool-approval HITL (L3) — the paused approval-gated call

> **A pause is not an interruption.** `handleJobCompletion` consults the
> clarify and approval seals only when the job's outcome is `succeeded`, so
> anything the runtime publishes as an interruption becomes a step FAILURE
> before the funnels are reached. A universal turn that pauses has by
> definition not finished its work, so its `artifact:` stop hooks are
> unreached — and `respond` used to report them as UNMET on an approval pause
> (clarify was exempt from the start; the hook manifest three lines below
> already exempted both). The job-runner then published
> `universal_stop_hook_unmet`, the coordinator failed the step, and
> `onStepFailure: abort` cancelled the run while the approval card sat live in
> the inbox — observed 2026-09-04 on an intake step whose intent declared an
> artifact hook and whose agent reached for `run_command`. Both pauses are now
> exempt. Any future pause kind must join that exemption, or it inherits this
> bug: reaching the funnel is conditional on NOT looking like a failure.

The third HITL layer: a step's job that issues an approval-gated tool call
(`tools.approval: always`, or a non-read-only MCP tool) no longer dies
fail-closed under the scheduler — pipeline dispatches ride
`UniversalTurnMeta.unattended: true` (set ONLY by the coordinator, never an
HTTP ingress), and the universal runtime PAUSES instead:

```
tool node: sole-call round + approval-gated + no grant
  → approvalPauseNode (clarifyPause mirror: dangling tool_use, normal completion)
  → respond seals { awaitingApproval, approvalToolUseId, approvalTool, approvalArgsSummary, approvalTurnContext }
coordinator: detectApprovalSeal → enterAwaitingToolApproval
  → step 'awaiting_gate' + kind:'tool' HITL record + pipeline_approval card (kind:'tool')
resolve (SAME NX choice-resolved funnel as approval steps):
  APPROVE → step 'dispatched' → dispatchJobStep(directiveOverride = decision text,
            approvalGrantTool = the tool) → NEW jobId; the runner closes the
            dangling call with the decision text and the gate admits that ONE
            tool for that ONE turn (turn-scoped grant)
  REJECT  → normal failed outcome (`tool-approval-rejected: {tool}` —
            `on: failure` consumes it); the leftover dangling call is healed
            by the runner's generic dangling-tool_use closure on the
            session's next turn
```

Multi-call rounds never pause: the gate rejection instructs the model to
re-issue the gated call ALONE (the clarify sole-call discipline), so exactly
one tool_use dangles. Interactive runs keep the fail-closed rejection — the
interactive approve flow is still future work, but it will consume the same
seal. The wait is open-ended (no timeout arm); run cancel and deactivation
are the escape hatches, and a lock-starved park re-arms via the bounded
`approval-enter` control job (clarify-enter parity). This is doc 44 §1.3's
"확인 스텝은 L3를 대체하지 못한다" answered at the platform level: an intent
may now keep `approval: always` on its risky writes and run under a pipeline.

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

Routes (`pipelines.routes.ts`, group modules under `routes/pipelines/*.routes.ts`
over a shared `context.ts`, mounted **account-scoped `/api/definitions/pipelines`** —
definitions are cross-project): list (scope-merged closest-wins; entries
carry `scope` / per-caller `readonly` / `enabled` / `org` permission
projection / `activations: PipelineActivationView[]` — own rows plus, for
org-scope pipelines, other members' rows with `mine: false`; the response
also carries `orphanActivations`, own activations whose pinned def no longer
resolves; server-computed `nextFireAt` — the FE never parses cron) · create
(personal root, DISABLED draft, cross-scope id collision 409) / get / put +
delete (`findWritablePipeline` funnel: 403 `org-pipeline-forbidden` per ACL;
409 `pipeline-enabled` while enabled; create/put responses carry
non-blocking `catalogWarnings` — the catalog-binding findings the
enable gate hard-fails on, PLUS def-structural advisories
(`collectPipelineDefAdvisories`: an approval gate no step needs — a
decision the run does not execute belongs in the report's Left to a person,
not in the graph) and
catalog advisories (`collectPipelineCatalogAdvisories`: pin-needs
coherence — a `context` pin whose producing step, identified by
exact stop-glob match, is not in the pinning step's needs closure
is wired by file-order luck; "what you pin, you needs"; a step pinning
its OWN intent's stop glob (the small-farming-medal shape: the entry step
pinned `terms/*/notice-period.md`, so a fresh project's first run died at
step 1 with `invalid-context-path` — the needs rule's self-filter had
silenced exactly that case); a `*` glob pin whose producer IS upstream while
the consumer's directive carries no `{{…}}` reference at all (the case
identity the run learned through clarify never reaches the consumer — the
small-farming-medal shape's second half); and, from the def-structural set,
an approval gate with neither `timeout` nor `remindAfter` (the authoring
contract's "reminder on gates whose timeout is long or absent", unenforced
until a live pipeline shipped two such gates); and an outcome-declaring step
that no `verdict:` edge reads and that carries no `onMissingVerdict` (the
smooth-mending-coral shape: four such steps, no `retry` — one forgotten
`<verdict>` tag fails the step and aborts a run that cleared two human gates,
for a decision nothing downstream consumes; routed steps are exempt because
there the fallback is a routing choice); and `entry-no-case-channel` — the
entry step of a manual or chained pipeline that pins nothing, carries no
`{{…}}` in its directive, and runs an intent declaring `clarify: false` on a
case-keyed (`*`) stop glob, so the run has no channel to learn its case and
proceeds on defaults (the rapid-killing-pilot shape). Judged on the explicit
intent-level knob only — the job/agent default is not in the summary, and a
`general` entry is not judged — and only on `*` globs, so a case-free
manual intent (fixed output path) stays silent. All of these are ONE structured
source, `collectPipelineAdvisoryItems` (`{ code, stepId, field, message }`) —
the string collectors map its `message`, the FE anchors the same item to the
step and field — and, on
`on.runCompleted` pipelines only, the inverse F34 shape: a pinless
job step whose needs-closure ancestors declare stop globs, because
the chain restriction "pin only what this pipeline's own steps
produce" gets over-applied to intra-pipeline pins; prompt-side
prose and a skeleton both proved unstable against it, so the save
advisory is the compensating control) that stay
advisory even at enable, so an authoring job (pipeline-builder)
self-corrects at save time) · `enable` (re-validates the def AND the
catalog binding — `validatePipelineCatalogBinding` against the ENABLER's
agent catalog: agent/job/intent existence, verdict-edge vocabulary,
`onMissingVerdict` vocabulary; a broken draft or a typo'd ref never
publishes, and a RE-enable after disable re-judges too) + `disable` (409
`pipeline-has-activations` listing holders; post-write re-scan rollback) ·
`promote` / `permissions` / `editors` (accountAgents mirror) ·
`activations` · `activate` (re-judges the catalog binding against the
ACTIVATOR's catalog — the one dispatch resolves against; catches the
enabled-then-agent-deleted drift window) / `deactivate` / `run-now` (all
`{projectId}`-addressed; run-now 409 `pipeline-not-activated` /
`existingRunId`; run-now is NOT catalog-gated — dispatch stays the
backstop) · `activatable-projects` · `preview-fires` · `download`
(rate-limited definition-folder ZIP; `owner.json` excluded) ·
`runs?projectId=&userId=` (per-activation history; a
member's `userId` is readable for org-scope pipelines by live members,
read-only) + `runs/:runId` (own runs only — the caller's own run log must
exist; `?projectId=` disk fallback) + `runs/:runId/cancel` (own only) ·
`approvals` (the caller's own activations) + `approvals/:gateId`. The one
project-scoped read is `GET /api/projects/:projectId/active-pipeline` →
`{ active: ActivePipelineInfo | null }` — the chat surface's lock signal.

SSE: ONE `pipeline` event, cause-discriminated
(`runUpdate | approvalRequested | approvalResolved | clarifyRequested |
clarifyAnswered | defChanged | availabilityChanged | activationChanged`) —
the gitState pattern. Clarify rows ride the same inbox fold as gates
(`approvalRequested` adds, `clarifyAnswered` removes by clarifyId).
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
split — rail beside `PipelineWorkspace` (rail width persisted under
`STORAGE_KEYS.PIPELINE_RAIL_WIDTH`). The rail is built from the SHARED rail
primitives in `components/shared/rail/` (`RailGroup` / `RailRow` /
`RailToolbarButton` / `RailIconSwitch` / `CollapseToggle` / `RailResizeHandle`
+ `toggleSetMember`) that `AgentTree` is built from too, so the two rails read
identically: the approval inbox is a collapsible `RailGroup` (ShieldCheck +
amber count), then the SCOPE GROUPS (`My pipelines` / `Organization
pipelines` — both headers always render, each collapsible, each with its own
empty copy; the org copy branches on team-active), rows carrying a Waypoints
icon tinted by availability plus awaiting / running / activation-count badges,
the per-caller readonly pill and the ⋯ folder-export menu; invalid rows;
orphan-activation rows (deactivate-only); and the footer SPACE switch
(`RailIconSwitch` Workspace / Codespace, label hidden when narrow; Codespace
is reserved and shows an unsupported notice — pure FE state, locally
persisted). A NEW draft is a phantom active row in the My group with an
`Unsaved` pill — the rail grammar has no "nothing selected" state.

The workspace has NO edit mode. `editable = draftIsNew || (!readonly &&
!enabled)` derives straight from the BE availability gate (PUT / promote are
refused while enabled); a locked canvas explains itself through the shared
`CanvasNotice` overlay (`canvas.lockedEnabled` / `editor.readOnlyShared`) and
node clicks are inert.

**The column is exactly two rows — `PipelineHeader` then the view body — and
NOTHING conditional may be added between them.** Anything that appears on an
edit and disappears on a save resizes the canvas and re-fits the graph, which
is what the save bar, the error strip, the advisory strip and the locked banner
each did (~76px for the bar alone, and again when advisories expanded). So the
header carries all four and its own height is fixed: the row is `flexWrap:
'nowrap'` with every control `flexShrink: 0`, the current-pipeline `Crumb` is
the only element that yields (`truncate` — it ellipsises rather than wrapping
the row), an overflowing row SCROLLS rather than clips (`overflowX: 'auto'`,
scrollbar hidden — measured live, a 556px canvas pane needed 771px and was
swallowing the view toggle whole, and `PipelineChangeSlot` sits LEFT of the
trash and the toggle so the primary action is the last thing to leave view),
`PipelineChangeSlot` renders nothing when clean (reserving its width cost
141px of exactly the budget that was overflowing; two controls shifting
sideways on the first edit is cheaper than clipping them, and the invariant
that matters is the canvas box, not the header's internal x-offsets), and
advisories / save errors are `Badge` + click-`Tooltip`
popovers (`AdvisoryBadge` / `AdvisoryList`; the popover scrolls, so the old
`COLLAPSED_ROWS` collapse is gone). The two canvas messages that remain —
locked and empty — are mutually exclusive by construction and share ONE
absolute overlay (`CanvasNotice`), never a flow block.

`PipelineWorkspace` still COMPUTES the save gate (it holds the three drafts and
cron validity) and passes it down; only the presentation lives in the header.
The shared `ConfigEditor/aurora/ChangedBar` is deliberately NOT used here —
agent settings mounts it inside a real scroll container where its `position:
sticky` works, and in this non-scrolling column it degraded to `relative`.
The header covers THREE drafts in `pipelineSlice`: `pipelineDraft` (definition,
vs `pipelineSavedDef`), `pipelineEditorsDraft` (org editors) and
`pipelineApproversDraft` (per-activation gate rosters, keyed by projectId).
`selectPipelineDirty` reports them as one `{ definition, editors, approvers[],
count }` (null when clean), `savePipelineAll` writes them in order — definition
(the only leg that mints an id and meets the enabled gate) → editors →
approvers, stopping at the first failure so what is left stays dirty for the
retry — and `discardPipelineAll` restores all three; `usePipelineDiscardGuard`
is the one owner of the "discard unsaved changes?" confirm (rail row select,
`+`, header root crumb, space switch). Save is gated by the shared validator +
the `preview-fires` verdict only while the DEFINITION leg is dirty
(`PipelineChangeSlot.canSave` + `blockedReason`, the reason as the button's
tooltip). **Wiring** (배선도 — the
reactflow canvas — trigger/step/gate nodes, insert-after "+" menus). Geometry
is the pure `canvas/layout.ts`: dagre LR ranks, serpentine-wrapped into rows
when the strip is wider than the measured pane (row 0 →, row 1 ←; odd rows
right-aligned so every turn is a vertical drop in the same column; dagre's y
offsets survive inside a row so fan-outs stay centred). Every node renders
four invisible handles (`in` / `out` / `in-top` / `out-bottom`) and every edge
addresses two of them; row turns are smoothstep, in-row edges bezier. Card
grammar keeps its channels apart — silhouette + accent = kind (trigger pill /
teal, job step rounded / violet, approval gate chamfered octagon / amber; the
`NODE_KIND_STYLE` table feeds the nodes, the legend and the inspector header),
border = live-run status, ring = selection, dot = advisory; edge stroke /
dash / label per condition is `edgeStyleFor`.

**The card's primary line is the PINNED INTENT, not the agent.** A pipeline is
usually several intents of one agent × job, so agent-then-job as the two
identity lines rendered every such step identically and put the only
discriminator in a 9.5px pill. `resolveStepIdentity` (`stepIdentity.ts`) is the
one owner of that answer — the canvas card, the inspector's step-output chip
groups and the directive preview all name a step the same way: `primary` = the
pinned intent (14px/700, wraps — an ellipsised name names nothing), falling
back to the JOB display name when no intent is pinned or it is the reserved
`general`, and to a placeholder when `customJobRef` is empty; `caption` =
`agent · job` (10.5px, single-line, truncating, with the raw
`{agentId}/{jobId}` in its title). The no-truncate rule protects the naming
line only — the caption is identical across sibling steps by definition, so it
is the half that may be cut. `estimateNodeHeight` (`canvas/nodeMetrics.ts`,
pure and reactflow-free so it is testable) is calibrated to that type scale and
must change with it in the same commit. The canvas re-fits only when
the structure key (node count, rows, bucket, bounding box) changes, never on
selection. Zoom controls are the shared `common/FlowCanvasControls` (also the
agent workflow canvas). The inspector slot holds `StepInspector` while a node
is selected and editable, otherwise `PipelineSettingsPanel` (both on the
drag-resizable `InspectorShell`): Identity (name), the controlled
`OrgAccessCard` (editors — writable even while enabled, per the BE) and
`PromoteZone` (rendered while enabled but inert, naming "disable first").
Delete is the header trash icon — `decideDelete` (unsaved → readonly →
enabled) disables it with the reason as tooltip, and a confirm modal names
what goes before `deletePipelineById`. A new draft shows Identity only. **Execution** (activation rows — own rows actionable with
run-now / deactivate / expandable per-activation run history via
`ActivationRunHistory`; members' rows read-only with the activator shown;
`broken` flagged — plus the "activate in this project" footer gated on enabled
and the read-only live-monitor canvas). The activation popover keeps its own
Activate / Cancel — activation CREATES a row, so its roster is a parameter of
`POST activate`, not a dirty draft; editing an EXISTING activation's roster is
controlled into `pipelineApproversDraft` and saves with the bar. The
standalone run-history view is gone — history is a property of an activation.
Selecting a pipeline keeps the current view (only a new draft forces Wiring).
Chat surfaces: `useChatPolicy` locks the input with `pipeline-active` /
`pipeline-running` (judged BEFORE `isRunning`), `PipelineActiveBanner` sits
in the chat input, the stop button on a pipeline step confirms and routes to
`cancelPipelineRun` (never raw stopJob), and pipeline-originated turns / the
work board carry `PipelineOriginChip`. The `pipeline_approval` chat card is a
standard ChoiceCard variant. A UI-authored chain stays implicit-linear
(`needs` omitted, zero YAML churn); the two structural gestures on the canvas
are the node "+"'s sections, and both go through `draft.ts`. **Insert**
(`insertStepAfter`) splices positionally on a linear def and splices THROUGH on
an explicit-`needs` one — the new step takes the anchor as its need and the
anchor's dependents rewire onto it. **Branch** (`addBranchAfter`) is offered
only on a node that already has a successor and rewires nothing, so the anchor
fans out; the arm's condition is then authored in the inspector
(`EdgeConditionField` harvests the direct needs' declared `outcomes`), which is
what lets the canvas express a gate's reject path and a verdict switch at all.
Because the "+" sits on the node's forward side, its menu names the gesture
(`Insert before {stepId}` / `Add next step` / `Add branch`) — an unlabelled one
reads as "append" and silently lengthens the chain instead.

**An insert never rewires an OUTCOME-BOUND edge** (`on: failure` / `always` /
`verdict:*`; `isSuccessEdge` is the one test). Such an edge judges its ANCHOR's
outcome and the fresh step produces none, so both rewire shapes fail late and
quietly: a gate's `on: failure` arm moved onto the new step never matches (an
abort leaves that step `cancelled`, and `cancelled` is not `failed`, so the
reject path skips with no validator complaint), and a `verdict:` arm moved off
its decider passes `PUT` and then fails `validatePipelineCatalogBinding` at
enable. A linear def whose displaced successor is outcome-bound therefore takes
the materialize path too — the splice would move exactly that one implicit edge.
Free drag-to-connect and canvas edge deletion remain Phase 3, on this same wire
contract, with no migration.

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
safe: the job drafts, a person publishes and activates. The API takes
`{ id, def }` as JSON and the agent composes `def` directly; the one YAML lane,
`POST /definitions/pipelines/import` (`{ yaml, id?, overwrite? }`, the Pipelines
rail's upload), is a PERSON's route — the self-API pin refuses it, exactly as it
refuses `/definitions/agents/import`. It exists for definitions authored
outside the server (the builder handoff in `docs/guides/builder-handoff/`),
parses through the same `parsePipelineYaml` → `validatePipelineDefServer`
funnel, and answers the full `errors[]` on 400 like `POST /`.

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

### Readiness is an authoring concern — substitutes and the human seam

The 2026-09-02 first-principles audit (doc 44, "first-principles closure")
confirmed that no activation or dispatch gate carries a dependency-readiness
axis: a pipeline whose every step runs a `virtual` (substitute-backed) intent
passes every gate, writes authored text in place of real calls, and seals
`completed`. That is **by design and stays so** — substitutes plus a human
relay are a legitimate operating mode, and a readiness gate would mint a
second home for wiring state, whose SSOT is the agent definition's connection
block (`apis` / `mcp.servers`). The dependency report
(`dependency-report/{agentId}.md`, newest `{agentId}*` wins; legacy
`dependencies/{agentId}.md`) is a human handoff document with zero
programmatic readers; do not teach the scheduler to parse it. If a future
surface wants a readiness verdict, it derives one from signals the lane
already holds: the definition's connection block, and the dispatcher's
`artifact:` vs `action:` stop-hook partition (today used only to collect
`{{steps.*.artifacts}}` globs).

The pipeline builder's own run report (`pipeline-report/{flowId}.md`,
contracted by its build intent's `artifact:` stop hook, rewritten whole on
every authoring turn) is where those obligations land durably. Like the
dependency report it has ZERO programmatic readers — do not teach the
scheduler to parse it. One file per FLOW (`pipeline-report/{flowId}.md`,
however many pipelines the flow splits into — the split and its reasons are
readable only whole), eight sections: flow, seams, relays, substitutes,
**intent changes this flow needs**, outcome coverage, run entry, and what was
left to a person. The fifth is the load-bearing one: a limitation of the AGENT reaches the lane that
can fix it only through that list. The pipeline builder's `review` intent is
the report's one reader: it verifies all eight sections against the saved
definitions and the material's cadence claims (Outcome coverage by
simulation) and writes `review-report/{pipelineId}-pipeline.md` — a
deliverable of its own, never an input to any gate. Six loop rounds in 2026-09 produced the
motivating case three times — the deciding intent's `outcomes`
(adverse/standard) cannot express the standard-form-contract case that needs
seven days AND individual notice, so routing on the verdict drops it and not
routing burns two steps writing "not applicable" — named by the audit turn
twice and the build turn once, and reaching the Agent Builder never, because
each naming lived in a chat report.

The obligations live at authoring time, in the pipeline builder's contract:

- **Disclosure** — while gathering definitions, derive which intents run on
  substitutes (external-system procedure, no declared connection,
  `artifact:`-only completion; the same-project manifest is read
  opportunistically as the status ledger) and name those steps in the stated
  design and the report, so a green run is never mistaken for the real work.
- **The seam table — two questions, not "decision vs labor".** A *seam* is a
  point where the run cannot continue until a person acts; a *relay* is a
  person carrying a deliverable onward while the run does not wait. Two
  observable questions classify every point where a person stands between two
  steps. (1) What does the NEXT step need from the person? Permission alone →
  an approval gate (one bit, no payload). A value it reads or a state its
  action presumes → that step's own intent `clarify` (text under the directive
  ceiling; a file as the artifacts path it was uploaded to). Permission AND a
  value → clarify first, gate on the record. Nothing — no step reads or
  presumes the work's product → a relay: no node, and no directive may assert
  the work happened (a relay holds only while the consuming steps run on
  substitutes; the wiring turn re-asks the question). (2) Does it exist when
  the run reaches that step? Held by the person who pressed Run or answers the
  card — an entry step's inputs always are — → the run continues through that
  channel. Produced only by a third party's work or on a calendar date → its
  arrival is the next stretch's trigger, so the seam is a **boundary between
  pipelines**: the upstream one ends at the hand-off deliverable, the
  downstream one is manual-fired while the seam is human (`runCompleted` once
  automated), both authored in one turn, the split reversible. The facts that
  arbitrate: a gate carries no payload; `clarify` is text-only and three
  rounds per step; an activation runs ONE live run (run-now 409
  `existingRunId`) and an activator three, so a run parked on a lead time
  serializes every later case behind it; no step sleeps until a date; a gate
  `timeout` sized to a lead time parks a decision nobody can yet make, sized
  shorter it rejects before the work exists. Only three shapes are FORCED by
  those facts — a wait that may exceed the 30d bound, more cases than free
  activations during the lead time, a calendar arrival; the rest of "third
  party → boundary" is the contract's stated default, with one exception (a
  reply the answering person can fetch without leaving the card is held). The
  older rule — a gate for a DECISION, never for LABOR (`477e496e3`, motivated
  by a 3-day gate over a week-long legal review) — was this table's shadow:
  it could not express the operator-held value (clarify), the unconsumed
  relay, or permission-plus-value, and it left the rounds P6–P16 pattern
  (seam = clarify at the consuming step, verified live) and the boundary rule
  standing side by side with no criterion between them. `rapid-killing-pilot`
  (2026-09-10) showed the cost: ~250 lines of design deliberation, three
  reversals, directives asserting deliveries no step observed, and an entry
  step with no channel for its case (below).
- **A directive states as fact only what a step of THIS pipeline observed.**
  Work outside the run is named as owed, never as done. P1's F9 (a gate over an
  extraction relay → the mail-send artifact asserted "extraction complete, PTS
  received" on one approval bit) recurred in `rapid-killing-pilot` with no
  gate at all: "after the publishing deliverables are complete", "once the
  recipient list and the send HTML are ready" written into directives of a
  pipeline whose steps never receive either.
- **An entry step must have a channel for its case.** Manual and chained
  entries learn the case through a pin or through clarify — template variables
  render only time and ids there. `rapid-killing-pilot` saved an entry step
  with no pin, no run-known value in its directive, and an intent declaring
  `clarify: false` (all nine intents of the material did, authored with no rule
  for the knob): `clarify: false` means "proceed on defaults", so Run now does
  not fail — it writes a case nobody supplied and seals `completed`. The
  `entry-no-case-channel` save advisory (§7) names the shape; the agent
  builder's contract now says when the knob may be false.
- **Verdict routing is owed where the vocabulary exists** — a run seals a
  verdict whether or not an edge reads it, so an upstream `outcomes`-declaring
  intent whose judgment nothing routes on has had its decision discarded, and
  the steps that apply to one outcome run on every outcome. Routing no branch
  is a choice the report defends.
- **A gate decides for the steps that need it.** Round 6 authored a
  send-approval gate that no step depends on, while the enactment steps it was
  meant to hold reached their work through a sibling branch: approving and
  rejecting led to the same run. The contract requires a gate to have an
  upstream step; it now also requires naming what the gate holds back, and the
  audit turn counts a needs-nothing gate as decoration.
- **An intent decides, a directive obtains.** The round-5 rule (a directive is
  owed where a person owes the input) was answered in round 6 by omitting six
  of nine directives, on the reasoning that each intent's prompt already says
  to record "not applicable" when its work does not apply. That conflates two
  axes: an intent can DECIDE applicability from its pinned artifacts, but it
  cannot OBTAIN what only a person holds — the count read out of a system, the
  file handed over, the answer that came back. The contract now separates them
  by name.
- **A directive is not optional where a person owes the input.** "The intent is
  already the specification" does not reach a step whose input has to come
  from a person: with no directive the runtime dispatches a bare "carry out
  this intent", and nothing tells the step that the reply, the count, the
  delivered file is owed by someone. Round 5 omitted those directives and the
  run showed both failure shapes — `comparison-table` wrote a
  "legal review reflected" section from the draft alone without asking, and
  `mail-send` left the recipient counts as `___`, both sealing `succeeded`.
- **Directive polarity** — a directive carries what only the RUN knows (the
  case's identifiers and parameters, the deadline, the watermark), never a
  restatement of the pinned intent's procedure, which is already loaded. When
  the run's inputs are unknowable at authoring time, they are left out and the
  report names the steps that will therefore stop for `clarify` — otherwise a
  person expects Run now to complete unattended.
- **A clarify answer stays with the step that asked it** — `{{steps.<id>.answer}}`
  is the final answer text, not the clarify — so anything later steps need from
  a person must be captured into an artifact by the step that asked. The
  2026-09-04 pair (`legal-gate` "enter the reply summary below" +
  `comparison-table` "the reply content, delivered at the approval gate")
  invented a gate payload; the step then did not ask, hedged in its own
  artifact, and the hedge survived neither its title, its answer, its sealed
  `verdict: adverse`, nor the next step's artifact.
- **A step that can end by recording "not applicable" wants an edge, not a
  judgment.** Same round: `regulator-report` ran a full job to write "no
  regulator filing needed", and `recipient-extract` decided individual-notice
  applicability inside its own artifact, while the deciding intent's
  `outcomes` sat unrouted. `onMissingVerdict` is what makes the edge safe.
- **A switch cannot be joined, and routing one outcome is half the work.**
  A step needing two arms of a switch never runs on either outcome — exactly
  one arm ever does, and `on: always` does not rescue it because a skipped
  need cascades whatever the condition says. Round 5 split `publishing` per
  outcome and rejoined the shared tail below both arms
  (`notice-post: needs [mail-send, publishing-standard]`): the live run sealed
  `completed` having skipped notice, enactment and the regulator filing — the
  whole tail, on every path. Branch only what differs; keep shared work above
  the split or hang it off the deciding step.
- **The other half of that walk.** The round after that one added the
  edges and hung the chain's tail off them: with `verdict: standard` sealed,
  six of twelve steps skipped — including the one that applies the amended
  terms to the system — and the run still sealed `completed`. Skips cascade, so
  whatever must happen for every outcome belongs downstream of a step that
  always runs. The authoring check is to walk the graph once per declared
  outcome.
- **Every step that consumes an upstream output pins it**, and the obligation
  is stated as one: `needs` orders steps, it does not carry files, so a step
  with no `context` is dispatched with its intent's prose and its directive and
  nothing else — however plainly its own prompt names the document it wants.
  Round 8 shipped a ten-step chain with zero pins and a report claiming routing
  the graph did not contain, six rounds after that axis had closed, and it
  closed again only when the rule led its section instead of describing the
  mechanism from the middle of it. A contract that keeps growing loses its
  older rules first: the same round's compression pass is part of the fix.
- **An artifact path belongs to the intent, not to the step.** A three-way
  switch that duplicates a step per outcome runs the same intent twice, and
  both copies write the intent's one `hooks.stop` path. Round 9 pinned
  `recipient-extract-notice-request.md` from the duplicated step's id; nothing
  produces that file, and the consuming step failed at dispatch with
  "Context file not found for glob", aborting a run that had already cleared
  five gates.
- **A pin inherits its producer's condition.** A glob matching nothing fails
  the step, so a step pinning an artifact whose producer runs on one outcome
  only fails on every other outcome. Round 7's `regulator-report` pinned
  `mail-send-request.md` while `mail-send` was adverse-only: every standard run
  would have failed at the last step, with `abort` taking the run down after
  all its work. Found by the audit turn reading the run log and the graph
  together; the loop's audit tool grew the same check (C3b).
- **A pin's `*` is not run-scoped.** Globs expand against the whole artifacts
  tree at dispatch (newest-first, per-glob capped), so a `*` where a case key
  belongs matches every case the project ever ran — and past the cap the run's
  own case is the one dropped. Two rounds of authoring guidance did not fix
  this because the remedy it named was not available: a `{{run.id}}` prefix
  partitions a run only if the PRODUCING intent writes there, and the intents
  own their output paths (`terms/{contract key}/…`). Round 4 answered the
  guidance by widening the pin to `terms/**` instead, handing every step every
  case's every file (measured: one step's context grew 5 → 13 files across a
  run, five of them another case's). What authoring can do today is pin the
  narrowest path per consumed output and NAME the cross-case exposure as agent
  work. The structural answer, not yet built, is to let a pin carry
  `{{steps.<id>.artifacts}}` — the run's own captured output list, which the
  coordinator already records per step and which is refused in pins today only
  because pins expand once at dispatch (by which time an upstream `needs` step
  has completed by construction). That is a `PipelineStepDef` contract change:
  validator, the pin renderer's 1→N expansion, the format contract, and both
  BE and FE consumers in one change.

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
- **Phase 2 (in progress)**: SHIPPED — `{{steps.*}}` output substitution (§1
  step-output capture; `steps.<id>.verdict` stays reserved), per-step `retry`
  (coordinator re-dispatch, NEW jobId per round with an idempotency preamble —
  `ant-jobs` stays attempts:1; standing failures and human stops never retry;
  `failStepOrRetry` is the one funnel and `applyOutcome` gained an
  expectedJobId guard so a superseded round's late outcome cannot clobber the
  current one), job-step `timeout` (delayed `sto-` arm, kill legs + retryable
  failure on expiry; stands down during clarify waits), and gate `remindAfter`
  re-arms (`gre-`, bounded by MAX_GATE_REMINDERS), A3 approval-await (§5c —
  the tool-approval HITL rail: `awaitingApproval` seal, kind:'tool' gate,
  grant re-dispatch), the OPTIONAL trigger block (manual-only pipelines, §2),
  and `on.runCompleted` event triggers (pipeline→pipeline chaining, §2 —
  `firedBy: 'event'`, chain-depth bound). Phase 2 is complete.
- **Phase 3**: per-(project, customJobRef) duplicate-gate relaxation +
  tenant concurrency slots, parallel branches/fan-in + FE turn grouping,
  free-DAG canvas editing, `cancelPrevious`, caps admin surface.
- **Backlog (user-locked)**: Slack/email channels, webhook triggers.

---

- **Not built — a per-case date wait.** A step cannot sleep until a date the
  case carries (an enforcement date), and `on.schedule` is case-blind; today's
  vocabulary is a boundary plus manual Run on the day (an hours-scale wait is
  the operator answering the clarify card at the hour). A `wait`/`runAt` step
  kind sits behind doc 48 D3 gap ⑤ (event triggers).

## Read next

- [44-universal-job.md](44-universal-job.md) — the runtime a step executes on.
- [45-mcp-orchestration.md](45-mcp-orchestration.md) — §4's design
  constraints that shaped this doc; in-job reporting stays an MCP tool.
