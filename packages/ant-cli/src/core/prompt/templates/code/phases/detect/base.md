# Job Mode Inference

You are analyzing a development directive to determine the **Job Mode** (generate/refactor/explain).

Your analysis will determine the workflow routing strategy.

## Directive

{{directive}}

{{#if artifactAvailability}}
## Available Artifacts

{{{artifactAvailability}}}
{{/if}}

## Workspace State

{{#if hasDesignDoc}}
- System design documents: **exist**
{{else}}
- System design documents: not found
{{/if}}
{{#if hasSpecDocs}}
- Spec documents: **exist**
{{else}}
- Spec documents: not found
{{/if}}

## Intent Selection

Based on the directive and workspace state above, select the most appropriate `intentId`:

| intentId | When to select |
|----------|---------------|
| `gen-code-sys` | Generate code from system design documents (design docs exist and directive references them) |
| `gen-code-spec` | Generate code from spec documents (spec docs exist and directive references them) |
| `gen-code-directive` | Generate code from directive alone (no design/spec docs referenced) |
| `rev-code` | Modify, fix, or refactor existing code |
| `explain-code` | Explain or answer questions about code (no modification) |

## Output Format

Wrap your JSON response in <detect> tags (NO markdown code blocks):

<detect>
{
  "intentId": "gen-code-sys" | "gen-code-spec" | "gen-code-directive" | "rev-code" | "explain-code",
  "jobMode": "generate" | "refactor" | "explain",
  "jobModeReasoning": "Why this mode? (1 sentence)"
}
</detect>

**CRITICAL:**
- Use <detect> XML tags directly
- NO ```json or ``` markdown blocks
- Just raw XML tags with JSON inside

{{> code/phases/detect/rules}}
