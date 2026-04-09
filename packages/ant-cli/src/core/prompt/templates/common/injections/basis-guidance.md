{{#if resolvedAction.basis}}
## Source Priority Guidance

{{#if (eq resolvedAction.basis "prd")}}
The PRD is the authoritative source. All design decisions must trace back to PRD requirements.
When conflicts exist between sources, the PRD takes precedence.
{{/if}}

{{#if (eq resolvedAction.basis "directive")}}
The user directive is the authoritative source. Follow the directive instructions precisely.
Design documents serve as supplementary context only.
{{/if}}

{{#if (eq resolvedAction.basis "existing-doc")}}
Existing design documents are the authoritative source. Preserve their structure and conventions.
New content must be consistent with the established patterns in these documents.
{{/if}}

{{#if (eq resolvedAction.basis "figma")}}
The Figma design file is the authoritative visual source.
All visual decisions (layout, spacing, colors, typography) must match the Figma source exactly.
{{/if}}

{{#if (eq resolvedAction.basis "references")}}
The reference images are the authoritative visual source.
Analyze and replicate the visual patterns observed in the reference materials.
{{/if}}

{{#if (eq resolvedAction.basis "spec")}}
The spec documents are the authoritative source. Implementation must satisfy all acceptance criteria and task definitions in the spec.
{{/if}}

{{#if (eq resolvedAction.basis "design-doc")}}
The design documents (system design, UI design) are the authoritative source.
Code generation must follow the architecture, API contracts, and component structure defined in these documents.
{{/if}}
{{/if}}
