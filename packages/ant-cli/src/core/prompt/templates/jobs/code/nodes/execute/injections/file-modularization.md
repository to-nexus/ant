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

**Constraint — resolve the original after relocation**: Once content has moved out to submodules, the original file MUST NOT keep a second copy of it. Resolve the emptied original by its role: a file that consumers reach **by import path** becomes the thin entry point re-exporting the submodules; a file that **no one imports by path** — its identity is discovery by a runner or loader, not an import target — is deleted. A relocated file left in place is an orphan whose duplicated content diverges from the extracted copy.

⚠️ **Blind spot — test files too**: Group tests by the unit or surface under test rather than accumulating every test into one file. One overgrown test file hides which concern a failure belongs to. A test file is discovered by the runner, not imported — so after relocating its cases, the original is **deleted**, never turned into a re-export. Leaving it re-runs the now-relocated (and possibly stale) assertions from two places.
