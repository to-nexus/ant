{{!--
  Per-UiSource planning guidance for `design-system` and `ui` task types.
  Dispatched by `plan/rules.md` when `hasUi` is true. Each `uiSource` branch
  describes which inventory steps the plan MUST produce. The Gate `hasUi`
  stays the outer condition — this partial only fires when at least one UI
  source is selected.
--}}
{{#if hasUi}}
{{#if (eq taskType "design-system")}}

**FOR `design-system` TASKS ({{uiSource}} source):**

{{#if (eq uiSource 'ant')}}
1. **TOKEN INVENTORY**
   - Extract ALL token keys and values from ui-tokens.json
   - Group by category (colors, typography, spacing, etc.)
   - Identify target output: CSS custom properties and/or styling framework theme config
   - Record tokens with ACTUAL values (not just key names): `--color-bg-default: #1a1a2e`

2. **INTEGRATION CHAIN**
   - Identify the global CSS entry file and the CSS framework in use
   - Plan the import chain: entry file → token files, typography files
   - Plan the framework bridge: CSS vars → utility classes
   - Each integration file must appear in `create` or `modify`
{{/if}}

{{#if (eq uiSource 'figma')}}
1. **TOKEN INVENTORY (deferred to MCP)**
   - Token values are NOT read ahead of time. Plan a token extraction step that calls `figma_get_variable_defs` at execute time and records the returned values into the design-system output.
   - If Figma variables are absent, plan to infer tokens from observed node properties via `figma_get_design_context` — explicitly.
   - Constraint: Do NOT paraphrase tokens from `figma.json` itself — it carries only the workfile URL.

2. **INTEGRATION CHAIN**
   - Identify the global CSS entry file and the CSS framework in use
   - Plan: extract tokens via MCP → write token file → wire import chain → extend framework theme config
   - Each integration file must appear in `create` or `modify`
{{/if}}

{{#if (eq uiSource 'handoff')}}
1. **TOKEN INVENTORY (deferred to read_file)**
   - The handoff bundle is injected as a STUB manifest (path + size + kind). File contents are not pre-loaded. Scan the manifest and pick the minimum set of text entries likely to carry token-level information (css, design-system markdown, json).
   - Plan to call `read_file("<path>", startLine, endLine)` at execute time on each selected entry; do NOT dump contents into this plan.
   - Record for each planned read: (a) the path, (b) the property family expected (colour / spacing / radius / typography), (c) why that file is the most explicit source per property.
   - Constraint: Do NOT assume schema consistency across files. If two files claim the same property, the plan MUST pick ONE authoritative file rather than merging.
   - Constraint: Do NOT plan reads on binary-kind entries — reference them by path only.

2. **INTEGRATION CHAIN**
   - Identify the global CSS entry file and the CSS framework in use
   - Plan the import chain and framework bridge as with canonical tokens
   - Each integration file must appear in `create` or `modify`
{{/if}}

{{/if}}
{{#if (eq taskType "ui")}}

**FOR `ui` TASKS ({{uiSource}} source):**

{{#if (eq uiSource 'ant')}}
4. **ASSET INVENTORY**
   - Search ui-assets.json for assets related to this task
   - List ALL assets with source → destination mappings

5. **LAYOUT & COMPONENT SPECS**
   - Extract layout properties from ui-spec (flexDirection, alignItems, grid*)
   - Record token references with ACTUAL values (not just key names)
   - Record `visibleWhen` conditions and the parent component where enforcement is needed
   - Record all interactive elements (preset buttons, toggles, conditional content) from `interactionStates`
{{/if}}

{{#if (eq uiSource 'figma')}}
4. **FRAME SELECTION**
   - Identify the Figma frame(s) that correspond to this task's surface area
   - Record `nodeId` values for each frame; these feed `figma_get_design_context` / `figma_get_screenshot` at execute time
   - If the starting `nodeId` is ambiguous, plan a `figma_get_metadata` call first

5. **LAYOUT & COMPONENT OBSERVATION (deferred to MCP)**
   - Plan to observe layout properties via `figma_get_design_context` at execute time
   - Plan to use `figma_get_screenshot` for visual verification
   - Constraint: Do NOT commit to specific token values here — they come from the MCP response
{{/if}}

{{#if (eq uiSource 'handoff')}}
4. **HANDOFF EVIDENCE MAP (read-plan, not content)**
   - The bundle is injected as a STUB manifest. For each manifest entry the task might consult, record: (a) the path, (b) the visual aspect it likely covers (layout / tokens / asset list / copy / interaction), (c) whether execute will need a full read or a ranged read (`startLine` / `endLine`).
   - Constraint: Binary-kind entries (png/jpg/woff/…) appear in the plan ONLY as `<img src>` / `url(...)` references. Never schedule `read_file` on them.
   - Constraint: One task may plan to read multiple handoff files; two tasks must NOT both claim exclusive ownership of the same file unless the content partitions cleanly.

5. **LAYOUT & COMPONENT OBSERVATION (deferred to read_file)**
   - Do NOT commit to specific layout values here — they come from `read_file` at execute time against the paths recorded in step 4.
   - Plan the extraction order: which file is read first, what property is expected from it, and what to do if the observation is absent.
   - Constraint: If a property is not observable in any planned read, note it as "unspecified" and defer to framework conventions — do NOT invent.
{{/if}}

{{/if}}
{{/if}}
