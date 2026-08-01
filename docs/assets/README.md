# README assets — capture guide

This directory holds the images the READMEs reference. Every slot is currently
an HTML comment in [`README.md`](../../README.md); drop a file here with the
matching name and uncomment the block.

`README.ko.md` reuses the same files. Do not shoot a Korean set — the UI is
localised, but a second set of images doubles the repo weight and guarantees
the two drift.

## Slots

| File | Format | README location |
|---|---|---|
| `hero-kanban.gif` | GIF | Top, under the badges |
| `spec-iteration.gif` | GIF | `## Why Ant?`, after the iteration-loop item |
| `spec-artifacts.png` | still | End of `## Why Ant?` |
| `design-handoff.png` | still | `## Bring your own design`, after the guide link |
| `basis-moodboard.png` | still | End of `## Bring your own design` |
| `agent-graph.gif` | GIF | `## How it works`, after the LangGraph paragraph |
| `shell-3pane.png` | still | `## Features` grid |
| `token-cost.png` | still | `## Features` grid |
| `preview-console.png` | still | `## Features` grid |
| `browser-ide.png` | still | `## Features` grid |

---

## 1. `hero-kanban.gif` — the one that matters

**What to run.** A service-domain project with a PRD already in place. Give a
directive big enough to land in Tier 3, so decompose emits two or more tasks
**plus a Final Verification task**.

**Framing.** Task board in the centre, chat on the right, **explorer collapsed
to its rail** — at README width a three-pane shot makes the cards unreadable.
Dark theme, so the background gradient shows between the columns. Leaving a
thin strip of browser chrome with `localhost:4200` visible is worth it: it
proves the self-hosted claim without a caption.

**When to start recording.** At the `decompose` node, so the loop captures:
estimating skeletons shimmering → tasks popping into To Do → a card springing
across to In Progress with the live node indicator underneath → landing in
Completed. Meanwhile the chat fills with colour-coded work cards.

**The one thing that must be in frame: the Final Verification card.** Every
competitor's demo shows an agent working through a to-do list. What makes Ant
different is that verification is a queued, first-class task that runs last and
can block completion. If that card isn't visible, this is just another
todo-agent GIF and the whole shot is wasted.

10–12 seconds, looping.

## 2. `spec-iteration.gif` — the iteration-loop shot

**What to run.** A project that already has a codebase and a spec document
(`gen-spec` output under `architecture/spec/`). Kick off a `gen-code-spec`
job with that spec selected as the ref.

**Framing.** Split view: the spec document readable on the left, the task
board on the right. The point of the shot is *causality* — the viewer should
see that the tasks on the board are the spec's sections becoming real.

**When to start recording.** With the spec on screen, then the job starting:
decompose → tasks appearing → cards moving → the verification card
completing last. One loop = one spec becoming verified code.

This is the README's "plan mode, but persistent" claim in motion — if the
spec text isn't legible enough to be recognisably a plan, reshoot.

8–10 seconds, looping.

## 3. `spec-artifacts.png` — the thesis shot

Explorer expanded on `plan/` and `architecture/`, centre pane showing a
generated system design document scrolled to a **rendered architecture
diagram**.

This is the most argument-aligned image in the set. "Not vibe coding" is a
claim; a readable design document that the code was checked against is the
evidence.

## 4. `design-handoff.png` — the design-output shot

Explorer expanded on `visual/ui/handoff/`, centre pane showing the generated
`DESIGN.md` with the bundle tree (`styles.css`, `tokens/`, `components/`,
`screens/`) visible beside it. A rendered screen HTML in a second tab is a
bonus if it fits without shrinking the document below readability.

This backs the "UI design is a pipeline stage" claim: `basis-moodboard.png`
shows the *input* (picking a direction); this shows the *output* the code
job builds against. Don't swap their roles.

## 5. `basis-moodboard.png` — the wow shot

Actions panel → an action that carries a visual tier → the **Visual Tier** tab →
the full grid of style variants, one selected so the ring and check mark show,
with the light/dark mode pill in frame.

Caption it as **input selection**. It is not a gallery of generated output —
there is no such screen, and implying one would be a promise the product
doesn't keep.

## 6. `agent-graph.gif`

Same job as the hero, switched to the workflow view. Aim for the moment
`execute` is running with **two or more parallel workers**, so the worker chips
fan out beneath the node. The camera panning and zooming between nodes as
execution advances is the point of the shot — let it move at least twice.

8 seconds, looping.

## 7–10. Feature grid stills

- **`shell-3pane.png`** — the full three-pane workspace. Shoot this one in
  **light theme** so the README shows both. Try to have a file card with
  add/remove counts and a terminal card with coloured output visible in chat.
- **`token-cost.png`** — after a job that used more than one model, open the
  token breakdown. Real numbers; do not doctor them. Cost transparency at this
  granularity is a genuine differentiator for a bring-your-own-key audience.
- **`preview-console.png`** — the preview configuration page with detected
  service connections and the docked console streaming build output.
- **`browser-ide.png`** — VS Code connected and filling the pane.

## Video

A full walkthrough — build loop (PRD → design → code), then one spec-driven
iteration, ending on the preview — runs a couple of minutes. **Do not make that a GIF** — the file size and frame rate both fall
apart. Host it (YouTube, Loom) and fill in the link next to the hero. Embedded
MP4 is not worth attempting: GitHub won't autoplay it and repo-relative video
paths are unreliable.

---

## Capture and encoding

- Record a 1440×900 logical viewport at 2× DPI. Downscale to **1280px wide for
  GIFs**, **1600px for stills**.
- **Dark theme by default** — the background gradient is most of the visual
  identity. `shell-3pane.png` is the deliberate light-theme exception.
- **Hygiene**: use a neutral demo project name (`storefront`, feature
  `feature/checkout`), not a real customer's. Shoot in local mode so no real
  account identity appears. Keep the explorer narrow enough that your home
  directory path isn't legible.
- **Size budget**: hero GIF ≤ 4 MB, other GIFs ≤ 1.5 MB, stills ≤ 300 KB,
  **≤ 10 MB total** (ten slots now — the previous 8 MB line predates
  `spec-iteration.gif` and `design-handoff.png`). These files live in git
  history permanently; past this line they become a clone-time tax on
  everyone.

```bash
# recording → GIF
ffmpeg -i in.mov -vf "fps=14,scale=1280:-1:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=192[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 hero-kanban.gif

# smaller alternative — GitHub renders animated WebP
ffmpeg -i in.mov -vf "fps=14,scale=1280:-1:flags=lanczos" \
  -c:v libwebp -q:v 55 -loop 0 -an hero-kanban.webp

# stills
pngquant --quality=70-90 --strip --force --output shell-3pane.png -- raw.png
```

If a GIF refuses to fit the budget, shorten the loop before lowering the frame
rate — a 7-second clip at 14fps reads better than 12 seconds at 8fps.
