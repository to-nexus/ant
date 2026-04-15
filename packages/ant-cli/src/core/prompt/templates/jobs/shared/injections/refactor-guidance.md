{{#if (eq resolvedAction.mode "refactor")}}
## Refactoring Constraints

You are modifying an existing system. Observe these constraints:

1. **Preserve existing behavior**: Do NOT change functionality unless explicitly requested.
2. **Minimize blast radius**: Change only what is necessary. Avoid cascading modifications.
3. **Maintain interfaces**: Public APIs, exported types, and component contracts must remain compatible unless the user explicitly requests breaking changes.
4. **Document rationale**: When structural changes are necessary, explain why the new structure is better.
{{/if}}
