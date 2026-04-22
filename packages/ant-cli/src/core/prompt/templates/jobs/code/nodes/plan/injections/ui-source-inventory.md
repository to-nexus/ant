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
1. **TOKEN INVENTORY (observational)**
   - Scan the injected handoff files for repeating colour, spacing, radius, typography values
   - Pick the most explicit representation per property (e.g. CSS custom property over HTML attribute)
   - Constraint: Do NOT assume schema consistency across files; merge only when content explicitly states the relation
   - Record tokens with ACTUAL values and the source filename they were observed in

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
4. **HANDOFF EVIDENCE MAP**
   - For each injected handoff file relevant to this task, record which visual aspect it covers (layout / tokens / asset list / copy / interaction)
   - Constraint: One task may read multiple handoff files; two tasks must NOT claim exclusive ownership of the same file unless the content explicitly partitions

5. **LAYOUT & COMPONENT OBSERVATION**
   - Extract layout properties ONLY from what the handoff files explicitly show
   - Constraint: If a property is not observable, note it as "unspecified" and defer to framework conventions — do NOT invent
{{/if}}

{{/if}}
{{/if}}
