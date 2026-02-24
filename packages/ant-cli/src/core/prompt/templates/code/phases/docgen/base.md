# Documentation Generation

You are generating or updating project documentation based on the completed codebase.

## Scope

**Write documentation files ONLY.** Do NOT modify application source code or test files.

## Pre-loaded Context

Configuration files, source code, test files, and the directory tree are already in your context. Use them directly — do NOT re-read or re-list what is already provided.

| Context | Use for |
|---------|---------|
| **Config files** | Install, build, run, test commands |
| **Source files** | Architecture understanding, component relationships |
| **Test files** | Test run commands, test framework |
| **Directory tree** | Project structure, package boundaries |

## Observation Targets

Observe the actual codebase to determine what documentation is needed:

| Checkpoint | What to observe |
|-----------|----------------|
| **Existing README** | Does `README.md` already exist? If yes, observe its structure and update — do NOT rewrite from scratch. |
| **Existing docs/** | Does `docs/` directory exist? If yes, observe existing documents and update relevant sections. |
| **Package structure** | Is this a monorepo with multiple packages? Each independently runnable package needs its own README. |
| **Build system** | What commands are used for install, build, dev, test? Observe config files directly. |
| **Architecture** | What are the main components, their responsibilities, and how do they communicate? |

## Scope Determination

**Observation target**: What is the documentation boundary assigned to this task?

| Checkpoint | What to observe |
|-----------|----------------|
| **Task description scope** | Does the description specify a single package, or the entire project? |
| **Project structure** | Is this a single-package project or multi-package? |

**Principle**: Each doc task operates within its stated scope. A root-level task writes project-wide documentation (root README, architecture docs). A package-level task writes only that package's README.

**Constraint**: Do NOT write documentation outside the scope stated in the task description. If this is a package-level task, do NOT modify root-level docs or other packages' docs.

**Constraint**: If existing documentation exists within the task's scope, observe its structure and update incrementally — do NOT rewrite from scratch.

## Content Placement

**Principle**: Every documentation content belongs to exactly ONE of two mutually exclusive domains. Observe the content's nature to determine its destination.

| Domain | Destination | Content scope |
|--------|-------------|---------------|
| **Operational** | `README.md` | Install, run, build, test, prerequisites, environment setup |
| **Design** | `docs/architecture/overview.md` | System structure, component relationships, data flow, design decisions |

**Constraint**: These domains are mutually exclusive. Do NOT place design content in README. Do NOT place operational commands in architecture docs.

**Constraint**: README links to `docs/architecture/` for design context. This is the ONLY cross-reference between domains.

⚠️ **Blind spot**: Task description may reference architecture or design content without specifying destination. The placement rule above ALWAYS determines destination, regardless of task description wording.

### README (Operational Domain)

**Principle**: README is dry and operational — how to install, run, build, test. It is NOT a design document.

Each README MUST contain (when applicable):
- One-line project description
- Prerequisites (runtime versions, required tools)
- Install command
- Run / dev command
- Build command
- Test command
- Link to `docs/architecture/` for system design

**Constraint**: Do NOT fabricate commands. Observe actual build/dependency config files to determine correct commands.

### Architecture Documentation (Design Domain)

**Principle**: `docs/architecture/overview.md` describes the system's structure for developers who need to understand the codebase.

Content (when applicable):
- System overview (what the project does, at a high level)
- Component diagram (which modules/packages exist, what each does)
- Data flow (how requests/data move through the system)
- Key design decisions (why certain patterns were chosen)
- Directory structure explanation

**Constraint**: Describe the actual implemented architecture. Do NOT describe aspirational or planned features that are not in the code.

**Constraint**: Use Mermaid diagrams when they clarify component relationships or data flow.

## Completion

After writing all documentation files, output `<done>true</done>`.

## PATH CONVENTION

All paths are relative to the feature root.
- Code files: `codebase/...` (e.g., `codebase/README.md`, `codebase/docs/architecture/overview.md`)
- Wrong paths: `README.md` (missing prefix), `features/<feature>/codebase/...` (codebase is at feature root, NOT inside features/).

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see docgen/rules.md**
