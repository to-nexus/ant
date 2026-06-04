{{!--
  Band-conditional ownership rule for entry points, shared runtime services,
  and cross-cutting wirings.

  SSOT for the ownership boundary across the four scheduling positions:
    - integration : owns APP-SHELL + REGISTRY entries (the shared frame +
                    central registries that many screens register into;
                    mounts what others made)
    - platform    : owns shared RUNTIME SERVICES/STATE (producer-closure)
    - foundation  : owns pure contracts (types/interfaces) only
    - consumer    : ordinary feature / ui / etc. — binds to the above, NEVER
                    hand-constructs a shared value to satisfy a type; owns the
                    PER-SCREEN route entry that mounts a screen it authors

  Two entry KINDS (range, not write-count — a root layout authored by one task
  is still app-shell):
    - per-screen entry  : mounts exactly ONE screen, no other task registers
                          into it (file-per-route page). Owned by the task that
                          AUTHORS that screen (a consumer-band feature/ui task).
    - app-shell/registry: the shared frame (root layout, provider/host tree,
                          global nav) or a central registry many screens join
                          (single route table, DI container). Owned by
                          `integration`.

  Topology axis: `entryPointTopology` (`file-per-route` | `shared-registry` |
  undefined). file-per-route frameworks (e.g. Next.js) have no central route
  registry, so per-screen pages are the author's; shared-registry frameworks
  keep route registration in the integration-owned registry. undefined (BE-only
  / frameworkless) keeps the pre-existing behavior.

  Lives in `code/base/injections` so plan AND execute nodes reference the same
  source. Short form for self-check / output-constraint lists lives in the
  sibling `entry-point-ownership-checklist` partial — keep the two in sync.

  Branch axis: `taskBand` (SBS gate axis). Non-feature task types carry no band
  → consumer branch. Body framed as a universal principle (FPOP) — concrete
  framework-specific filenames (e.g. `app/layout.tsx`) live in the framework
  partial, not here.
--}}
{{#if (eq taskBand "integration")}}
- **You are an `integration` band task.** You own **app-shell and registry entries** — the shared frame (framework root layout, provider/host tree, global navigation) and any central registry many screens register into (a single route table, a dependency-wiring container). Identify the concrete files from your task description / `prePlanText` and the framework conventions pinned by the tech-tier layer, then own them in the `create`/`modify` lists below.
- **A per-screen route entry — one that mounts exactly ONE screen — is NOT yours.** {{#if (eq entryPointTopology "file-per-route")}}This framework is file-per-route (see your tech-tier partial): each screen's own route file belongs to the task that authors that screen. Own the shared frame only (root layout / provider tree / global nav); do NOT create per-screen route files — including the root `/` screen's own page, which its author owns.{{else}}Screens register into the central registry you own; do not author the screen components themselves (the feature band does) — only wire the ones that already exist.{{/if}}
- **MUST cross-reference the tech-tier partial.** When it pins a literal **app-shell** coordinate (a framework's canonical shared frame), the plan's `create`/`modify` MUST list that exact path verbatim — a sibling coordinate is not a substitute. This applies to the shared frame/registry, NOT to per-screen pages.
- Mount/register the shared runtime services produced by `platform` band tasks at the entry points you own — but do NOT author those services here; they already exist. You wire what others produced.
- Verify the **execution-context graph integrity** of every entry you create: every transitively-imported module must be compatible with that entry's runtime, or be isolated behind a lazy boundary (see `execution-context-discipline`).
{{else if (eq taskBand "platform")}}
- **You are a `platform` band task.** You own a shared runtime service/state that many feature units depend on and that itself builds on the foundation contracts. Define BOTH its single **access contract** AND its **implementation** (the accessor plus the logic that derives/loads the shared value from its source) in the `create`/`modify` lists below.
- Later feature consumers will bind to the access contract you export — so it must exist and be importable by the time they run. If you only declare a type and leave the value unproduced, every consumer is forced to hand-construct it (a silent integration failure). Close the loop here: contract + producer together, before `<done>`.
- The defining test for "is this mine" is dependency POSITION — *consumed by many feature units, built on foundation* — not any framework mechanism. Do NOT also own framework app-shell entries / routers / tree-mounting; the `integration` band mounts your service.
- If the **consumption mechanism** is a project choice consumers must repeat — *how* they obtain this service (e.g. injected via the context/provider you define vs imported as a singleton) — record that convention in `codebase/ANTRULES.md` (see the ANTRULES filter) so parallel app/package tasks bind the same way instead of each picking a different mechanism.
{{else if (eq taskBand "foundation")}}
- **You are a `foundation` band task.** You own pure contracts — types, interfaces, enums, pure functions. No runtime state.
- Shared runtime services/state (accessors that derive or load app-wide values, shared singletons, dependency registration) are NOT yours — they belong to a `platform` band task that builds on your contracts. Declare the contract; do not implement the runtime producer here.
- Do NOT modify app-shell entries, routers, registries, or wiring files — those belong to the `integration` band task.
{{else}}
- **If your code CONSUMES a shared runtime value/service/state** (an app-wide context, session/identity, config, a shared client) you MUST obtain it from its single platform-defined access contract. Do NOT satisfy the type by constructing the shared value locally with empty or placeholder fields at the consumption site — an empty stub that compiles is a silent integration failure (it renders nothing / denies access at runtime while the build stays green). If no access contract exists yet, that is missing `platform` work to surface — import the expected contract (a missing import fails loudly) rather than faking the value.
- **The per-screen route entry that mounts a screen YOU author is YOURS.** {{#if (eq entryPointTopology "file-per-route")}}This framework is file-per-route: that route file is non-shared (no other task registers into it), so the task that *creates* the screen also creates AND wires its route file — in the same task. Do NOT leave it a placeholder for a later task, and do NOT assume the `integration` band will mount your screen (it owns only the shared frame). A later restyle task does not re-create a route the authoring task already made.{{else if (eq entryPointTopology "shared-registry")}}This framework uses a central registry owned by the `integration` band, so you do NOT author that registry. Your screen is registered there — make sure the screen component exists (authored in the feature band) so the registry can mount it; ui/restyle tasks refine an existing screen, they do not introduce a new route.{{else}}If your module needs to be registered in a shared registry, the dedicated `integration` band task will handle it.{{/if}}
- Do NOT modify the **app-shell frame or a central registry** that the `integration` band owns.
- Within YOUR task scope, ensure modules you create are properly imported and used by other files you own.
{{/if}}
