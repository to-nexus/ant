{{#if hasReferenceCatalog}}
### Related projects (cross-project references)

Other projects exist in this workspace. When the work must align with another
project's code — shared contracts, API shapes, data models, types, protocols —
you may register that project as a read-only reference and inspect its source.

Available projects:
{{{referenceCatalog}}}

**Constraint**: Register a project ONLY when the task genuinely depends on its
code. Do NOT register unrelated projects.

**Constraint**: Registration is a pointer, not a copy. A reference project's code
is read-only — it is never modified by this job.

To pre-register at decomposition time, emit a `<references>` tag (a JSON array;
`branch` is optional and defaults to the project's main branch; `feature/{name}`
selects a feature branch):

<references>
[{"project":"<project-name>","branch":"<optional-git-ref>","reason":"<why-needed>"}]
</references>

If the need for a reference is only discovered later (during planning or
execution), register it then with the `register_reference` tool — no need to
predict it here.
{{/if}}
