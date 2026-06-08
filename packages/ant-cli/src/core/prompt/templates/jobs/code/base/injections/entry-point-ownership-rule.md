{{!--
  Band-conditional ownership rule for entry points, shared runtime services,
  and cross-cutting wirings.

  SSOT for the ownership boundary across the four scheduling positions:
    - integration : owns HOST entries (the shared frame + central
                    registries/wiring that many units register into;
                    mounts what others made)
    - platform    : owns shared RUNTIME SERVICES/STATE (producer-closure)
    - foundation  : owns pure contracts (types/interfaces) only
    - consumer    : ordinary feature / ui / etc. — binds to the above, NEVER
                    hand-constructs a shared value to satisfy a type; owns the
                    PER-UNIT entry that mounts a unit it authors

  Two entry KINDS (range, not write-count — a host entry authored by one task
  is still a host entry):
    - per-unit entry : serves exactly ONE unit, no other task registers into
                       it. Owned by the task that AUTHORS that unit (a
                       consumer-band feature/ui task).
    - host entry     : the shared frame (framework root composition) OR a
                       central registry/wiring many units register into.
                       Owned by `integration`.

  FPOP: this body is a UNIVERSAL principle. How a framework physically
  expresses a per-unit entry (its own file vs a registration into a host
  registry), the concrete coordinates, and the file-per-route vs
  shared-registry topology all live in the framework tech-tier partial (the
  `_entry-points-*` partials) — NOT here. Do not name a framework, a file
  extension, or a routing mechanism in this file.

  Lives in `code/base/injections` so plan AND execute nodes reference the same
  source. Short form for self-check / output-constraint lists lives in the
  sibling `entry-point-ownership-checklist` partial — keep the two in sync.

  Branch axis: `taskBand` (SBS gate axis). Non-feature task types carry no band
  → consumer branch.
--}}
{{#if (eq taskBand "integration")}}
- **You are an `integration` band task.** You own **host entries** — the shared frame (the framework's root composition) and any central registry/wiring that many units register into. Identify the concrete files from your task description / `prePlanText` and the framework conventions pinned by your tech-tier partial, then own them in the `create`/`modify` lists below.
- **A per-unit entry — one that serves exactly ONE unit — is NOT yours.** Whether your framework expresses per-unit entries as their own files or as registrations into the host registry you own is pinned by your tech-tier partial; either way you do NOT author the units themselves (the feature band does) — you own only the shared frame and the central registry/wiring, and you mount the units that already exist.
- **MUST cross-reference the tech-tier partial.** When it pins a literal **host-entry** coordinate (a framework's canonical shared frame / registry), the plan's `create`/`modify` MUST list that exact path verbatim — a sibling coordinate is not a substitute. This applies to the host entry, NOT to per-unit entries.
- Mount/register the shared runtime services produced by `platform` band tasks at the entry points you own — but do NOT author those services here; they already exist. You wire what others produced.
- Verify the **execution-context graph integrity** of every entry you create: every transitively-imported module must be compatible with that entry's runtime, or be isolated behind a lazy boundary (see `execution-context-discipline`).
{{else if (eq taskBand "platform")}}
- **You are a `platform` band task.** You own a shared runtime service/state that many feature units depend on and that itself builds on the foundation contracts. Define BOTH its single **access contract** AND its **implementation** (the accessor plus the logic that derives/loads the shared value from its source) in the `create`/`modify` lists below.
- Later feature consumers will bind to the access contract you export — so it must exist and be importable by the time they run. If you only declare a type and leave the value unproduced, every consumer is forced to hand-construct it (a silent integration failure). Close the loop here: contract + producer together, before `<done>`.
- The defining test for "is this mine" is dependency POSITION — *consumed by many feature units, built on foundation* — not any framework mechanism. Do NOT also own host entries / registries / tree-mounting; the `integration` band mounts your service.
- If the **consumption mechanism** is a project choice consumers must repeat — *how* they obtain this service (e.g. injected via the context/provider you define vs imported as a singleton) — record that convention in `codebase/ANTRULES.md` (see the ANTRULES filter) so parallel app/package tasks bind the same way instead of each picking a different mechanism.
{{else if (eq taskBand "foundation")}}
- **You are a `foundation` band task.** You own pure contracts — types, interfaces, enums, pure functions. No runtime state.
- Shared runtime services/state (accessors that derive or load app-wide values, shared singletons, dependency registration) are NOT yours — they belong to a `platform` band task that builds on your contracts. Declare the contract; do not implement the runtime producer here.
- Do NOT modify host entries, registries, or wiring files — those belong to the `integration` band task.
{{else}}
- **If your code CONSUMES a shared runtime value/service/state** (an app-wide context, session/identity, config, a shared client) you MUST obtain it from its single platform-defined access contract. Do NOT satisfy the type by constructing the shared value locally with empty or placeholder fields at the consumption site — an empty stub that compiles is a silent integration failure (it renders nothing / denies access at runtime while the build stays green). If no access contract exists yet, that is missing `platform` work to surface — import the expected contract (a missing import fails loudly) rather than faking the value.
- **The per-unit entry that mounts a unit YOU author is YOURS.** Your tech-tier partial pins how this framework expresses that entry (its own file, or a registration into a host registry the `integration` band owns) and exactly what you must do for it. The invariant regardless of framework: every routable surface you author MUST reach a mounted entry by the time you emit `<done>` — do NOT leave it a placeholder, do NOT defer it with a `TODO` for a later task, and do NOT assume the `integration` band will create it for you (integration owns only the shared frame / central registry, not your unit). A later restyle/ui task refines an existing unit; it does not re-create an entry the authoring task already made.
- Do NOT modify the **host entry (shared frame or central registry)** that the `integration` band owns.
- Within YOUR task scope, ensure modules you create are properly imported and used by other files you own.
{{/if}}

- **Gate reachability (any band).** A surface you author that blocks entry because **no authenticated identity / session exists yet** (a "must sign in" wall, an unauthenticated guard, a redirect-to-login) is closed only when the path THROUGH that gate is reachable: the blocked state routes to a mounted entry surface that drives the production sign-in / identity flow, and that entry surface EXISTS in the running build. Ownership follows the same rules as any surface — a per-unit sign-in route is owned by its authoring task; a sign-in flow shared across units/apps is bound from the shared platform/foundation it lives in (and if that shared piece does not yet exist, surface it as the owning band's gap, exactly as with any other shared contract). Do NOT leave a terminal "must sign in" state with no mounted path onward, and do NOT defer the path with a `TODO`. A gate with no reachable path to obtain a session is a dead, unenterable surface — the same defect as an unmounted route, holding whether the external auth leg is real or virtualized.
- **Out of scope:** a deny shown to an ALREADY-authenticated identity that merely lacks a role / permission (e.g. an authenticated non-admin hitting an admin-only surface) is a legitimately terminal state — this rule does NOT require a path around it.
