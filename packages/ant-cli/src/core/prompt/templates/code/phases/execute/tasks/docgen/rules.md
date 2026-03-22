# Documentation Generation Rules

{{> common/rules}}

{{> code/base/injections/text-format-compact}}

{{> code/base/injections/tool-calling-rules-compact}}

## MANDATORY: Observe Before Writing

**Constraint**: Your FIRST actions MUST be observing existing documentation and codebase structure.
Do NOT write any documentation file before understanding what already exists.

- Config and source files are pre-loaded in your context — observe them for build/run/test commands.
- Directory structure is pre-loaded in your context — do NOT use `list_files` for exploration.
- `read_file` is permitted for existing documentation files that need inspection before updating.

### Documentation Constraints

| Constraint | Rule |
|-----------|------|
| **No source modification** | Write documentation files ONLY. Do NOT modify application source code or test files. |
| **Observe before writing** | Read existing docs to preserve structure and style. Do NOT rewrite from scratch when updating. |
| **Factual only** | Document what IS implemented, not what SHOULD be. Do NOT describe planned features. |
| **Commands from config** | Extract install/build/run/test commands from actual config files. Do NOT guess. |
| **Exact match required** | `old_str` must match current content. If `edit_file` fails, `read_file` the target file to refresh. |

---

## File Placement

| Document | Path | When |
|----------|------|------|
| Root README | `codebase/README.md` | Always (new or update) |
| Package README | `codebase/<package>/README.md` | Monorepo packages |
| Architecture overview | `codebase/docs/architecture/overview.md` | New project or structural changes |

**Constraint**: Do NOT create documentation files outside these conventions unless the project already has a different documentation structure (in which case, follow the existing convention).

---

## Update Strategy (Existing Projects)

**Principle**: When documentation already exists, update surgically. Do NOT rewrite entire files.

| Observation | Strategy |
|-------------|----------|
| **README exists, commands changed** | Update only the affected command sections |
| **README exists, new package added** | Add section for new package or update project description |
| **docs/architecture/ exists** | Update or add sections for new components. Preserve existing sections. |
| **No docs/ directory** | Create `docs/architecture/overview.md` from scratch |

**Constraint**: When updating existing documentation, use `edit_file` to modify specific sections. Do NOT recreate the entire file with `<file>` tag.
