## UI SOURCE — FIGMA

### Principle (Identity of the input)

`figma.json` at `outputs/design/ui/figma/figma.json` is a **workfile reference**, not a design artifact. It holds a Figma URL (plus derived `fileKey` / `nodeId`) and **nothing else** — no tokens, no exported frames, no variable dumps.

### Principle (Observable truth)

The authoritative visual data lives in the Figma workfile and is obtained at execute time via the MCP tools listed below. `figma.json` contents alone MUST NOT be used to infer tokens, sizes, or layout — treat the URL as a pointer and always fetch via MCP.

### Available MCP tools

Use these while implementing (they are auto-registered when the `figma` UI source is selected):

- `figma_get_metadata` — discover pages and top-level frames
- `figma_get_design_context` — structured node tree + layout properties
- `figma_get_screenshot` — rendered image of a specific node
- `figma_get_variable_defs` — Figma variables (design tokens)

### Constraint (No silent inference)

- Do NOT paraphrase or extrapolate properties that were not observed in an MCP response.
- Do NOT assume a token system exists unless `figma_get_variable_defs` returned one — fall back to VisualTier defaults instead.

### Blind spot reminder

`fileKey` and the starting `nodeId` are injected into this prompt for convenience; the tool handler already receives `fileKey` through its execution context, so you MAY omit it from tool call arguments if the schema permits.
{{#if figmaFileKey}}

### Current workfile

- `fileKey`: `{{figmaFileKey}}`
{{#if figmaStartNodeId}}- Starting `nodeId`: `{{figmaStartNodeId}}`{{/if}}
{{/if}}
