## WORKSPACE STATE

{{#if workspaceState}}
✅ = the artifact exists (file names listed where known) · ❌ = not present in this workspace yet.

- Plan: {{#if workspaceState.hasPlan}}✅ {{workspaceState.planPath}}{{else}}❌{{/if}}
- Architecture/System: {{#if workspaceState.hasArchitectureSystem}}✅ {{json workspaceState.systemDesignFileNames}}{{else}}❌{{/if}}
- Architecture/Spec: {{#if workspaceState.hasArchitectureSpec}}✅ {{json workspaceState.specDocNames}}{{else}}❌{{/if}}
- Visual/UI: {{#if workspaceState.hasVisualUi}}✅{{else}}❌{{/if}}
- Visual/GameArt: {{#if workspaceState.hasVisualGameArt}}✅{{else}}❌{{/if}}
- Assets: {{#if workspaceState.hasAssets}}✅ ({{workspaceState.assetCount}} files){{else}}❌{{/if}}
- Codebase: {{#if workspaceState.hasCodebase}}✅{{else}}❌{{/if}}
{{else}}
(no workspace state available)
{{/if}}
