{{!--
  Band-conditional ownership rule for shared entry points / cross-cutting wirings.

  SSOT for the entry-point ownership boundary between `integration` band
  tasks (which own these files) and feature/foundation tasks (which must
  self-censor). Rendered at call sites in prose form (TASK SCOPE PRINCIPLE
  in plan/rules.md and Task Boundary Principle in plan/base.md). The short
  form for self-check / output-constraint lists lives in the sibling
  `entry-point-ownership-checklist` partial.

  Branch axis: `taskBand` (SBS gate axis). Default branch (band undefined
  or non-integration) preserves the parallel-feature-conflict protection
  the parallel orchestrator depends on.
--}}
{{#if (eq taskBand "integration")}}
- **You are an `integration` band task.** Shared entry points (framework root entries such as `app/page.tsx` / `main.go` / `cmd/.../main.*`, route registries, dependency-wiring files, mandatory accompaniments of any library this slice activates) are YOUR responsibility. Identify them from your task description / `prePlanText` and own them in the `create`/`modify` lists below.
- Feature-band siblings will NOT touch these files — if YOU don't plan them, no one will. Do NOT self-censor entry-point work on the assumption that "another task handles it"; for cross-cutting responsibilities you ARE that other task.
- Within YOUR task scope, ensure modules other tasks produce are properly registered/imported at the integration points you own.
{{else}}
- Do NOT modify shared entry points, routers, or wiring files that another task is responsible for
- If your module needs to be registered in a shared integration point, the dedicated `integration` band task will handle it
- Within YOUR task scope, ensure modules you create are properly imported and used by other files you own
{{/if}}
