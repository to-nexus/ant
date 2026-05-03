## Diagram Contract (Cross-Job)

A diagram is the right form when the relationship is multi-axis (≥2 of: boundaries, directions, time-ordering) and prose bullets lose information by linearizing it. Otherwise prose is the default.

Preferred output order:

1. Mermaid diagram (default for ANT UI chat/card/file-preview surfaces)
2. ASCII/text fallback diagram (when Mermaid rendering is unavailable or uncertain)
3. No diagram (only when a diagram adds no explanatory value)

### Allowed diagram intents

- Flow-oriented process steps (flowchart)
- Component/service relationships (architecture map)
- Time-ordered interactions (sequence)

### Constraints

- Keep diagrams semantically aligned with the written bullets. Diagram and prose must describe the same boundaries and flow.
- Do NOT invent components, services, or flows that are not present in directive/PRD/source documents.
- If the destination is not ANT UI (or rendering capability is uncertain), provide a compact ASCII fallback immediately below the Mermaid block.
- Prefer one focused diagram over multiple overlapping diagrams.

### Blind spots to avoid

- Large decorative diagrams with weak linkage to actionable design decisions.
- Diagram-only output without concise bullet interpretation.
- Mixed notations that conflict (e.g., Mermaid flow says A->B while prose says A->C).
- Default to prose-only when uncertain — that default produces "diagram never appears" even where multi-axis is observable. Treat omission of a diagram as a decision that needs the same justification as inclusion.
