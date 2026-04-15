## Applying Visual Policy to UI Artifacts

When generating ui-tokens.json, ui-assets.json, and ui-spec.json,
apply the visual design policies provided in the basis section.

**ui-tokens.json**: Token values (colors, spacing, typography, radii, shadows)
must reflect the visual language and spatial system policies.
Spacing tokens must follow the spatial system rhythm precisely.

**ui-assets.json**: Asset treatment and organization must be consistent
with the surface system and visual language.

**ui-spec.json**: Layout structure, component arrangement, and visual hierarchy
must follow the spatial system, component semantics, and visual hierarchy rules.

**Cross-artifact consistency**: All three artifacts describe the same product.
Tokens define the values; spec references those tokens; assets complement both.
Do not introduce values in spec that contradict tokens.
