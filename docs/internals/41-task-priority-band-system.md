# 41. Task Priority & Band System (code job)

> SSOT code: [`graph/code/state.ts`](../../packages/ant-cli/src/agents/architect/graph/code/state.ts) (`TASK_PRIORITY` map + helpers), [`state.priorityGuide.ts`](../../packages/ant-cli/src/agents/architect/graph/code/state.priorityGuide.ts) (prompt guide render).
> The authoritative description of the three-axis model is `CLAUDE.md` §"Three-Axis Task Modeling SSOT" — this document covers only the **priority numbering scheme** built on top of it.

## Three-axis recap (type / band / priority)

A task is defined by **type + band**.

| Axis | Observer | Decides |
|---|---|---|
| `task.type` | LLM | Behavior mode (feature / error / verification / seam / ui / design-system / test-code / doc / setup / explain) |
| `task.band` | Orchestrator | Scheduling position within a type — exists only for **feature** (foundation/platform/integration) and **setup** (root) |
| `task.priority` | TaskQueue | Sort key (lower runs first). **Semantic comparison is forbidden** — only `TaskQueue.push()` sorting and `deriveBandFromPriority` read the number |

## Priority SSOT — `TASK_PRIORITY` (type → band → window)

The flat constants are retired. A single normalized map owns every window boundary (primary key = `TaskType`, secondary key = band, `default` = `band===undefined`):

| type | band | window | expected fan-out | barrier role |
|---|---|---|---|---|
| setup | root | 100 | 1 | root-first; `blocksUi/Testgen/Doc` |
| setup | default | 101–189 | 0–N | same as above |
| design-system | — (TYPE) | 200–219 | 1–~20 | foundation phase (classify=type) |
| feature | foundation | 220–259 | several | produces `hasPreFeatureWork` |
| feature | platform | 260–299 | 0–N (per runtime) | produces `hasPrePlatformWork` |
| feature | default | 300–599 | many (bulk) | produces the integration gate; consumes foundation+platform |
| feature | integration | 600–649 | few | consumes the integration gate |
| ui | — | 650–749 | many | consumes preUi |
| seam | — | 750–799 | 1 per ref module | runs post-ui |
| test-code | — | 800–849 | 0–N | consumes preTestgen; `blocksDoc` |
| doc | — | 850–899 | 0–N | consumes preDoc |
| error | — | 900–999 | 0–N | reactive |
| verification | — | 1000 | 1 | terminal gate |

Windows are contiguous and non-overlapping; the regression guard [`tests/policy/priority-constants.test.ts`](../../packages/ant-cli/tests/policy/priority-constants.test.ts) locks monotonicity, `min≤max`, and lane-offset safety.

### Public helpers (phase code must never touch the numbers directly — helpers only)

- `windowFor(type, band?) → {min,max}` — without a band, the type's `default`. Unknown/`explain` types fall back to the ordinary feature window.
- `basePriorityFor(type, band?) → number` — the window base. **The per-type default for a missing priority** (replaces the old single magic number).
- `deriveBandFromPriority(priority) → TaskBand | undefined` — **reverse lookup** of the `TASK_PRIORITY` map. The **only phase site** for priority→band conversion ([`decompose/responseParser.ts`](../../packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/responseParser.ts)).
- `VERIFICATION_PRIORITY` — the verification single point (1000), derived from the map.

### Strict derivation (intended behavior)

design-system `[200,219]` and feature.foundation `[220,259]` are **separate windows**. `deriveBandFromPriority` derives only `[220,259]` as foundation (strict). design-system is a TYPE, so band derivation is never invoked for it, and a stray feature priority inside that window is safely demoted to `undefined` (ordinary).

### lane-mode offset invariant

batchSplit lane-mode child priority = `parentPriority + offset` (the parent emits at the window base; slices stack upward). `MAX_LANE_OFFSET = 39` is the ceiling matched to the **narrowest lane-fanning window** (feature foundation/platform, `max-min=39`), and [`batchSplit/process.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) clamps the offset to this value so a child can never leave the window.

## Single prompt source — `renderPriorityBandGuide()`

The band table is never hand-copied. `renderPriorityBandGuide()` walks `TASK_PRIORITY` to render the LLM-facing table, and `decompose/variants/default/base.md` injects it via `{{{priorityBandGuide}}}`. The regression test consumes the same function, so the numbers cannot drift.

## Priority authority — a single authority for code jobs

Every code intent (`gen-code-sys` / `gen-code-spec` / `gen-code-directive`) uses the **same canonical bands**. The old `gen-code-spec` free-priority carve-out (`isPriorityFromSpec`) has been removed.

The work ordering in the source document (spec / system design / directive) is only a **reference for relative priority within a band**. Band placement follows dependency classification — common/foundational work is extracted into foundation/platform up front no matter where it sits in the source, while feature/ui/error go to their respective bands. The source's t1…tn is never copied 1:1 into priority numbers.

## design-job doc priorities are a separate axis

The design job emits every task as `type:'doc'` and distinguishes scheduling with priority bands (tokens 100–199 / assets 200–299 / spec 300+). This axis is **orthogonal** to the code-job `TASK_PRIORITY`, and `DESIGN_DOC_BANDS` in [`tasks/doc/hooks/scheduling.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/doc/hooks/scheduling.ts) is the SSOT. Do not merge the two.

## Deferred — game world-space Render sub-band (Phase 5+)

**Why this is recorded**: to pin the design direction now so it is not rediscovered later as a "bug". Not an implementation target yet.

The 5 currently registered game genres (match3 / slidingPuzzle / cardSolitaire / arcadePaddle / arcadeSnake) are all single-screen, so the canvas (world-space) render layer is thin and all UI collapses into the screen-space React HUD ([`jobs/code/domain/game.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/code/domain/game.md) §7). Therefore it currently works out that a game code job's visual work is handled with the same `ui` type as services (single DOM surface = feature skeleton + style-pass model, [`tasks/ui/twin.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/ui/twin.ts)).

**Trigger**: once animation-heavy / camera-panning genres are added to the matrix, world-space Render authoring (sprite tweens / particles / scene direction) becomes high-volume, and the `ui` window (650–749) can no longer order world-space Render (Domain-dependent) and screen-space HUD mixed within one window. The `ui` type's twin/attestation/restyle framing also cannot carry world-space authoring.

**Design decisions for that point (pre-committed)**:
- **Do NOT create a new domain-coupled task type (`render`/`scene`).** That would break the orthogonality that `task.type` is domain-agnostic (proven by an exhaustive sweep across the domain and stack axes). Differentiation belongs on the **domain axis** (which already exists and works).
- **Band path**: introduce a sub-band inside the `ui` window (e.g. `UiBand = 'world' | 'hud'`) — the Three-Axis rule "a new scheduling position = band, not type". Order world-space Render ahead of screen-space HUD. One line extending the `TaskBand` union + decompose mapping + a classify branch in `tasks/ui/hooks/scheduling.ts`.
- **hook/variant**: the `tasks/ui/` bundle reads the domain to swap twin/attestation application for world-space Render tasks, and layers a domain-gated render-authoring section onto the execute variant (`ui` stays the type; the branch is on domain).

## Related documents

- `CLAUDE.md` §"Three-Axis Task Modeling SSOT" — authoritative spec + enforcement
- [`NODE_GRAPH_LAYOUT.md`](NODE_GRAPH_LAYOUT.md) §R1 — isolating semantic priority comparison out of phase code
- [`jobs/code/domain/game.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/code/domain/game.md) §7 — world-space/screen-space render boundary (the domain-overlay side of the seam above)
- [`11-agent-architecture.md`](11-agent-architecture.md) — TaskOrchestrator / barrier mechanism
