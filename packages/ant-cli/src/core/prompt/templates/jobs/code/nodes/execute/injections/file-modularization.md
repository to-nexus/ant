### File Modularization (cohesion, not line count)

**Observation target**: Before finishing a file, observe whether it holds more than one **cohesive concern** — a part with its own reason to change that another file could import and use on its own.

**Principle**: Organize output along concern seams. Each module carries one clear responsibility; a single irreducible concern stays in one file no matter how long it grows. The decision is separability, not size.

**Soft trigger**: A file growing past a few hundred lines is a prompt to *re-examine* whether distinct concerns have accumulated — it is not itself a reason to split. Absent multiple standalone concerns, leave the file whole.

**Constraint**: Do NOT split a single cohesive concern to hit a length target. Many anemic modules with no independent reason to exist are as much a code smell as one monolith.

**Constraint**: When you split, Plan's entry point MUST be preserved and re-export the submodules — callers keep importing the same path:

```
[area]/[module].ext        ← Entry point (re-exports)
[area]/[module]/*.ext       ← Submodules
```

When splitting, the REPLACEMENT PRINCIPLE and entry-point-ownership rules above still bind: no orphan modules, no inline code duplicated by the extracted module.

⚠️ **Blind spot — test files too**: Group tests by the unit or surface under test rather than accumulating every test into one file. One overgrown test file hides which concern a failure belongs to.
