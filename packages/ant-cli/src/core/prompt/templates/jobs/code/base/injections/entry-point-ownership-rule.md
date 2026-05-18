{{!--
  Band-conditional ownership rule for shared entry points / cross-cutting wirings.

  SSOT for the entry-point ownership boundary between `integration` band
  tasks (which own these files) and feature/foundation tasks (which must
  self-censor). Lives in `code/base/injections` so plan AND execute nodes
  reference the same source — duplicating the contract across nodes is the
  MECE violation this partial exists to prevent. The short form for
  self-check / output-constraint lists lives in the sibling
  `entry-point-ownership-checklist` partial.

  Branch axis: `taskBand` (SBS gate axis). Default branch (band undefined
  or non-integration) preserves the parallel-feature-conflict protection
  the parallel orchestrator depends on.

  Body deliberately framed as a universal principle (FPOP) — concrete
  framework-specific entry filenames (e.g. `app/page.tsx`, `main.go`)
  belong in `basis/techTier/framework/<name>.md` partials, not here.
--}}
{{#if (eq taskBand "integration")}}
- **You are an `integration` band task.** Shared entry points (framework root entries, route registries, dependency-wiring files, mandatory accompaniments of any library this slice activates) are YOUR responsibility. Identify the concrete files from your task description / `prePlanText` and the framework conventions pinned by the tech-tier layer, then own them in the `create`/`modify` lists below.
- **MUST cross-reference the tech-tier partial.** When the partial pins a literal entry-point filename (e.g. a framework's canonical root coordinate), the plan's `create`/`modify` MUST list that exact path verbatim — picking a sibling coordinate that "also routes the same URL" or "is semantically equivalent" leaves the framework's literal root coordinate empty. If you deliberately substitute a sibling coordinate for the literal one, `parentReasoning` must name why the substitute fully covers the literal root's responsibility.
- Feature-band siblings will NOT touch these files — if YOU don't plan them, no one will. Do NOT self-censor entry-point work on the assumption that "another task handles it"; for cross-cutting responsibilities you ARE that other task.
- Within YOUR task scope, ensure modules other tasks produce are properly registered/imported at the integration points you own. Verify the **execution-context graph integrity** of every entry you create: every transitively-imported module must be compatible with that entry's runtime, or be isolated behind a lazy boundary (see `execution-context-discipline`).
{{else}}
- Do NOT modify shared entry points, routers, or wiring files that another task is responsible for
- If your module needs to be registered in a shared integration point, the dedicated `integration` band task will handle it
- Within YOUR task scope, ensure modules you create are properly imported and used by other files you own
{{/if}}
