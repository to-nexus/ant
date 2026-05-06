# Design input guide

Ant accepts three first-class design sources. This guide is the practical
how-to. For the conceptual background, read
[concepts/design-input-channels.md](../../concepts/design-input-channels.md).

## Pick your source

| You have…                                              | Read                                       |
|--------------------------------------------------------|--------------------------------------------|
| A Claude.ai artifact / loose HTML / CSS / Markdown / PNG | [claude-handoff](claude-handoff.md)       |
| A Figma project URL                                    | [figma-mcp](figma-mcp.md)                  |
| Nothing yet (greenfield) — want Ant to generate tokens | [ant-canonical](ant-canonical.md)         |

## At a glance

| Source     | Path                          | License needed | MCP setup | Schema | Round-trip |
|------------|-------------------------------|:--------------:|:---------:|:------:|:----------:|
| `handoff`  | `visual/ui/handoff/**`        | none           | no        | no     | no         |
| `figma`    | `visual/ui/figma/figma.json` | Figma          | yes       | yes    | yes (Code Connect) |
| `ant`      | `visual/ui/ant/`              | none           | no        | yes    | within Ant |

## Hard-exclusivity

Only one source is active per workspace at a time. Ant's
[`normalizeUiSourceRefs`](../../../packages/ant-shared/src/canonical.ts)
enforces this at every RAC-creating site. If you've been iterating in
Claude and want to switch to Figma, move the existing
`visual/ui/handoff/**` files out of the workspace (or just delete the
slot from the RAC).

## Game projects

Game projects use `visual/game-art/` instead of `visual/ui/`. The
sub-source structure mirrors UI:

- `visual/game-art/ant/` — generated game-art tokens, assets, spec.
- `visual/game-art/figma/` and `visual/game-art/handoff/` — reserved for
  Phase 5+.

The HUD CSS tokens for game projects live inside `game-art-tokens.json`
alongside the in-canvas categories — there's no parallel `ui-tokens.json`
for a game workspace. See
[concepts/design-input-channels.md § The game domain mirror](../../concepts/design-input-channels.md#the-game-domain-mirror).
