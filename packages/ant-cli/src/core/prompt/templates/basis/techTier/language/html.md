# Language Profile: Static HTML

**Context**: This project's deliverable is plain HTML/CSS/JS files, served exactly as written. The browser is the runtime — there is no compile, transpile, bundle, or build step of any kind.

---

## Core Identity

**Principle**: Every file you write IS the artifact that ships. Nothing transforms it, nothing installs it, nothing serves it through a framework. Publishing a static file means copying it.

**Constraint — no toolchain artifacts**:
- No dependency manifest (`package.json`, lockfiles) — there are no dependencies to declare.
- No package manager (`npm` / `pnpm` / `yarn` / `bun`) — there is nothing to install.
- No build or bundler configuration, no transpiler configuration, no dev-server requirement.
- No test runner or linter toolchain.

**Constraint — asset references**:
- All `href` / `src` / `link` / `script` references between project files use **relative paths** within the project tree.
- Reference filenames with **exact case** — static hosts are case-sensitive even when a local filesystem is not.
- Do NOT use root-absolute (`/assets/...`) or filesystem-absolute paths — they break file-open viewing and subpath-mounted serving.

## Structure

**Principle**: A single-document deliverable inlines its CSS and JS in the one HTML file unless the directive explicitly asks for separate files. A multi-page site stays a flat, human-navigable tree (pages at the root, shared assets in sibling directories such as `css/`, `js/`, `assets/`).

**Constraint**: External runtime dependencies (fonts, libraries) are either inlined or referenced from the network at view time — never installed into the project.

⚠️ **Blind Spot**: "This needs to be published/shared" is NOT a reason to add build or publish scripts. A static file is published by serving or copying it as-is; adding a manifest converts the project into a toolchain project and breaks static serving.
