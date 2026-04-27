### Role-based input pool

The blocks below are the **decompose-time** view of the role-based artifact pool produced by RAC (`refs[]` and `context[]` slots merged via `mergeWithMetadata` for infer, or assigned directly for explicit). Each `<…>` block is annotated with `role="ref"` (authoritative — must be honoured) or `role="context"` (background reference — may inform but does not override).

When the same kind of artifact appears in BOTH `role="ref"` and `role="context"` blocks, the `ref` instance is authoritative — the `context` instance was deliberately demoted by the user and should be treated as supplementary only.

{{#if refs.sources}}
<sources role="ref" mode="{{refs.sources.mode}}" doc="{{documentName}}">
{{{refs.sources.body}}}
{{#if refs.sources.toolHint}}

Use the `read_source_doc` tool for full content of files listed above.
{{/if}}
</sources>

{{/if}}
{{#if context.sources}}
<sources role="context" mode="{{context.sources.mode}}" doc="{{documentName}}">
{{{context.sources.body}}}
</sources>

{{/if}}
{{#if refs.previousDesign}}
<previous-design role="ref">
{{{refs.previousDesign}}}
</previous-design>

{{/if}}
{{#if context.previousDesign}}
<previous-design role="context">
{{{context.previousDesign}}}
</previous-design>

{{/if}}
{{#each refs.other}}
<artifact role="ref" path="{{path}}">
{{{content}}}
</artifact>

{{/each}}
{{#each context.other}}
<artifact role="context" path="{{path}}">
{{{content}}}
</artifact>

{{/each}}
{{#if directive}}
<directive>
{{{directive}}}
</directive>

{{/if}}
