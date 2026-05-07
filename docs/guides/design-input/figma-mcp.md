# Figma MCP

Use Figma as your design source via the **Model Context Protocol** (MCP).
Ant fetches frames, variables, styles, and screenshots at prompt time —
nothing is persisted to disk except a small `figma.json` metadata file.

## Why MCP and not "convert Figma to JSON"?

Two reasons:

- **Live data.** A persisted snapshot drifts the moment you edit Figma.
  MCP makes the agent fetch fresh data every prompt run, so you don't
  maintain a sync.
- **Bidirectional.** With Code Connect, the agent can write back to
  Figma — generate variables from code tokens, build component instances
  from React components, etc.

The single piece of state Ant stores is a tiny `figma.json` with the URL
and node id. **No frame dumps, no variable dumps, no screenshots persisted.**
Attempting to persist exploration results into `figma.json` is forbidden
by [AGENTS.md § UiSource](../../../AGENTS.md#uisource--three-hard-exclusive-ui-inputs).

## Setup (local mode — desktop MCP)

Install the official Figma MCP server (Cursor, Claude Code, or any
MCP-compatible client). The MCP runs on your machine; Ant talks to it
through standard MCP transport.

In Cursor: see the [Figma MCP plugin docs](../../internals/26-figma-integration-infra.md).

Once the MCP is up:

1. Open the Ant wizard for your feature.
2. Pick **Figma** as the design source.
3. Paste a Figma URL. Ant validates it and writes `visual/ui/figma/figma.json`:

   ```json
   {
     "url": "https://www.figma.com/design/<fileKey>/<fileName>?node-id=<nodeId>",
     "nodeId": "1:23"
   }
   ```

That's the entire setup. The `resolvedAction.mcpSources.figma` field is
auto-populated by the resolve phase based on the disk content; you don't
configure transport elsewhere.

## Setup (cloud mode)

In cloud mode, Ant ships an HTTP bridge that proxies MCP-shaped requests
to a long-lived Figma session. The setup steps are:

1. Configure `ANT_FIGMA_BRIDGE_URL=https://your-bridge.example.com` in
   the `ant-job` Deployment.
2. Provide credentials via `ANT_FIGMA_TOKEN` (Personal Access Token) in
   the Deployment Secret.
3. Same wizard flow as local — paste the URL, the metadata file lands on
   the EFS mount.

The bridge handles authentication, file access scoping, and rate-limit
back-off. Ant's prompt code never reaches Figma directly in cloud mode.

## Use it in a directive

```
Implement the page in the Figma source.
```

The agent will:

1. Read `visual/ui/figma/figma.json` to discover the URL + nodeId.
2. Fetch frame structure (`get_design_context` or `get_metadata`).
3. Fetch screenshots when it needs them (`get_screenshot`).
4. Fetch styles + variables to map design tokens to code tokens.
5. Generate code that respects the layout, the variables, and any Code
   Connect mappings.

For game projects, the same flow will use `visual/game-art/figma/`
once the **game vertical exits development** (reserved for Phase 5+;
the `visual/game-art/handoff/` and `figma/` sub-sources are not active
yet).

## Code Connect

If your Figma library has Code Connect mappings, the agent picks up the
mapped code components automatically. To set them up:

1. Author `*.figma.ts` files in your code repo.
2. Run `figma connect publish` to register them.
3. Ant's prompt path will surface mapped components when generating code.

The full skill is documented in
[`figma-code-connect`](https://www.figma.com/code-connect-docs/) (Figma's
docs).

## Bidirectional mode

The `design` jobtype with intent `gen-ui-figma` can also write **into**
Figma using the `use_figma` MCP tool. Use cases:

- Mirror code tokens into Figma variables.
- Build a Figma frame from a React component.
- Update a Figma component to match the latest code.

This is the "design library" workflow — see the
[figma-generate-library](https://www.figma.com/plugins/code-connect)
skill if you've installed the Figma plugin.

## Troubleshooting

### "Could not resolve Figma source"

The agent didn't find `visual/ui/figma/figma.json` or the file is
malformed. Verify it exists and contains both `url` and `nodeId`.

### MCP timeouts

Figma's MCP server can be slow on large files. If you see timeout errors:

- Reduce the scope by passing a smaller `nodeId` (a specific frame, not
  the entire file).
- Pre-warm the MCP by making one manual request before kicking off a
  long agent run.

### Variables out of sync between Figma and code

Run `figma connect publish` from your code repo to refresh mappings, then
ask Ant to re-fetch.

### Persisted exploration results in `figma.json`

This is a forbidden state. The file should contain only `url` + `nodeId`
(plus optional `branchKey` / `linkOpenedAt`). If you find dumped frames or
variables in there, delete them — Ant will regenerate the metadata.

## Read next

- [claude-handoff](claude-handoff.md) — the no-license alternative.
- [ant-canonical](ant-canonical.md) — generate tokens directly from a
  description.
- [internals/26-figma-integration-infra.md](../../internals/26-figma-integration-infra.md)
  — MCP transport internals.
- [internals/25-design-pipeline.md](../../internals/25-design-pipeline.md)
  — design pipeline overview.
