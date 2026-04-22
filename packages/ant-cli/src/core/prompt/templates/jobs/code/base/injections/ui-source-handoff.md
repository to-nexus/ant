## UI SOURCE — HANDOFF

### Principle (Observation, not schema)

Handoff is a free-form bundle under `outputs/design/ui/handoff/`. There is **no agreed schema** across handoff authors — any combination of HTML, CSS, Markdown, JSON, and raster/vector assets may appear. Read every injected file as raw evidence of intent and extract only what the content explicitly shows.

### Constraint (No cross-file consistency assumption)

- Do NOT assume two handoff files follow the same conventions (naming, structure, units).
- Do NOT conflate partial definitions across files unless the content itself states the relation.
- Do NOT treat filename or extension patterns as semantic contracts; interpret the contents.

### Observable

Every token, colour, spacing, and component behaviour used in the output MUST be traceable to a specific handoff file. When a property is not observable, fall back to VisualTier defaults or framework conventions rather than inventing values.

### Blind spot reminder

Handoff content is often redundant across files (e.g. the same colour appears in HTML, CSS, and an accompanying spec). Pick the most explicit representation per property and ignore the rest; do not merge conflicting definitions silently.
