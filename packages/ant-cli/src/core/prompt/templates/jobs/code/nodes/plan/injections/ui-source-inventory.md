{{!--
  Per-UiSource planning guidance for `design-system` and `ui` task types.
  Dispatched by `plan/rules.md` only inside its `{{#if hasUi}}` branch — that
  dispatch-site Gate is the single owner of the `hasUi` presence condition.
  This partial therefore does NOT re-gate on `hasUi` (an inner gate would be
  always-true here, a job-wide signal duplicated where the outer one already
  decided it); it branches by `taskType` and the `uiSource` discriminator only.

  Structure:
    - Each branch lists its inventory items as bullet sections
      (bold header + bullets) instead of numbered steps so this partial
      composes cleanly regardless of how many numbered steps the dispatching
      template already authored.
    - The **INTEGRATION CHAIN** item is identical across `ant` / `figma` /
      `handoff`, so it is authored once after the source-specific token
      section, not duplicated per branch.
    - A task-type boundary statement sits above the `ui` branches as a
      source-agnostic reminder (token infrastructure is the design-system
      task's responsibility; ui tasks observe tokens but do not author them).
      It matters most for handoff (where token-shape and code-shape files
      mix in one manifest) but applies uniformly to all sources.
--}}
{{#if (eq taskType "design-system")}}

**FOR `design-system` TASKS ({{uiSource}} source) — inventory items to cover in the plan:**

{{#if (eq uiSource 'ant')}}
**TOKEN INVENTORY**
- Extract ALL token keys and values from ui-tokens.json
- Group by category (colors, typography, spacing, etc.)
- Identify target output: CSS custom properties and/or styling framework theme config
- Record tokens with ACTUAL values (not just key names): `--color-bg-default: #1a1a2e`
{{/if}}

{{#if (eq uiSource 'figma')}}
**TOKEN INVENTORY (deferred to MCP)**
- Token values are NOT read ahead of time. Plan a token extraction step that calls `figma_get_variable_defs` at execute time and records the returned values into the design-system output.
- If Figma variables are absent, plan to infer tokens from observed node properties via `figma_get_design_context` — explicitly.
- Constraint: Do NOT paraphrase tokens from `figma.json` itself — it carries only the workfile URL.
{{/if}}

{{#if (eq uiSource 'handoff')}}
**TOKEN READ PLAN (deferred to read_file)**
- Apply the **Discipline (Survey-first, guide-then-execute)** section that appears earlier in this same prompt. The survey identifies token-level entries (css, design-system markdown, json); the manifest's guide (if any) is the SSOT for ordering and exclusions.
- Plan the `read_file("<path>", startLine, endLine)` calls in that surveyed-guide order. Do NOT dump file contents into this plan.
- Binary-kind entries (png/jpg/woff/…) are path-only references — never schedule `read_file` on them.
- Code-shaped entries (per the code-shape discipline section earlier in this prompt) belong to ui-task observation, not token transcription.
{{/if}}

**INTEGRATION CHAIN** (common across UI sources)
- Identify the global CSS entry file and the CSS framework in use
- Plan the wiring: token output → entry-file import → framework theme config and/or utility-class bridge (use whichever the framework supports)
- Each integration file must appear in `create` or `modify`

{{/if}}
{{#if (eq taskType "ui")}}

**FOR `ui` TASKS ({{uiSource}} source) — inventory items to cover in the plan (in addition to the ui-task plan steps defined above):**

> Task-type boundary: token-level infrastructure (design tokens, theme config, global CSS) is the **design-system task's** responsibility. A ui task may **reference** token values from the source but MUST NOT (re-)author the token output — assume the design-system task has already produced it or will produce it in parallel.

> ⚠️ Blind spot: this inventory enumerates what the source COVERS — it is not the scope ceiling. A surface, state, or element required by the requirement set but absent from the source is STILL planned here (its visual details fall back per **Visual Source Authority**); a missing asset never drops a required surface from the plan.

{{#if (eq uiSource 'ant')}}
**ASSET INVENTORY**
- Search ui-assets.json for assets related to this task
- List ALL assets with source → destination mappings

**LAYOUT & COMPONENT SPECS**
- Extract layout properties from ui-spec (flexDirection, alignItems, grid*)
- Record token references with ACTUAL values (not just key names)
- Record `visibleWhen` conditions and the parent component where enforcement is needed
- Record all interactive elements (preset buttons, toggles, conditional content) from `interactionStates`
{{/if}}

{{#if (eq uiSource 'figma')}}
**FRAME SELECTION**
- Identify the Figma frame(s) that correspond to this task's surface area
- Record `nodeId` values for each frame; these feed `figma_get_design_context` / `figma_get_screenshot` at execute time
- If the starting `nodeId` is ambiguous, plan a `figma_get_metadata` call first

**LAYOUT & COMPONENT OBSERVATION (deferred to MCP)**
- Plan to observe layout properties via `figma_get_design_context` at execute time
- Plan to use `figma_get_screenshot` for visual verification
- Constraint: Do NOT commit to specific token values here — they come from the MCP response
{{/if}}

{{#if (eq uiSource 'handoff')}}
**READ PLAN (deferred to read_file)**
- Apply the **Discipline (Survey-first, guide-then-execute)** section that appears earlier in this same prompt under the "UI SOURCE — HANDOFF" block: the survey + the manifest's guide (if any) determine which files this ui task reads and in what order.
- Plan the `read_file("<path>", startLine, endLine)` calls in that order. Do NOT dump file contents into this plan.
- Binary-kind entries (png/jpg/woff/…) are path-only references — never schedule `read_file` on them; reference them as `<img src>` or `url(...)` in the emitted code.
- For code-shaped entries (per the code-shape discipline section earlier in this prompt), the plan MUST observe intent only — do NOT plan actions like "copy this component" or "reuse this markup". Implementation is authored at execute time under the target codebase's framework and sibling conventions.
- If a design property is not observable in any planned read, note it as "unspecified" and defer to framework conventions; do NOT invent.
{{/if}}

{{/if}}
