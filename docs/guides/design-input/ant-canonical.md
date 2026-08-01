# Ant-native canonical design

The `visual/ui/ant/` surface holds **canonical token + spec + assets** JSON,
which subsequent code jobs read as authoritative. This is the
**schema-based** UI source — the agent treats
`ui-tokens.json` / `ui-spec.json` / `ui-assets.json` as a structured contract.

> **Only the Figma pipeline writes here.** `gen-ui-figma` derives the canonical
> trio from a Figma workfile. If you have no existing design, the greenfield
> intent is `gen-ui-desc`, and it writes a **handoff bundle** to
> `visual/ui/handoff/` instead — see
> [claude-handoff.md](claude-handoff.md). Both are first-class; they differ in
> shape (structured JSON vs. an observable HTML/CSS bundle), not in standing.

## What gets generated

For service projects:

```
visual/ui/ant/
├── ui-tokens.json          Palette, spacing, type scale, radii, shadows
├── ui-spec.json            Layout intent: sections + components
└── ui-assets.json          Asset catalog (logos, icons, illustrations)
```

For game projects (**in development** — see notice in
[Game projects](#game-projects) below):

```
visual/game-art/ant/
├── game-art-tokens.json    Palette, silhouette, motion-tone + HUD CSS tokens
├── game-art-spec.json      In-canvas + HUD/menu/dialog categories
└── game-art-assets.json    Inline payloads + external mapping
```

The schemas are versioned in `@ant/shared/canonical.ts`. Code jobs map
tokens to platform primitives (Tailwind classes, CSS variables, or
whatever your stack uses).

## Generate the design

Point Ant at a Figma workfile (`visual/ui/figma/figma.json`) and run a
`design` job. Detect resolves the intent to `gen-ui-figma`, and the job:

1. **resolve / triage / detect** — identifies a `design` job with intent
   `gen-ui-figma`.
2. **decompose** — produces `design-system` and `feature` design tasks.
3. **plan / execute** per task — explores the workfile live over the Figma MCP
   server and writes the JSON artifacts.
4. **learn** — checkpoints the session.

Outputs land in `visual/ui/ant/`. Setting the workfile up is covered in
[figma-mcp.md](figma-mcp.md).

If you have only a textual description ("modern dark dashboard, navy +
electric blue accents, generous spacing") and no Figma file, that is the
`gen-ui-desc` path — it produces a handoff bundle, not this trio.

## Iterate on the design

Send follow-up directives:

```
Tighten the spacing scale. The current 6/12/24 feels too loose.
Add a warning color token for surfaced errors.
```

Each follow-up runs another `design` job which reads the existing
artifacts as authoritative input, mutates them, and re-emits the
relevant files.

## Use it in a code job

Once the design exists, write code:

```
Implement the dashboard per the design system.
```

The code job:

1. Detects `visual/ui/ant/**` is the active UI source.
2. Activates the `ui-source-ant` partial, which tells the agent to map
   tokens by name and respect the spec layout.
3. Generates code that imports tokens (Tailwind config, CSS variables,
   etc.) by their canonical names.

The token mapping is one-way: the design system is authoritative; code
follows. To change a token, edit the design (run another design job)
and re-run code.

## Game projects

> ⚠️ **In development.** The game-domain canonical pipeline is scaffolded
> — the schema, intents, and prompt overlays are wired — but not
> production ready. End-to-end generation is still being validated.

Game workspaces use `visual/game-art/ant/`. The `game-art-tokens.json`
includes both in-canvas categories (sprites, particles, projectiles,
audio) and HUD CSS tokens (spacing, typography, radius, shadow). There
is no parallel `ui-tokens.json` for games — `gameArtTier` is the single
visual SSOT for the game domain. See
[concepts/design-input-channels.md § The game domain mirror](../../concepts/design-input-channels.md#the-game-domain-mirror).

## Troubleshooting

### The design job ran but produced no files

The design job emits files only when it has enough signal to design
something. For a vague directive, it may write the spec but not the
tokens. Send a more specific directive ("generate the full token set
from the description above").

### Code generation ignores my tokens

Two common causes:

- The code job picked up a different UI source. Check the wizard — only
  one of `ant` / `figma` / `handoff` is active at a time.
- The intent doesn't read UI as a slot. Some intents (e.g.
  `gen-code-directive` with no design signal) won't reference design.

### How are tokens versioned?

`canonical.ts` includes a schema version. Future Ant releases will run
migrations on existing files. For now, pin to a release.

## Comparison

| Question            | `ant`                        | `figma`              | `handoff`                       |
|---------------------|------------------------------|----------------------|----------------------------------|
| Schema              | canonical JSON trio          | Figma vars + styles  | None (FPOP)                      |
| Written by          | `gen-ui-figma`               | you (the workfile)   | `gen-ui-desc`, or you            |
| Read direction      | one-way (design → code)      | one-way (read-only)  | one-way (design → code)          |
| Best for            | Figma teams wanting JSON     | Existing Figma teams | Greenfield, or Claude/HTML designs |
| Setup               | MCP server + one design job  | MCP server           | Drop the files, or one design job |

## Read next

- [claude-handoff](claude-handoff.md) — for existing free-form designs.
- [figma-mcp](figma-mcp.md) — for Figma teams.
- [internals/25-design-pipeline.md](../../internals/25-design-pipeline.md)
  — design pipeline internals.
- [internals/27-visual-processor.md](../../internals/27-visual-processor.md)
  — image asset extraction.
