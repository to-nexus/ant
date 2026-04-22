Observe the project context, PRD, directive, refs, and contextArtifacts to determine a visual design policy.

Output a `<visualTier>` tag with ONE value per layer:
- `visualLanguage`: the overall visual tone matching the project's character
- `surfaceSystem`: container/panel visual treatment
- `spatialSystem`: spacing density and rhythm
- `screenContext`: a short keyword for the primary screen type (e.g. "dashboard", "settings", "catalog")

### Explicit vs Infer (per layer)

For each of `visualLanguage`, `surfaceSystem`, `spatialSystem`:

- If `resolvedAction.basis.visualTier.<layer>` is present, that value is EXPLICIT — emit it verbatim. Do not reinterpret or substitute.
- Otherwise, INFER by observing the work content (directive + refs + contextArtifacts + PRD + existing UI artifacts).

{{#if resolvedAction.basis.visualTier.visualLanguage}}
Explicit `visualLanguage`: {{resolvedAction.basis.visualTier.visualLanguage}}
{{/if}}
{{#if resolvedAction.basis.visualTier.surfaceSystem}}
Explicit `surfaceSystem`: {{resolvedAction.basis.visualTier.surfaceSystem}}
{{/if}}
{{#if resolvedAction.basis.visualTier.spatialSystem}}
Explicit `spatialSystem`: {{resolvedAction.basis.visualTier.spatialSystem}}
{{/if}}

### Available values (choose from these EXACT IDs)

`visualLanguage` (with supported theme modes):
{{availableVisualLanguagesWithModes}}

`surfaceSystem`: {{availableSurfaceSystems}}

`spatialSystem`: {{availableSpatialSystems}}

### Constraints

- Do NOT invent new variant IDs.
- Do NOT override explicit values.
- Do NOT map `spatialSystem` from `visualLanguage` alone. The primary observation target is the work content (directive + refs + contextArtifacts).
- Dual-theme requirement: if the project needs light + dark, choose a `visualLanguage` with supportedModes "both". A "dark"-only or "light"-only variant cannot support dual-theme.

<visualTier>
{
  "visualLanguage": "<chosen>",
  "surfaceSystem": "<chosen>",
  "spatialSystem": "<chosen>",
  "screenContext": "<keyword>"
}
</visualTier>
