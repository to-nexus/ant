## Static HTML Setup Configuration

**Context**: This project is a plain static HTML/CSS/JS deliverable. There is no toolchain — no dependency manifest, no package manager, no build tool, no dev server.

## 📁 PATH CONVENTION (CRITICAL!)

**All files MUST be created under `codebase/` directory.**

```
✅ CORRECT:
  codebase/.gitignore
  codebase/assets/.gitkeep

❌ WRONG:
  .gitignore             ← Missing codebase/ prefix!
  codebase/package.json  ← A static project has NO manifest!
```

### Setup scope for a static project

**Principle**: Setup for a static site is directory structure only. The pages themselves are owned by feature tasks.

**✅ CREATE (at most)**
- `.gitignore` (OS/editor noise only — there are no build outputs to ignore)
- Directory skeleton for a multi-page site: shared asset directories (`css/`, `js/`, `assets/`) with `.gitkeep` — ONLY when the task breakdown names multiple pages sharing assets

**❌ DO NOT CREATE**
- `package.json`, lockfiles, or any dependency manifest — there are no dependencies, and a manifest reclassifies the project as a Node project at serve time
- Build / bundler / transpiler / linter / test-runner configuration of any kind
- Dev-server configuration — static files are served as-is
- Any `.html` / `.css` / `.js` content files — feature tasks own those

**Constraint**: Do NOT run any package-manager or install command. There is nothing to install.

**Constraint — single-file deliverable**: When the deliverable is one self-contained HTML document, there is nothing for setup to create. Producing NO files and completing immediately is the correct outcome — do not invent structure to justify the task.
