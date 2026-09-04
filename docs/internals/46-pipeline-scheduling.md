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

**Step-output substitution** (`{{steps.<id>.answer}}` /
`{{steps.<id>.artifacts}}`): on step completion the coordinator captures
`StepRecord.output` — the final assistant text of the seal's `session:main`
(jobId-guarded, `PIPELINE_STEP_OUTPUT_MAX_CHARS` = 16k, same bounded read as
the clarify detection) and the files matching the pinned intent's
`hooks.stop` globs (`expandArtifactGlobsBounded`, non-failing). Capture is
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
caps doctrine. A pipeline never chains onto its own project. `schedule` and
`runCompleted` may coexist on one definition.

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

**Verdict routing** (`on: verdict:<name>`): the decision vocabulary is
declared on the INTENT (`infer.md` frontmatter `outcomes: [..]` — the
business knowledge lives in the agent definition, never per-pipeline). The
universal runtime injects a verdict band into outcome-declaring turns and the
respond seal lifts the final reply's `<verdict>` tag (registered in the
output-tag matrix); `captureStepOutput` validates it against the declared
vocabulary and stamps `StepRecord.verdict`. No valid verdict = the step FAILS
(`missing-verdict`, retryable) unless the step's `onMissingVerdict` names a
fallback outcome. The executor's `verdict:` predicate matches a need that
SUCCEEDED with that verdict — non-matching branches skip and skips cascade,
which is the whole switch semantics ("new chain edge predicates = executor-
only changes", §8 Correct).

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

The reserved v2 contract (user-locked as backlog): a
`NotificationChannelPort { kind: 'inApp'|'slack'|'email' }` whose inbound leg
(HMAC magic-link `{cardId, choiceId, exp}`) lands in the same choice-resolved
funnel with `via: 'magic-link'`. No implementation ships in v1; the funnel
shape is what makes the extension migration-free.

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
> The shared session is itself unresolved: a step job inherits every previous
> RUN's conversation, so a new case's intake can skip its questions because
> the answers to a *different* case are already in context (same date, same
> project). Per-run isolation is a product decision, not a bug fix — see the
> loop's notes before changing it.

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

Routes (`pipelines.routes.ts`, mounted **account-scoped `/api/definitions/pipelines`** —
definitions are cross-project): list (scope-merged closest-wins; entries
carry `scope` / per-caller `readonly` / `enabled` / `org` permission
projection / `activations: PipelineActivationView[]` — own rows plus, for
org-scope pipelines, other members' rows with `mine: false`; the response
also carries `orphanActivations`, own activations whose pinned def no longer
resolves; server-computed `nextFireAt` — the FE never parses cron) · create
(personal root, DISABLED draft, cross-scope id collision 409) / get / put +
delete (`findWritablePipeline` funnel: 403 `org-pipeline-forbidden` per ACL;
409 `pipeline-enabled` while enabled; create/put responses carry
non-blocking `catalogWarnings` — the same catalog-binding findings the
enable gate hard-fails on, so an authoring job (pipeline-builder)
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

The obligations live at authoring time, in the pipeline builder's contract:

- **Disclosure** — while gathering definitions, derive which intents run on
  substitutes (external-system procedure, no declared connection,
  `artifact:`-only completion; the same-project manifest is read
  opportunistically as the status ledger) and name those steps in the stated
  design and the report, so a green run is never mistaken for the real work.
- **The seam rule** — an approval gate holds a run for a person's DECISION,
  never their labor. When a person performs work between steps (relaying a
  deliverable into a system no agent reaches), the downstream chain's real
  trigger is that handoff arriving, so the domain is authored as **multiple
  pipelines** split at the seam: the upstream one ends at the handoff
  deliverable, the downstream one is manual-fired while the seam is human
  (`runCompleted` only once it is automated). The split is reversible —
  wiring the seam later means chaining or merging the two. No inter-pipeline
  ordering machinery exists or is planned; `runCompleted` and manual fire are
  the whole vocabulary.
  Two rationalizations for keeping a labor seam inside a gate are settled by
  facts, and the contract states both so the rule is not a preference to trade
  away: an approval carries **no payload** (one bit — it delivers none of what
  the person produced, so the downstream step re-asks through clarify or
  asserts a receipt it cannot verify), and covering a whole procedure is not an
  argument against splitting, since the whole flow IS covered by several
  pipelines, one per seam-bounded stretch.
- **Verdict routing is owed where the vocabulary exists** — a run seals a
  verdict whether or not an edge reads it, so an upstream `outcomes`-declaring
  intent whose judgment nothing routes on has had its decision discarded, and
  the steps that apply to one outcome run on every outcome. Routing no branch
  is a choice the report defends.
- **Directive polarity** — a directive carries what only the RUN knows (the
  case's identifiers and parameters, the deadline, the watermark), never a
  restatement of the pinned intent's procedure, which is already loaded. When
  the run's inputs are unknowable at authoring time, they are left out and the
  report names the steps that will therefore stop for `clarify` — otherwise a
  person expects Run now to complete unattended.
- **The seam's data channel is the consuming step, not the gate.** Resolving
  an approval sends `decision` and nothing else, so a gate `prompt` that
  invites the approver to enter a value describes a channel that does not
  exist, and a directive claiming the gate delivered content makes the step
  work from an assumption. A 2026-09-04 authoring round produced exactly that
  pair (`legal-gate` "enter the reply summary below" + `comparison-table`
  "the reply content, delivered at the approval gate"): the step then did not
  ask, wrote its own artifact hedge ("assumed to affirm the provisional
  judgment"), and that hedge survived neither its own document's title, nor
  its answer, nor the sealed `verdict: adverse`, nor the next step's artifact
  ("legal review **determined** it adverse"). A clarify answer also stays with
  the step that asked it — `{{steps.<id>.answer}}` is the final answer text,
  not the clarify — so anything later steps need from a person must be
  captured into an artifact by the step that asked.
- **A step that can end by recording "not applicable" wants an edge, not a
  judgment.** Same round: `regulator-report` ran a full job to write "no
  regulator filing needed", and `recipient-extract` decided individual-notice
  applicability inside its own artifact, while the deciding intent's
  `outcomes` sat unrouted. `onMissingVerdict` is what makes the edge safe.
- **Routing one outcome is half the work.** The round after that one added the
  edges and hung the chain's tail off them: with `verdict: standard` sealed,
  six of twelve steps skipped — including the one that applies the amended
  terms to the system — and the run still sealed `completed`. Skips cascade, so
  whatever must happen for every outcome belongs downstream of a step that
  always runs. The authoring check is to walk the graph once per declared
  outcome.
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

## Read next

- [44-universal-job.md](44-universal-job.md) — the runtime a step executes on.
- [45-mcp-orchestration.md](45-mcp-orchestration.md) — §4's design
  constraints that shaped this doc; in-job reporting stays an MCP tool.
