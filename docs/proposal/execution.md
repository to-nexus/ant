# ANT Monorepo – Dev/Prod Execution Model Unification Plan

## Objective

Unify development and production execution semantics by:

- Removing tsx entirely
- Enforcing strict ESM-only runtime
- Ensuring dev and prod use identical module behavior
- Using watch + restart instead of permissive TS runtime execution

---

## Core Principles

1. Dev must follow production module semantics.
2. No direct TypeScript runtime execution in any production path.
3. No require() in runtime graph.
4. Built-ins must use node: prefix (e.g., node:path).
5. Conditional loading must use await import().
6. Dev and prod entrypoints must be identical.

---

## Development Runtime Strategy

Development must use:

esbuild (watch mode) + Node execution + auto-restart

No tsx.
No ts-node runtime execution.

---

## Implementation Steps

### Step 1 – Create Dev Bundle Target (for @ant/cli)

Example:

esbuild src/composition/job-runner.ts \
  --bundle \
  --format=esm \
  --platform=node \
  --outfile=dist/dev/job-runner.mjs \
  --sourcemap \
  --watch

Repeat for:
- server
- realtime-server
- preview-worker
- any runtime entry

All runtime entrypoints must be bundled in dev.

---

### Step 2 – Execute Bundle with Node

node dist/dev/job-runner.mjs

---

### Step 3 – Enable Auto-Restart

Use Node 20+ built-in watch:

node --watch dist/dev/job-runner.mjs

File change → esbuild rebuild → Node restarts automatically.

---

## Remove tsx Completely

Search and remove:

grep -R "tsx" .

Delete:
- tsx dependencies
- tsx-based dev scripts
- any TS runtime execution in package.json

All runtime execution must use JavaScript output only.

---

## Enforce ESM-Only Policy

Required:

- "type": "module" in runtime packages
- No require
- No module.exports
- Built-ins use node: prefix
- Conditional imports use await import()

Optional (recommended):

Add ESLint rule to forbid require.

---

## Directory Convention

dist/
  dev/
    job-runner.mjs
    server.mjs
  prod/
    job-runner.mjs

Dev and prod bundles must be structurally equivalent.
Only difference: watch/minify flags.

---

## UI Layer

Do not modify:

@ant/ui dev

Frontend retains HMR.
Backend/worker uses watch-restart model.

---

## Verification Checklist

- No tsx anywhere
- No require in runtime graph
- Dev entry == prod entry
- ESM bundle output
- Cloud runtime matches dev behavior

---

## Guiding Principle

Development runtime must never be more permissive than production runtime.
If dev is looser than prod, bugs will hide.
