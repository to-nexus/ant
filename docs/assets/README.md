# README assets

This directory holds the images the READMEs reference. They fall into two kinds
with **opposite** rules, and the distinction is the whole point of this guide:

| Kind | What it is | Rule of thumb |
|---|---|---|
| **Captures** (1 clip) | Screenshots of the running product | Scarce. They go stale every time the UI moves. |
| **Diagrams** (5 PNGs) | Authored HTML, baked to PNG | Cheap. Re-rendered from committed source, so they don't go stale on a UI change. |

`logo.png` is neither — it is the product logo (copied from
`packages/ant-ui/public/logo.png`). It is no longer placed in the README
directly; the hero uses the wordmark lockup below, which composes it. If the
brand asset changes, update both copies and re-run `pnpm docs:diagrams`.

`README.ko.md` reuses every file here **except the wordmark** — only `alt` text
and captions are localised. Do not produce a Korean set of anything else.

---

# Part 1 — captures (the one capture slot)

There is **one slot, on purpose.** A GitHub visitor gives the page seconds and
watches one thing. Every extra image competes with the first for that attention,
and every image is a screenshot that goes stale the next time the UI moves — for
a solo project, stale screenshots read worse than none. Feature tours belong on
the marketing site (`packages/ant-site`), and "does it actually run" belongs in
the hosted video. Do not grow this list back into a grid.

| File | Format | README location | The claims it carries |
|---|---|---|---|
| `code-job.webp` | animated WebP | Top, under the badges | A directive becomes decomposed, parallel, visibly-tracked work — and every stage writes a real document at a real path |

**This was two slots** — a board shot at the top and a document shot at the end of
`## Why Ant?`, split by job kind. It collapsed to one when the board capture turned
out to carry both claims: 16 of its 20 seconds are the document surface, across
three real paths, ending on a file that has stopped streaming and become readable.
A second capture would then have been the same UI at the same size proving a claim
already made — the redundancy this section exists to prevent. Do not re-add a
document slot unless a capture proves something this one does not.

Budget: **≤ 2.5 MB**. These files live in git history permanently — and pushing one
is irreversible in practice, so a deleted capture keeps costing clone bytes forever.
Get the shot right before committing it.

Do not shoot a Korean set — the UI is localised, but a second set doubles the
repo weight and guarantees the two drift.

---

## 1. `code-job.webp` — the board

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

**The document beat is not optional.** Since this is the only capture, the loop
must also leave the board and sit on a file being written, because that is the
second claim. Four things have to be in frame while it does:

- the **file path in the header** — this is what makes it a document rather than a
  chat reply,
- the **source chip** and the amber **"Streaming"** chip,
- the **2px aurora shimmer strip** at the top of the panel,
- the explorer, showing the tree the file is landing in.

Let it run until a file stops streaming and turns readable. That is the payoff
frame: something that was being generated a moment ago is now a document you can
open and argue with. More than one path is better than one — it turns "it wrote a
file" into "every stage writes a file."

**What this shot can and cannot prove.** It proves *visible, decomposed, parallel
work* — which is already the difference between Ant and a chat window, and it is
legible in ten seconds to someone who has never seen the product.

It does **not** prove the verification gate, and do not try to make it. At 1280px
a card title is barely readable, and a stranger who does read "Final
Verification" has no way to know it is a queued first-class task that can block
completion rather than just the last item on a list. That claim belongs to the
caption and the prose around it. Frame for legible motion, not for a card title.

8–10 seconds, looping, **≤ 2.5 MB**.

**What shipped.** 20 seconds, 1280×657, 280 frames at 14fps, 2.50 MB — the cap
exactly. Measured across the window: ~3s board, ~11s of `handoff/DESIGN.md` →
`tokens/colors.css` → `tokens/typography.css` streaming, ~4s of those files
finished and switched to Preview, then ~1s back on the board at 5/200. That is
16 of 20 seconds on the document surface, which is why this one capture replaced
two.

The run behind it is a `gen-ui-desc` job, not a code job — it fills this slot
because the board, the decomposition, and the parallel tracking look the same
whichever job kind drives them, which is the claim this slot carries. Swap in a
code-job capture whenever one is shot; nothing else here changes.

Three deviations from the section above, all deliberate:

- **20 seconds, not 8–10.** Chosen for the content — the loop has to return to the
  board to show tasks *arriving* in Completed, and that round trip does not fit in
  ten. It costs the whole 2.5 MB.
- **All three panes, explorer not collapsed to its rail.** The cost is real: at
  `width="880"` the card titles are texture, not text. The column headers, the
  counts, and the cards moving between columns still read, which is what the claim
  needs. Collapsing the explorer would buy legibility back if you reshoot.
- **q78.** 20 seconds at this geometry leaves no choice. Checked at 4× against
  source: the board gradient and the CSS in the code panel are both clean, because
  the frame is dark and mostly flat. Lower fps was measured and rejected — 10fps
  needed a high enough q to erase the frame saving (2.90 MB), and cost motion
  smoothness that this shot is specifically about.

```bash
ffmpeg -ss 37 -t 20 -i in.mov \
  -vf "fps=14,scale=1280:-1:flags=lanczos" frames/f_%04d.png
img2webp -loop 0 -lossy -q 78 -d 71 frames/f_*.png -o code-job.webp
```

**Why WebP rather than GIF.** The frame is mostly a large dark gradient, and any
palette small enough to fit the cap lays visible bayer crosshatch across it —
measured on an earlier 8-second cut of the same UI, GIF needed 128 colours to fit
and the dither was obvious at 4×, while WebP matched source at the same file size.
At 20 seconds GIF is not a contender at all. Homebrew's current `ffmpeg` bottle is
built without `libwebp`, hence `img2webp` from the `webp` formula for pass two.

## Video

A full walkthrough — build loop (PRD → design → code), then one spec-driven
iteration, ending on the preview — runs a couple of minutes. Host it (YouTube,
Loom) and fill in the link in the hero caption.

The video is where everything the capture slot does not cover lives: the live
agent graph, the visual-tier picker, per-model cost breakdowns, the browser IDE,
and the preview actually serving the app. It costs zero repo bytes and never goes
stale in git. **Do not turn any of those into a README image.** Embedded MP4 is
not worth attempting either: GitHub won't autoplay it and repo-relative video
paths are unreliable.

---

## Capture and encoding — GIF or animated WebP, never video

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
rate — a 7-second clip at 14fps reads better than 12 seconds at 8fps.

**Scrolling, not duration, is what breaks the budget.** Appending text changes
few pixels and costs little; a panel that auto-scrolls repaints every pixel and
defeats inter-frame compression. Measured on a document-streaming cut of this same
UI, same geometry and encoder: 8 s is 1.37 MB, but 10 s is 2.62 MB — 25% more
duration for 92% more bytes, because the extra two seconds scroll. So when a
capture blows the cap, find out whether the window scrolls before reaching for
duration or frame rate. Trimming to just before the scroll is worth more than any
amount of palette tuning.

---

# Part 2 — diagrams (the six PNGs)

Diagrams are **authored, not captured**. Each one is an HTML file in
[`diagrams/`](diagrams) baked to PNG by headless Chrome:

```bash
pnpm docs:diagrams              # all six
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
| `workspace.png` | `## Codespace layout` | One bare anchor, features as peer worktrees |
| `codespace-workspace.png` | `## Codespace & workspace` | Two kinds of space over one runtime — canonical jobs and a kanban, or file-defined agents and a checklist |

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
- **Budget: ≤ 300 KB each**, ≤ 1.5 MB for all six. The render script fails the
  run if a file goes over.
- The aurora gradient is the accent, not the background — **use it once per
  diagram**, on the single most important element.

Colour semantics are held constant across the set: violet = agent/compute,
pink = bus/realtime, orange = in-flight/preview, teal = optional/external,
emerald = verified/done, dashed border = optional or deferred.
