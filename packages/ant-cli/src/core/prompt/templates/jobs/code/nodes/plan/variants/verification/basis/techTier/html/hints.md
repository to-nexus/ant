## Static HTML Verification Hints

**Context**: The project is plain static HTML/CSS/JS with no toolchain. There is NO install, type-check, build, or test gate — do not attempt to manufacture one.

### Required Gates (static)

| Gate | Observation Target |
|-----------|-------------------|
| **File existence** | Every deliverable file the tasks claim exists on disk under `codebase/`. |
| **Reference integrity** | Every internal `href` / `src` / `<link>` / `<script>` reference resolves to a real file via a relative path with exact filename case. |
| **Well-formedness** | Each HTML document has a doctype, balanced tags, and no truncated markup — observable by reading the file. |

**Constraint**: Do NOT run a package-manager, install, type-check, build, or test command. A static project has none of these, and creating a `package.json` (or any manifest) to enable one reclassifies the project as a Node project and breaks static serving.

**Constraint**: When a dependency manifest unexpectedly exists in a project whose deliverable is static HTML, treat it as a defect to report — not as a gate to execute.

⚠️ **Blind spot**: "No build ran" is the CORRECT observation for this project, not a gap. The gates above are complete — a verification that all three pass is a finished verification.
