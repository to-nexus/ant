Observe the project context, PRD, and directive to determine the visual design policy that best fits its domain, audience, and tone.

Output a `<visualTier>` tag with ONE value per layer:
- `visualLanguage`: the overall visual tone matching the project's character
- `surfaceSystem`: container/panel visual treatment
- `spatialSystem`: spacing density and rhythm
- `screenContext`: a short keyword for the primary screen type (e.g. "dashboard", "settings", "catalog")

Constraint: Choose from the EXACT variant IDs listed below. Do NOT invent new values.

Available `visualLanguage` values: {{availableVisualLanguages}}
Available `surfaceSystem` values: {{availableSurfaceSystems}}
Available `spatialSystem` values: {{availableSpatialSystems}}

<visualTier>
{
  "visualLanguage": "<chosen>",
  "surfaceSystem": "<chosen>",
  "spatialSystem": "<chosen>",
  "screenContext": "<keyword>"
}
</visualTier>
