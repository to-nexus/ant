# README assets

This directory holds the images the READMEs reference. They fall into two kinds
with **opposite** rules, and the distinction is the whole point of this guide:

| Kind | What it is | Rule of thumb |
|---|---|---|
| **Captures** (2 GIFs) | Screenshots of the running product | Scarce. They go stale every time the UI moves. |
| **Diagrams** (5 PNGs) | Authored HTML, baked to PNG | Cheap. Re-rendered from committed source, so they don't go stale on a UI change. |

`logo.png` is neither — it is the product logo (copied from
`packages/ant-ui/public/logo.png`). It is no longer placed in the README
directly; the hero uses the wordmark lockup below, which composes it. If the
brand asset changes, update both copies and re-run `pnpm docs:diagrams`.

`README.ko.md` reuses every file here **except the wordmark** — only `alt` text
and captions are localised. Do not produce a Korean set of anything else.

---

# Part 1 — captures (the two GIF slots)

Both slots are currently an HTML comment in [`README.md`](../../README.md); drop
a file here with the matching name and uncomment the block.

There are **two slots, on purpose.** A GitHub visitor gives the page seconds and
watches one thing. Every extra image competes with the first for that attention,
and every image is a screenshot that goes stale the next time the UI moves — for
a solo project, stale screenshots read worse than none. Feature tours belong on
the marketing site (`packages/ant-site`), and "does it actually run" belongs in
the hosted video. Do not grow this list back into a grid.

The two slots split by **job kind**, because the two job kinds look nothing alike
and each proves a different half of the pitch:

| File | Format | README location | The one claim it carries |
|---|---|---|---|
| `code-job.gif` | GIF | Top, under the badges | A directive becomes decomposed, parallel, visibly-tracked work |
| `design-job.gif` | GIF | End of `## Why Ant?` | Every stage writes a real document at a real path — live |

Total budget: **≤ 4 MB**. These files live in git history permanently.

Do not shoot a Korean set — the UI is localised, but a second set doubles the
repo weight and guarantees the two drift.

---

## 1. `code-job.gif` — the board

**What to run.** A service-domain project with a PRD already in place. Give a
directive big enough to land in Tier 3, so decompose emits two or more tasks
plus a Final Verification task.

**Framing.** Task board in the centre, chat on the right, **explorer collapsed to
its rail** — at README width a three-pane shot makes the cards unreadable. Dark
theme, so the background gradient shows between the columns. Leaving a thin strip
of browser chrome with `localhost:4200` visible is worth it: it proves the
self-hosted claim without a caption.

**When to start recording.** At the `decompose` node, so the loop captures:
estimating skeletons shimmering → tasks popping into To Do → a card springing
across to In Progress with the live node indicator underneath → landing in
Completed. Meanwhile the chat fills with colour-coded work cards.

**What this shot can and cannot prove.** It proves *visible, decomposed, parallel
work* — which is already the difference between Ant and a chat window, and it is
legible in ten seconds to someone who has never seen the product.

It does **not** prove the verification gate, and do not try to make it. At 1280px
a card title is barely readable, and a stranger who does read "Final
Verification" has no way to know it is a queued first-class task that can block
completion rather than just the last item on a list. That claim belongs to the
caption and the prose around it. Frame for legible motion, not for a card title.

8–10 seconds, looping, **≤ 2.5 MB**.

## 2. `design-job.gif` — the document being written

**What to run.** A `design` job with the system-design intent (`gen-sys-*`) on a
project that has a PRD. The plan job (PRD authoring) is the fallback if the
system-design document streams too densely to read — see below.

**Framing.** The main panel only. The document streams into
`VirtualDocumentViewer` as **rendered markdown**, not raw text, and four things
must be in frame:

- the **file path in the header** — this is what makes it a document rather than
  a chat reply,
- the `design` **source chip** and the amber **"Streaming"** chip,
- the **2px aurora shimmer strip** at the top of the panel,
- the explorer, narrow, showing the tree the file is landing in.

**When to start recording.** Mid-document, once headings and prose are already
accumulating — a cold start on an empty panel wastes half the loop. Let it run
until the status chip flips to `Read-only`.

**End the loop on a rendered diagram if you can.** A mermaid fence renders once
the block closes, so the final second can rest on an architecture diagram. This
is the payoff frame: a document that was streaming a moment ago is now something
you can read and argue with. If the chosen document has no mermaid block (the
system-design prompts prefer prose and emit diagrams only where topology needs
them), either pick another document or fall back to a plan job — a PRD streams
as clean prose and reads better in motion than a dense document does.

8 seconds, looping, **≤ 1.5 MB**.

## Video

A full walkthrough — build loop (PRD → design → code), then one spec-driven
iteration, ending on the preview — runs a couple of minutes. Host it (YouTube,
Loom) and fill in the link in the hero caption.

The video is where everything that is *not* one of the two slots lives: the live
agent graph, the visual-tier picker, per-model cost breakdowns, the browser IDE,
and the preview actually serving the app. It costs zero repo bytes and never goes
stale in git. **Do not turn any of those into a README image.** Embedded MP4 is
not worth attempting either: GitHub won't autoplay it and repo-relative video
paths are unreliable.

---

## Capture and encoding — GIFs only

- Record a 1440×900 logical viewport at 2× DPI, downscale to **1280px wide**.
- **Dark theme for both.** The background gradient is most of the visual
  identity.
- **Hygiene**: use a neutral demo project name (`storefront`, feature
  `feature/checkout`), not a real customer's. Shoot in local mode so no real
  account identity appears. Keep the explorer narrow enough that your home
  directory path isn't legible.

```bash
# recording → GIF
ffmpeg -i in.mov -vf "fps=14,scale=1280:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 code-job.gif

# smaller alternative — GitHub renders animated WebP
ffmpeg -i in.mov -vf "fps=14,scale=1280:-1:flags=lanczos" \
  -c:v libwebp -q:v 55 -loop 0 -an code-job.webp
```

If a GIF refuses to fit the budget, shorten the loop before lowering the frame
rate — a 7-second clip at 14fps reads better than 12 seconds at 8fps. Streaming
text is mostly static pixels in a small area, so `design-job.gif` should come in
well under its cap; if it doesn't, you started recording too early.

---

# Part 2 — diagrams (the five PNGs)

Diagrams are **authored, not captured**. Each one is an HTML file in
[`diagrams/`](diagrams) baked to PNG by headless Chrome:

```bash
pnpm docs:diagrams              # all five
pnpm docs:diagrams architecture # just one
```

The HTML is the source of truth and is committed alongside the PNG. That is why
the two-slot scarcity rule above does not apply here: a diagram does not go stale
when the UI moves, and when the architecture itself changes you edit a `<div>`
and re-run one command rather than re-shooting anything.

| File | README location | The one claim it carries |
|---|---|---|
| `build-loop.png` | End of `## Why Ant?` | Two pipelines — build once, then iterate spec → code — each stage a real file |
| `design-input.png` | `## Bring your own design` | Three inputs, one hard-exclusive contract |
| `architecture.png` | `## How it works` | Four processes, Redis as the only channel |
| `job-anatomy.png` | `## How it works` | Parallel tasks, gated by a first-class verification task |
| `workspace.png` | `## Workspace model` | One bare anchor, features as peer worktrees |

### The wordmark is the one localised pair

`wordmark.png` / `wordmark.ko.png` are the README hero: the logo on the left,
`ANT` over the tagline on the right. They are rendered by the same command but
break two of the rules below on purpose, so they are called out here rather than
hidden as an exception:

- **They are a localised pair**, because the tagline is prose and the Korean
  README should not open in English. Nothing else here may be duplicated per
  language.
- **They render on transparency, not on the dark card**, because they sit on the
  README's own background. Every colour therefore has to clear 3:1 on *both*
  GitHub themes — the aurora gradient on `ANT` does, and the tagline uses a
  mid-slate (`#807d93`) chosen for that reason. Verify against white **and**
  `#0d1117` before committing a change to either file.

This layout is an image rather than markup because GitHub gives HTML tables
visible cell borders and floats a `<h1>` rule straight across the logo — neither
produces a clean side-by-side lockup.

### Rules

- **English only** (the wordmark pair above is the sole exception). Both READMEs
  embed the same file; only `alt` and captions are localised. A Korean render
  would fork the asset.
- **Colours come from [`aurora-tokens.css`](../../packages/ant-ui/src/styles/aurora-tokens.css)**
  (dark theme), via [`diagrams/_diagram.css`](diagrams/_diagram.css). Do not
  invent values, and do not source from
  `packages/ant-ui/src/shared/utils/design-system.ts` — that module is pre-Aurora.
- **No environment-specific values.** No port numbers, no hostnames, no
  `localhost`. A diagram must be equally true of a laptop and a cluster.
- **880 CSS px canvas, rendered at 2×**, declared per-file as
  `<meta name="canvas" content="880x664">`. The README displays at `width="880"`,
  so the layout is what the reader sees at 100% zoom.
- **Budget: ≤ 300 KB each**, ≤ 1.2 MB for all five. The render script fails the
  run if a file goes over.
- The aurora gradient is the accent, not the background — **use it once per
  diagram**, on the single most important element.

Colour semantics are held constant across the set: violet = agent/compute,
pink = bus/realtime, orange = in-flight/preview, teal = optional/external,
emerald = verified/done, dashed border = optional or deferred.
