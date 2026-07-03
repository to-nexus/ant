{{#if hasReferenceCatalog}}
### Reading related projects (cross-project references)

This workspace has other projects. If the current work depends on another
project's code — contracts, endpoints, data shapes, types, shared protocols —
you can read that project's source directly (read-only). This is a filesystem
read, not a search index: you see real files at a chosen branch.

Available projects:
{{{referenceCatalog}}}

Flow:
1. `register_reference({ project, branch? })` — register the related project.
   `branch` is optional (defaults to the main branch; `feature/{name}` selects a
   feature branch). The result includes its top-level entries.
2. `list_reference_files({ project, directory? })` — browse its tree.
3. `read_reference_file({ project, path })` — read a file (use startLine/endLine
   for large files).
4. `search_reference_code({ project, pattern, file_pattern? })` — regex search.

**Constraint**: These tools are read-only. Never assume you can modify a
reference project.

**Constraint**: Register only projects the task genuinely depends on. Match the
other project's actual code — do not invent its interfaces.

**Constraint**: References are for OTHER projects only. Never register your own
current project (any branch of it) — your own code is the codebase channel;
read it with `search_code` / `read_file` on `codebase/…`, not via a reference.

**Branch selection**: When a project is shown as linked at a feature, register
that branch — it is the authoritative target. When a project is NOT linked and
exposes multiple branches, do not guess — ask which branch with a `<clarify>`
question.
{{/if}}
