# Design input guide

Ant accepts three first-class design sources. This guide is the practical
how-to. For the conceptual background, read
[concepts/design-input-channels.md](../../concepts/design-input-channels.md).

## Pick your source

| You have…                                                | Read                                 |
|----------------------------------------------------------|--------------------------------------|
| A Claude.ai artifact / loose HTML / CSS / Markdown / PNG   | [claude-handoff](claude-handoff.md) |
| A Figma project URL                                      | [figma-mcp](figma-mcp.md)            |
| Nothing yet (greenfield) — want Ant to author the design | [claude-handoff](claude-handoff.md) — `gen-ui-desc` writes the same bundle shape |

## At a glance

| Source     | Path                          | License needed | MCP setup | Schema |
|------------|-------------------------------|:--------------:|:---------:|:------:|
| `handoff`  | `visual/ui/handoff/**`        | none           | no        | no     |
| `figma`    | `visual/ui/figma/figma.json`  | Figma          | yes       | yes    |
| `ant`      | `visual/ui/ant/`              | none           | no        | yes    |

## Who writes what

A `design` job's output directory depends on the intent, which in turn depends
on the source you started from:

| Intent         | Input                        | Writes to             | Shape                                     |
|----------------|------------------------------|-----------------------|-------------------------------------------|
| `gen-ui-desc`  | your PRD (`plan/`)           | `visual/ui/handoff/`  | `DESIGN.md` bundle — see [claude-handoff](claude-handoff.md) |
| `gen-ui-figma` | `visual/ui/figma/figma.json` | `visual/ui/ant/`      | canonical JSON trio — see [ant-canonical](ant-canonical.md) |

So `visual/ui/handoff/` is reachable two ways: you drop files there yourself,
or Ant authors them for you from a PRD. Both produce the same `uiSource`
(`handoff`) and the same downstream interpretation contract. The canonical
`visual/ui/ant/` trio is produced **only** by the Figma pipeline.

## Hard-exclusivity

Only one source is active per feature at a time. Ant's
[`normalizeUiSourceRefs`](../../../packages/ant-shared/src/canonical.ts)
enforces this at every RAC-creating site. If you've been iterating in
Claude and want to switch to Figma, move the existing
`visual/ui/handoff/**` files out of the feature (or just delete the
slot from the RAC).

## Game projects

> ⚠️ **In development.** The game domain is scaffolded but not production
> ready. The structure described below is wired in code; end-to-end
> game-design generation is still being validated. Use the `service`
> domain for production work.

Game projects use `visual/game-art/` instead of `visual/ui/`. The
sub-source structure mirrors UI:

- `visual/game-art/ant/` — generated game-art tokens, assets, spec.
- `visual/game-art/handoff/` — free-form handoff bundle, symmetric with the
  UI handoff surface. Active: `gen-game-art-desc` writes here.
- `visual/game-art/figma/` — reserved for Phase 5+ (parser-only hook).

The HUD CSS tokens for game projects live inside `game-art-tokens.json`
alongside the in-canvas categories — there's no parallel `ui-tokens.json`
for a game workspace. See
[concepts/design-input-channels.md § The game domain mirror](../../concepts/design-input-channels.md#the-game-domain-mirror).
