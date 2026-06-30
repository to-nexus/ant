## Language Grounding — TypeScript (Node)

**Applies when**: the grounded codebase is a TypeScript backend / Node runtime.

When the spec/design is grounded on an existing TypeScript-Node codebase, reference the project's observed conventions rather than a generic backend model.

---

### Observe before specifying

**Principle**: Module system, runtime version, and build/run toolchain shape what a feature can assume — observe them, do not guess.

- Module system in use (ESM vs CJS) and the import/resolution convention the codebase already follows.
- Runtime capabilities the codebase relies on (native `fetch`, `node:` imports, top-level await) — the spec should not require a capability the project's runtime/config does not enable.
- The error / result convention (thrown errors, typed result objects, error categories) the codebase uses — a new contract must match it.

### What the spec owns vs defers

Name the contract (types, error shape) and where it lives. Do NOT prescribe TypeScript syntax or tsconfig flags — the code job owns *how*; the spec owns *what* and *where*.
