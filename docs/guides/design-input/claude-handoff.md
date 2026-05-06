# Claude handoff

Drop a Claude.ai artifact (or any free-form design bundle) into your
workspace and Ant will use it as the design source for code generation.

This is often the **lowest-friction entry point**. No Figma license. No
MCP setup. No schema conversion. Just files.

## What you can drop

The `handoff` source is **observation-only**. Anything the agent can read
is fair game:

- HTML pages (`.html`)
- CSS / SCSS files
- Markdown notes describing the UI
- Screenshots / mockups (`.png`, `.jpg`)
- Token dumps (`.json`)
- A copied chat transcript explaining what should be built

The agent does **not** infer a hidden schema. It treats what you provide
as the contract: the FPOP "Observable over Assumed" rule applies. If you
declare a token, it's a token; if you don't, the agent doesn't invent one.

## Drop it

```bash
# Inside your feature workspace
mkdir -p visual/ui/handoff
cp ~/Downloads/claude-artifact-export/* visual/ui/handoff/
```

If you exported from Claude.ai as a single ZIP, just unzip it into
`visual/ui/handoff/`. The directory is picked up automatically the next
time you open the wizard.

The wizard's "Bring your own design" step shows the slot is populated:

```
Design source:
  ✓ visual/ui/handoff/  (3 files)
```

## Wire it into a directive

Send a directive that asks for code based on the bundle:

```
Build the page from the design in visual/ui/handoff/.
Use Tailwind for styling. Match the visual hierarchy and colors exactly.
```

Internally Ant:

1. Resolves the RAC: the handoff directory becomes a `context` (or `ref`,
   depending on intent) artifact slot.
2. Picks the `ui-source-handoff` partial which tells the agent to
   inspect-don't-infer.
3. Decomposes and executes per the design.

Read [concepts/design-input-channels.md](../../concepts/design-input-channels.md)
for the slot mechanics and which intents read the source as `ref` vs
`context`.

## Examples that work well

- Single-page mockup: drop `index.html` + `style.css` + `screenshot.png`.
- Multi-page bundle: keep filenames descriptive
  (`landing.html`, `pricing.html`, etc.) so the agent can map them.
- Token-heavy: include a `tokens.json` with named values. The handoff
  prompt will respect the tokens as authored.
- Annotated mockup: drop a `notes.md` next to the screenshots describing
  intent ("primary button is azure, hover state should darken 10%").

## What works less well

- **Pixel-precise replication of complex screenshots without HTML.** With
  only an image, the agent will produce a layout that matches the visual
  hierarchy but won't pixel-match. If you need pixel-precise output,
  include the source HTML/CSS.
- **Implicit design systems.** If the bundle uses tokens informally
  ("everywhere we use blue-600"), state them explicitly. The FPOP rule
  prevents guessing.
- **Massive bundles.** Drop only what's relevant. The agent reads what's
  in the RAC; bigger directories cost more tokens.

## Troubleshooting

### The agent says it can't find the design

Check that the slot is in the RAC. The wizard should show the handoff
directory as a populated source. If the RAC is built from an
intent that doesn't include UI as a slot (e.g. `gen-code-directive` with
no design), the handoff content won't be read.

To force the agent to use it, populate the `Reference` or `Context` slot
in the wizard before sending the directive.

### The agent generated tokens that don't exist in my bundle

Likely causes:

- You used a Tier 0/1 directive (`add a button`) without specifying the
  design. The direct path doesn't read the handoff slot.
- The handoff partial allows the agent to introduce tokens when the
  bundle doesn't declare them. To prevent this, include explicit token
  files in your bundle.

### I want to round-trip changes back to Claude

Currently one-way only. The handoff source is read; Ant's outputs land
in `codebase/`. Future versions may emit a "what changed" report you can
paste back into Claude.

## Comparison

| Question                                  | `handoff`     | `figma`              | `ant`                |
|-------------------------------------------|---------------|----------------------|----------------------|
| License needed?                            | None          | Figma                | None                 |
| Setup cost                                 | Zero          | MCP server           | One design job       |
| Schema                                     | None (FPOP)   | Figma vars + styles  | `ui-tokens.json`     |
| Best for                                   | Existing Claude designs | Figma teams      | Greenfield           |
| Round-trip to source                       | No            | Yes (Code Connect)   | Within Ant           |

## Read next

- [figma-mcp](figma-mcp.md) — bidirectional Figma source.
- [ant-canonical](ant-canonical.md) — generate tokens with the design job.
- [concepts/design-input-channels.md](../../concepts/design-input-channels.md)
  — the conceptual background.
