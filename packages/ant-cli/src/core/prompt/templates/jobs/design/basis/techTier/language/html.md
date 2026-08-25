## Language Grounding — Static HTML

**Applies when**: the implementation target is a plain static HTML/CSS/JS document or site — no framework, no build toolchain, no server runtime.

---

### Observe before specifying

**Principle**: The deliverable is files served exactly as written. Nothing is compiled, bundled, installed, or rendered server-side — the spec must not assume any of those capabilities.

- Asset references are relative paths within the project tree; the design must not depend on a bundler resolving imports.
- A single-document deliverable inlines styles and scripts; a multi-page site keeps a flat, human-navigable tree.

### What the spec owns vs defers

Name the document structure, the visual hierarchy, and the content each page carries. Sections about state management, client data layers, API integration, build tooling, or environment configuration are **Not Applicable** unless the directive explicitly names external data — write "N/A" rather than inventing them.

**Constraint**: Do NOT specify a dependency manifest, package installation, or build scripts — publishing a static file means copying it.
