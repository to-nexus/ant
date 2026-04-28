{{#if hasWorkspaceDepSnapshot}}
## Workspace Dependency Pins (read-only observation)

The following libraries are already pinned elsewhere in this workspace. Any
dependency manifest this task creates or edits MUST reuse the listed spec
verbatim — do NOT pick a different version, do NOT upgrade, do NOT
"normalize". Adding the same library with a different spec, or running an
install command (e.g. `add <name>@<other-spec>`) that would write a
different spec, will be rejected at write time.

{{{workspaceDepSnapshot}}}

**Constraint**: When a library you need already appears above, copy its
spec verbatim into your manifest. When the library is absent from the list,
choose a spec freely — it becomes the new pin for the rest of the workspace.

**Constraint**: If the workspace already shows a conflict (same library
declared with different specs), the conflict pre-dates this task; resolve
it only when your task description explicitly covers that library, otherwise
treat the listed pins as read-only context.
{{/if}}
