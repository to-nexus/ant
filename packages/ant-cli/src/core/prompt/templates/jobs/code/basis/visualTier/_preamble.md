## Applying Visual Policy to Code

When generating UI code, apply the visual design policies provided in the basis section.

**Spacing**: Use the spatial system to determine padding, gap, and margin values.
Do not use arbitrary values. Every spacing value should be traceable to the spatial system rhythm.

**Surface**: Apply the surface system consistently to all panels, cards, and containers.
Do not mix different surface treatments on the same screen unless the policy explicitly distinguishes them.

**Interaction**: Follow the interaction grammar for hover, focus, active, loading, empty, and error states.
Every interactive element must have consistent state treatment.

**Hierarchy**: Follow the visual hierarchy rules to determine what is emphasized and what is subordinate.
Do not allow multiple competing focal areas unless the policy permits it.

**When UI artifacts (ui-tokens.json, ui-spec.json) also exist**:
UI artifacts are the primary source of truth for specific values.
Visual policy serves as background guidance for areas the artifacts do not cover.
