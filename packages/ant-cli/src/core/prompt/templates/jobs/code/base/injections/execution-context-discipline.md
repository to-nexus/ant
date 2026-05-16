{{!--
  Universal execution-context discipline (FPOP — Universal over Specific).

  SSOT for the cross-task contract that every authored module declares
  its runtime requirements and every integration owner verifies the
  graph it composes. Framework-specific declaration syntax (`'use client'`
  for Next.js, `+page.server.ts` for SvelteKit, file-suffix conventions
  for Vite, etc.) lives in techTier framework partials, NOT here.

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

- If a module references browser-only globals (`window`, `document`, `Audio`, `localStorage`, `IntersectionObserver`, `matchMedia`, `MediaSession`, …), it is **browser-runtime**.
- If a module references node-only globals (`process`, `Buffer`, `fs`, `path` with FS access, `child_process`, …), it is **node-runtime**.
- If a module touches platform-specific bindings (native FFI, WASM with browser globals, GPU adapters), it is **platform-restricted**.
- If a module performs work at module-evaluation time (top-level `await` of a runtime resource, singleton-on-import that constructs a runtime-only object), it inherits its evaluator's runtime — declare accordingly.

**The default is "portable"** — if a module is genuinely runtime-agnostic, no declaration is needed.

### 2. Integrator graph integrity (integration-band tasks)

When you wire modules into an entry point you own (root page, root layout, dependency-injection container, route registry, server bootstrap, worker bootstrap), you are responsible for the **execution-context graph from that entry**.

- Trace every transitively-imported module. If any of them carries an incompatible runtime requirement, isolate it behind a lazy boundary appropriate for the framework — dynamic import with runtime-only flag, worker-side instantiation, environment guard, code-split route segment.
- If a feature task's module lacks a declaration but its code clearly touches a runtime-specific API, treat it as a contract gap: either fix the declaration in that module (if you own composition), or work around it with the most conservative boundary (assume browser-only when in doubt).
- "Some other task will handle it" is **not** a valid assumption — your entry's graph is your responsibility end-to-end.

### 3. Contract-first composition (every task that imports another's module)

- Before importing a module from another task, look for its runtime declaration. If present, ensure your import site is compatible with that runtime.
- If absent and the module's code touches runtime-specific APIs at evaluation time, assume **the narrowest runtime** the code implies (e.g., browser-only if `new Audio()` is in the import chain).
- Never assume portability by default for infrastructure adapters, OS bindings, or hardware-touching code.

### Why this exists

Cross-task knowledge gaps (LLM agents don't know what an import chain looks like outside their task scope) make implicit runtime requirements the #1 cause of green-on-local-but-red-on-deploy build failures. Declaration + integrator verification closes the loop without requiring agents to share a global view.
