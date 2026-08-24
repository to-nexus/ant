# 47. Attachment Awareness — the user's selection outranks the directory allowlist

> Companion to [32-action-activation-policy.md](32-action-activation-policy.md)
> (which slots exist per intent), [19-tool-system.md](19-tool-system.md) (the
> tool gates), and [39-code-job-prompt-injection-matrix.md](39-code-job-prompt-injection-matrix.md)
> (what renders where). This document owns one question: **when a user hands the
> system a file, what has to happen for the job to actually use it.**
>
> Binding rules: [AGENTS.md § state.artifacts is RAC-bound](../../AGENTS.md#stateartifacts-is-rac-bound).

## Why this exists — `near-loading-brace`

A code job was asked to build a weekly-report page from a spec plus two
screenshots. It completed "successfully", with dead `data-src` placeholders and
no images. The session export is the whole story.

What the FE sent (`chat.jsonl` line 1, `actionMetadata`):

```json
{ "refs": ["architecture/spec/report.md"],
  "context": ["visual/ui/handoff/스크린샷 …11.28.03.png",
              "visual/ui/handoff/스크린샷 …11.33.05.png"],
  "domain": "service" }
```

What the job ran on (`architect/code.json`, `state.resolvedAction`):

```json
{ "intent": "gen-code-directive", "source": "infer",
  "refs": ["architecture/spec/report.md"],
  "context": ["codebase/README.md"], "hasExplicitFields": true }
```

Both screenshots gone. The prompt logs agree: `hasUi: false`,
`uiArtifactPaths: 0`, `runtimeAssetsCount: 0` at decompose and in all six later
renders. Of 30 logged tool calls, **zero** mention `visual/`, `handoff`, or
either filename. There was no denial and no ENOENT — nothing was ever attempted.

The plan agent, knowing it needed screenshots, swept `assets/**` with 11
`list_files` calls, found every leaf empty, and concluded:
`스크린샷 파일이 assets/service/images/에 없으므로, placeholder 영역에 캡션만
표시하는 방향으로 구현합니다`.

That last step is the tell. The job did not fail to *find* the files; it looked
in the only place it had ever been *taught* real files can live.

## The two independent defects

### 1. The RAC dropped the selection (why it knew nothing)

`createInferDetectNode` has two branches. The explicit branch (there is an
`actionMetadata.intent`) builds the RAC straight from metadata. The infer branch
calls `inferRacWithTools`, whose input type did not contain `actionMetadata` at
all — so `refs` / `context` / `target` / `basis` were discarded and the LLM's
inference used verbatim.

The additive merge helper for exactly this situation, `mergeWithMetadata`, existed
and was called from **one** place: the legacy `createDetectNode(strategy)`
factory, which today only the **visual** job uses. `code`, `design` and `plan`
all migrated to `createInferDetectNode` and lost the merge on the way.

Consequence: for three of the four jobs, **a turn with no explicitly-picked
intent silently threw away every file the user selected.** `refs` survived in
this job only by luck — `architecture/spec/report.md` is the sole file in that
slot dir, so the LLM re-picked it.

Absent `intent` means "the user did not pick an action". It has never meant "the
user selected no files".

### 2. Four allowlists asked the wrong question (why fixing #1 alone was not enough)

Each layer re-derived "is this a real file I may use?" from a **directory
allowlist**, and an attached screenshot lost at every one:

| Layer | Old predicate | What it did to the attachment |
|---|---|---|
| Pool load (`loadResolvedArtifacts`) | `isStubLoadedPath` — 4 prefixes | outside them a PNG fell to `readTextContained` → `toString('utf8')` → mojibake in the prompt |
| Per-task selection (`selectArtifacts`) | `isAssetPoolPath` — `assets/{service,game}/` | reached decompose, then dropped before plan and execute unless the decompose LLM named it in `include` |
| Placement awareness | `indexAssetPool` + `pickAssetsRoot` — one domain pool | the 📦 block, the decompose hint and `plan.implementation.assets[].source` could not name any other path |
| Vision | `ArtifactService.loadHandoffImages` — hard-coded `visual/ui/handoff/` | described to the model, never shown to it |

Plus a straight contradiction between two prompt surfaces about the same file:

- the `[asset]` stub: *"Reference this path from code output (copy it into the
  app's static-asset root)"*
- the handoff image caption: *"inputs to this prompt only — NOT automatically
  copied into the app runtime… generate placeholders"*

A handoff screenshot hits both. The job obeyed the second.

## What binds now

One rule: **a file's location must never decide whether the job is told it
exists.** Each question has one owner, keyed on the user's selection or the bytes.

| Question | Owner | Keyed on |
|---|---|---|
| Did the user's slots survive an inferred RAC? | `inferRacWithTools` (`metadata` input) → `mergeWithMetadata` | `actionMetadata`, additively |
| Which UiSource wins a merge? | `pickUiSource(paths, preferred)` + `filterToUiSource` | the user's source outranks static `ant > figma > handoff` |
| Is this artifact existence-only? | `loadResolvedArtifacts` sniff → `ResolvedArtifact.kind` | the bytes, in any directory |
| Does it ride along past `task.include`? | `ridesAlongRegardlessOfInclude` | `kind === 'binary'` |
| May the job place it? | `effectiveAssetInventory` | domain pool ∪ attached binaries |
| Can the model see it? | execute image blocks | `mediaType === 'image'` from the same sniff |

### Three details that are load-bearing

**`source` stays `'infer'` after the merge.** `computeRacScope` gates every
downstream read on `source === 'explicit' ∧ hasExplicitFields`. Promoting a
merged RAC to `'explicit'` would suddenly RAC-whitelist a job that had been
discovering freely — a much larger behavior change than the fix. An attachment
*adds* to an inferred RAC; it does not pin it.

**The UiSource verdict is taken once, over refs ∪ context.** Exclusivity means a
source gets dropped, and the static priority knows nothing about who contributed
which path — so the merge passes the user's source as a preference. But a
*per-slot* preference is unsound: with `refs` holding only the inferred `ant` doc
and `context` holding the attached `handoff` file, each slot resolves to a
different winner and the RAC comes out **mixed**, which `validateUiSourceExclusivity`
then throws on. Hence the split into `pickUiSource` (decide, once, over the
union) and `filterToUiSource` (apply, per slot). This was caught by its own
regression test before it shipped; do not re-collapse the two.

**`base64` is not populated at pool load.** `ResolvedArtifact` carries
`mediaType` / `mimeType` from the sniff so the execute image-block builder knows
what to send, but never the bytes — artifacts are checkpointed to
`sessions/**/code.json`, and inlining image data would balloon every resume file.
The builder reads bytes fresh under its own `ANT_UI_IMAGE_*` budgets.

### `effectiveAssetInventory` is derived on read, not stored

`state.assetInventory` is written at `resolve`, which is the code graph's **entry
point** (`__start__ → resolve`) — the RAC artifacts do not exist until `detect`
runs a node later. A union computed at resolve would always see an empty pool, so
the union is a function over state, called by its three consumers (execute's 📦
block, the decompose hint, the plan block).

`indexAssetPool` stays domain-scoped. The Asset Surface Boundary (I6) is about
never observing the **other domain's** pool from a disk walk; it says nothing
about a file the user handed this job by name.

## Scope boundary — what "any directory" actually means

There is **no chat paste/attach mechanism.** "Attaching" always means selecting a
file already on disk in the feature, via `FileTreePicker` or an `@ref:` / `@ctx:`
mention, both fed from the picker tree — which is itself root-allowlisted by
`isFeatureTreeRootEntry`. A non-canonical top-level dir (`uploads/`, `docs/`)
therefore cannot normally exist, and is not reachable through the UI.

So the practically broken set was **every canonical dir that is not one of the two
asset pools**: `visual/**/handoff/`, `plan/`, `meta/`, `assets/gen/`, and bare
`assets/`. That last one is already produced in-tree — the project wizard uploads
to the bare container (`dirPath: 'assets'`), which has no `acceptedExtensions`, so
existing workspaces hold `assets/<file>.png` that all three old pool predicates
missed.

### Known remaining gap

`normalizeToCodebasePath` Rule 4 rewrites any non-canonical top-level path to
`codebase/<path>`. A file at `<feature>/uploads/x.png` is therefore reported
`File not found: codebase/uploads/x.png`, while `decideRacGate` — reading the same
normalizer — classifies it as "codebase, allowed". The two layers disagree about
one string. The fix is an on-disk disambiguation inside `resolveToolPath` (which
already reconciles NFC/NFD there), keeping the normalizer pure for the gate.
Deferred deliberately: unreachable through the UI, and making arbitrary
directories first-class also means relaxing `isFeatureTreeRootEntry`, which the
file tree, artifacts panel and upload policy all key off.

Also open, adjacent: `copy_file` writes through contained IO rather than
`ctx.fileSystem`, so in parallel-worker mode `SharedFileBuffer` never observes the
placed asset (`WorkerFileSystem.copyFile` is dead code); and `run_command cp` is a
second placement path whose guard checks only the destination.

## Guards

| Test | Locks |
|---|---|
`tests/detect/metadata-supplement-merge.test.ts` | the axis: attached slots survive the infer path — additively, whitelisted, prompt-stated, `source` unchanged, attachment ≠ missing prereq, user's UiSource wins, user's target wins |
`tests/policy/uiSourceExclusivity.test.ts` | one verdict across refs ∪ context; preference only when metadata supplies a source |
`tests/policy/rac-scope-invariant.test.ts` | binary → existence-only stub in five different directories; text still loads; `assets/gen` RAC-orthogonal; ride-along past a non-matching `include`; verification still drops everything |
`tests/policy/asset-surface-boundary.test.ts` | the union inventory: attachments in, text out, SVG in, no double-count, pool-only unchanged |
`tests/prompt/attachment-injection-gate.test.ts` | the two template gates, rendered for real: block present when populated, absent when not |

## Related

- [32-action-activation-policy.md](32-action-activation-policy.md) — per-intent slot matrix.
- [19-tool-system.md](19-tool-system.md) — `copy_file` / `read_file` / `list_files` gates.
- [39-code-job-prompt-injection-matrix.md](39-code-job-prompt-injection-matrix.md) — which partial renders where.
