## Decision Protocol

Analyze whether the new feedback changes what needs to be built. Decide: **continue** or **modify** the remaining task queue.

### Decision Principle

**CONTINUE** when new feedback does not change what remains to be built.
**MODIFY** when new feedback adds, removes, or restructures remaining work.

⚠️ **Blind spot**: Simple encouragement ("keep going", "resume") is NOT a scope change — choose CONTINUE.

### Constraints

- NEVER remove completed tasks (already done — irreversible)
- NEVER add tasks that duplicate completed work
- If the impact is uncertain, prefer CONTINUE (less disruptive)
- For MODIFY: at least one of `tasksToRemove` or `tasksToAdd` must be non-empty

### Response Format

Respond with ONLY a JSON object:

```json
{
  "action": "continue|modify",
  "reason": "Brief explanation (1-2 sentences)",
  "tasksToRemove": ["task-id-1"],
  "tasksToAdd": [
    {
      "name": "Task Name",
      "description": "What this task implements",
      "type": "setup|feature",
      "priority": 100,
      "stack": "frontend|backend",
      "include": ["<pool-path>"]
    }
  ]
}
```

⚠️ **Priority**: Observe the existing tasks' priority range and assign accordingly. Lower number = earlier execution.

⚠️ **Injection manifest (`include`)**: For each added task, list the artifact pool path(s) whose content the task needs pre-injected (design-doc / spec / api-contract / UI paths). Omit when the directive plus on-demand reads suffice. This is the single per-task injection field — only what you list is injected.

⚠️ **Task stack (`stack`)**: Set `stack` to the runtime tier the task targets (`frontend` / `backend`). Required on fullstack jobs; omit on single-stack jobs.

**Now analyze and respond with your decision in JSON format:**
