{{!--
  Universal execution-context discipline (FPOP — Universal over Specific).

  SSOT for the cross-task contract that every authored module declares
  its runtime requirements, every integration owner verifies the graph
  it composes, and every consumer binds to a shared symbol's *exact
  declared surface* rather than a guessed one. Framework-specific
  declaration syntax (`'use client'` for Next.js, `+page.server.ts` for
  SvelteKit, file-suffix conventions for Vite, etc.) lives in techTier
  framework partials, NOT here.

  Rendered unconditionally from every code-job execute/plan node so that:
    - feature/foundation tasks self-declare module runtime requirements
    - integration band tasks verify the transitive-import graph integrity

  Branch axis: none (universal). Companion partial `entry-point-ownership-rule`
  already band-branches on `taskBand`; that partial calls out graph
  integrity as part of the integration owner's responsibility — this
  partial provides the underlying principle the ownership rule references.
--}}

────────────────────────────────────────────────────────────────────────────────
## ⚙️ EXECUTION-CONTEXT DISCIPLINE
────────────────────────────────────────────────────────────────────────────────

**Principle**: Every module carries a runtime requirement that may not be visible in its TypeScript / Go / etc. signature — browser-only globals, OS-specific syscalls, GPU access, file-system access, edge-runtime constraints, worker-only APIs, build-time-only state. When parallel tasks compose modules, those implicit requirements MUST be surfaced or the composition silently breaks at the deployment boundary.

### 1. Authored declaration (every task that creates modules)

When you create a module whose code only works in a specific runtime, **declare that requirement on the module itself**. The exact syntax is framework-conventional — see the techTier framework partial(s) for the active stack. General rules:

- If a module references browser-only globals (DOM, BOM, Web APIs that exist only in a browser), it is **browser-runtime**.
- If a module references node-only globals (process control, filesystem, OS bindings), it is **node-runtime**.
- If a module touches platform-specific bindings (native FFI, WASM with platform-only globals, GPU adapters), it is **platform-restricted**.
- If a module performs work at module-evaluation time (top-level await of a runtime resource, singleton-on-import that constructs a runtime-only object), it inherits its evaluator's runtime — declare accordingly.

**The default is "portable"** — if a module is genuinely runtime-agnostic, no declaration is needed.

### 2. Integrator graph integrity (integration-band tasks)

When you wire modules into an entry point you own (root page, root layout, dependency-injection container, route registry, server bootstrap, worker bootstrap), you are responsible for the **execution-context graph from that entry**.

- Trace every transitively-imported module. If any of them carries an incompatible runtime requirement, isolate it behind a lazy boundary appropriate for the framework — dynamic import with runtime-only flag, worker-side instantiation, environment guard, code-split route segment.
- If a feature task's module lacks a declaration but its code clearly touches a runtime-specific API, treat it as a contract gap: either fix the declaration in that module (if you own composition), or work around it with the most conservative boundary (assume browser-only when in doubt).
- "Some other task will handle it" is **not** a valid assumption — your entry's graph is your responsibility end-to-end.
- **The styling graph closes at this entry too.** Beyond the runtime-import graph, every global class / root-container selector that your mounted shell·nav·component tree references MUST resolve to a definition in a stylesheet (or co-located styling module) imported from this entry. These hooks carry **no import edge**, so the transitive-import trace above does not surface them — close them separately: enumerate the global selectors the mounted tree consumes and confirm each resolves to a producer reachable from the entry. A global selector that is referenced but whose producer stylesheet is neither created nor imported is an open contract identical to a dangling import — it leaves the surface unstyled while the build stays green. "Some other task will wire the stylesheet" is **not** valid: bind to the existing global producer, or if none exists, **create the producer and import it at this entry**. When you own more than one entry (sibling apps), close the styling graph at **each** entry independently — do not wire one surface and leave its sibling unstyled.

### 3. Contract-first composition (every task that imports another's module)

- Before importing a module from another task, look for its runtime declaration. If present, ensure your import site is compatible with that runtime.
- If absent and the module's code touches runtime-specific APIs at evaluation time, assume **the narrowest runtime** the code implies based on the API surface touched at module evaluation.
- Never assume portability by default for infrastructure adapters, OS bindings, or hardware-touching code.

### 4. Surface fidelity (every task that uses another module's symbols)

A shared symbol's **surface** — its exact name, the members of an enum/union, the fields and shape of a type or request/response object, the required props of a component, an identifier vocabulary (e.g. key/name spelling and casing), the subpaths a package exposes for import — is owned by its defining module. The consumer's memory or convention is never authoritative for it.

- Before using any symbol defined by another task or a shared package, **read its authoritative definition first** — `search_code` to locate it, `read_file` to see the exact surface — and bind to exactly what is declared.
- Do **not** invent or guess any part of that surface: not an enum/literal value, not a field name, not an object shape, not a required prop, not an identifier's spelling/casing, not an import subpath. If you have not read it, you do not know it.
- A value that merely *looks* plausible from prior experience is not a substitute for the declared surface — recalling a shape from memory instead of reading it is the drift source.
- This extends to **stringly-typed vocabularies with no import edge**: a URL/route path another file's routing produces, the class/selector names and root-container class a stylesheet defines, an event/storage/message key another module emits, or a marker that takes effect only when a convention recognizes it — a convention-discovered name a registry binds, or a custom attribute or class a renderer reads to draw a glyph (a frontend icon being the canonical case). The compiler cannot link these, so a guessed value fails silently at runtime, not at build. Derive each from its authoritative producer (the route tree, the stylesheet, the emitter, the primitive component or runtime that interprets the marker) and bind to exactly that — a platform convention that reshapes the value (e.g. a path segment the framework excludes from the URL) is part of the surface you must read, not assume.
- **Emitting** such a no-import-edge hook carries the reciprocal obligation: authoring a global class / root-container selector / event·storage key is only valid when its producer exists and is reachable. If you own the entry, close it via the integrator's styling-graph duty (§2); if you are an ordinary consumer emitting a hook whose producer belongs to a shared frame, do **not** fabricate the producer at the call site — surface the missing producer as the owning band's gap, exactly as with an unproduced shared runtime value. The same obligation forbids standing in a fabricated parallel convention for a capability the project already exposes through a real primitive: when a shared component or runtime already provides the capability you need, route through its declared surface (read it per the consumer rule above) rather than emitting a marker no code interprets — an uninterpreted marker takes no effect (a visual one renders nothing) while the build stays green. If the project has no such primitive yet, create a real one; never leave an inert marker in its place.

### Why this exists

Cross-task knowledge gaps (an agent does not know what an import chain or a shared module's exact surface looks like outside its own task scope) cause two failure classes: implicit runtime requirements (the #1 cause of green-on-local-but-red-on-deploy build failures) and guessed contract surfaces (consumers inventing enum values, field names, props, or import paths that diverge from the authoritative definition). Declaration + integrator verification + read-before-bind closes the loop without requiring agents to share a global view.
