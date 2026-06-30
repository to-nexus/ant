## Language Grounding — TypeScript (Browser)

**Applies when**: the grounded codebase is a TypeScript frontend / browser runtime.

When the spec/design is grounded on an existing TypeScript-browser codebase, reference the project's observed conventions rather than a generic SPA model.

---

### Observe before specifying

**Principle**: The build tooling and the browser runtime bound what a feature can assume — observe them, do not guess.

- The bundler / build tool and how modules + assets are resolved (affects where a new module or asset must live to be reachable).
- The typed contract convention (shared types, API response shapes) the codebase uses between UI and server — a new contract must match it.
- Browser-runtime constraints relevant to the feature (storage, async boundaries, environment-variable exposure at build time).

### What the spec owns vs defers

Name the data contract, the module/boundary placement, and the state the feature owns. Do NOT prescribe TypeScript syntax or bundler config — the code job owns *how*; the spec owns *what* and *where*.
