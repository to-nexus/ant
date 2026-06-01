{{!--
  Band-conditional ownership rule for shared entry points, shared runtime
  services, and cross-cutting wirings.

  SSOT for the ownership boundary across the four scheduling positions:
    - integration : owns shared entry points / wiring (mounts what others made)
    - platform    : owns shared RUNTIME SERVICES/STATE (producer-closure)
    - foundation  : owns pure contracts (types/interfaces) only
    - consumer    : ordinary feature / ui / etc. — binds to the above, NEVER
                    hand-constructs a shared value to satisfy a type
  Lives in `code/base/injections` so plan AND execute nodes reference the same
  source — duplicating the contract across nodes is the MECE violation this
  partial exists to prevent. The short form for self-check / output-constraint
  lists lives in the sibling `entry-point-ownership-checklist` partial — keep
  the two in sync.

  Branch axis: `taskBand` (SBS gate axis). Non-feature task types carry no
  band → they fall into the consumer branch (correct: ui/setup/error tasks
  are consumers of shared services and must obey the no-stub constraint).

  Body deliberately framed as a universal principle (FPOP) — concrete
  framework-specific entry filenames (e.g. `app/page.tsx`, `main.go`) and
  mechanism names (provider / store / pool) belong in
  `basis/techTier/framework/<name>.md` partials, not here.
--}}
{{#if (eq taskBand "integration")}}
- **You are an `integration` band task.** Shared entry points (framework root entries, route registries, dependency-wiring files, mandatory accompaniments of any library this slice activates) are YOUR responsibility. Identify the concrete files from your task description / `prePlanText` and the framework conventions pinned by the tech-tier layer, then own them in the `create`/`modify` lists below.
- **MUST cross-reference the tech-tier partial.** When the partial pins a literal entry-point filename (e.g. a framework's canonical root coordinate), the plan's `create`/`modify` MUST list that exact path verbatim — picking a sibling coordinate that "also routes the same URL" or "is semantically equivalent" leaves the framework's literal root coordinate empty. If you deliberately substitute a sibling coordinate for the literal one, `parentReasoning` must name why the substitute fully covers the literal root's responsibility.
- Mount/register the shared runtime services produced by `platform` band tasks at the entry points you own — but do NOT author those services here; they already exist. You wire what others produced.
- Feature-band siblings will NOT touch these files — if YOU don't plan them, no one will. Do NOT self-censor entry-point work on the assumption that "another task handles it"; for cross-cutting responsibilities you ARE that other task.
- Within YOUR task scope, ensure modules other tasks produce are properly registered/imported at the integration points you own. Verify the **execution-context graph integrity** of every entry you create: every transitively-imported module must be compatible with that entry's runtime, or be isolated behind a lazy boundary (see `execution-context-discipline`).
{{else if (eq taskBand "platform")}}
- **You are a `platform` band task.** You own a shared runtime service/state that many feature units depend on and that itself builds on the foundation contracts. Define BOTH its single **access contract** AND its **implementation** (the accessor plus the logic that derives/loads the shared value from its source) in the `create`/`modify` lists below.
- Later feature consumers will bind to the access contract you export — so it must exist and be importable by the time they run. If you only declare a type and leave the value unproduced, every consumer is forced to hand-construct it (a silent integration failure). Close the loop here: contract + producer together, before `<done>`.
- The defining test for "is this mine" is dependency POSITION — *consumed by many feature units, built on foundation* — not any framework mechanism. Do NOT also own framework entry points / routers / tree-mounting; the `integration` band mounts your service.
{{else if (eq taskBand "foundation")}}
- **You are a `foundation` band task.** You own pure contracts — types, interfaces, enums, pure functions. No runtime state.
- Shared runtime services/state (accessors that derive or load app-wide values, shared singletons, dependency registration) are NOT yours — they belong to a `platform` band task that builds on your contracts. Declare the contract; do not implement the runtime producer here.
- Do NOT modify shared entry points, routers, or wiring files — those belong to the `integration` band task.
{{else}}
- **If your code CONSUMES a shared runtime value/service/state** (an app-wide context, session/identity, config, a shared client) you MUST obtain it from its single platform-defined access contract. Do NOT satisfy the type by constructing the shared value locally with empty or placeholder fields at the consumption site — an empty stub that compiles is a silent integration failure (it renders nothing / denies access at runtime while the build stays green). If no access contract exists yet, that is missing `platform` work to surface — import the expected contract (a missing import fails loudly) rather than faking the value.
- Do NOT modify shared entry points, routers, or wiring files that another task is responsible for. If your module needs to be registered in a shared integration point, the dedicated `integration` band task will handle it.
- Within YOUR task scope, ensure modules you create are properly imported and used by other files you own.
{{/if}}
