## Static HTML Setup Task Constraints

⛔ **CRITICAL: Directory structure ONLY — no manifest, no toolchain, no content** ⛔

**Context**: The project is plain static HTML/CSS/JS served as written. Setup owns at most the directory skeleton; it owns no toolchain because none exists.

## 📁 PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory** (e.g. `codebase/.gitignore`, `codebase/assets/.gitkeep`).

### File Categories

**✅ CREATE (at most)**
- Project: `.gitignore` (OS/editor noise only)
- **Directory skeleton** — for a multi-page site, shared asset directories (`css/`, `js/`, `assets/`) preserved with `.gitkeep`

**❌ DON'T CREATE**
- `package.json`, lockfiles, or any dependency manifest — a static project has no dependencies, and a manifest breaks static serving
- Any build / bundler / transpiler / styling-tool / linter / test-runner configuration
- `.env` files or infrastructure configuration — there is no server-side runtime
- Content files (`.html` / `.css` / `.js`) — feature tasks own all content

**Constraint**: Do NOT plan any install or package-manager command — there is nothing to install.

**Constraint**: For a single self-contained HTML deliverable, the correct setup plan creates NOTHING — plan an empty file list rather than inventing structure.
