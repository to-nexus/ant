{{#if hasExistingCode}}
## Existing-Code Discipline

The workspace already contains code. Every change this turn lands INSIDE that
existing system — regardless of which document or directive drives the work.

**Modification principles:**
1. **Build on existing**: Modify/extend what exists. Do NOT recreate files, modules, or infrastructure that already work.
2. **Preserve existing behavior**: Do NOT change functionality the directive does not ask to change.
3. **Minimize blast radius**: Change only what is necessary. Avoid cascading modifications into untouched areas.
4. **Maintain interfaces**: Public APIs, exported types, and component contracts must remain compatible unless the user explicitly requests breaking changes.
5. **Document rationale**: When a structural change is unavoidable, state why the new structure is better.

**Constraints:**
- Missing file ≠ missing infrastructure. Fix the gap in place; do NOT rebuild the foundation.
- Do NOT assume greenfield defaults (fresh scaffolding, new config trees) when the observable codebase already made those decisions — follow the decisions the code records.

⚠️ Blind spot: a directive that only DESCRIBES a desired outcome still lands on the existing code — "implement X" over an existing system means "extend the system with X", never "start a new system that has X".
{{/if}}
