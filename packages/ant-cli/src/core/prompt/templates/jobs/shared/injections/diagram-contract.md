## Diagram Contract (Cross-Job)

A diagram is the right form when the relationship is multi-axis (≥2 of: boundaries, directions, time-ordering) and prose bullets lose information by linearizing it. Otherwise prose is the default.

### Form selection by relationship shape

Form follows the shape of the relationship being described, not the output destination. A saved markdown artifact is consumed by renderers that support standard diagram blocks; rendering environment is NOT an observation target here.

| Relationship shape | Form |
|--------------------|------|
| Multi-path / branching / conditional flow; time-ordered interactions between actors; component or service topology; state transitions | Mermaid block |
| Strictly hierarchical containment (file tree, directory layout, inheritance rendered as a tree) | ASCII tree block |
| Single linear sequence (≤3 steps, one direction, no branches) | Prose-only |

### Allowed diagram intents

- Flow-oriented process steps (flowchart)
- Component/service relationships (architecture map)
- Time-ordered interactions (sequence)

### Constraints

- Keep diagrams semantically aligned with the written bullets. Diagram and prose must describe the same boundaries and flow.
- Do NOT invent components, services, or flows that are not present in directive/PRD/source documents.
- Prefer one focused diagram over multiple overlapping diagrams.
- Do NOT pick form by speculating about the consumer. Pick by relationship shape only.

### Mermaid Syntax Safety

- Use a conservative Mermaid subset that is stable across renderers.
- Use alphanumeric/underscore node IDs only (e.g., `AuthCheck`, `auth_check_1`); do not use spaces in IDs.
- When labels contain special characters (`()[]{}?:/,+-`), wrap the label text in double quotes.
- For edge labels with special characters, wrap the edge label in double quotes.
- Avoid slash-delimited node-shape shorthand (for example `[/text]`, `[\\text\\]`); use standard nodes with quoted labels instead.
- Keep one edge statement per line so parser recovery does not merge adjacent statements.
- If a relationship cannot be represented safely under these constraints, use prose or ASCII tree (when strictly hierarchical) instead of forcing Mermaid syntax.

### Blind spots to avoid

- Large decorative diagrams with weak linkage to actionable design decisions.
- Diagram-only output without concise bullet interpretation.
- Mixed notations that conflict (e.g., flow block says A->B while prose says A->C).
- Default to prose-only when uncertain — that default produces "diagram never appears" even where multi-axis is observable. Treat omission of a diagram as a decision that needs the same justification as inclusion.
- Default to ASCII tree when the relationship is NOT strictly hierarchical — ASCII tree collapses branching / time-ordering into 1D containment and silently loses information. Pick block form from the relationship shape, not from "safer to type".
