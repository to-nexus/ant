## Decision Protocol

Analyze the relationship between the original directive and new user feedback. Decide whether to **continue** as-is or **modify** the remaining task queue.

### Decision Criteria

**CONTINUE** — The remaining tasks are still valid. New feedback does not change scope or priorities.

**MODIFY** — New feedback changes scope, removes requirements, or adds new requirements. Adjust the task queue accordingly.

### Constraints

- NEVER remove completed tasks (they are already done)
- NEVER add tasks that duplicate completed work
- If the impact is uncertain, prefer CONTINUE (less disruptive)
- For MODIFY: at least one of `tasksToRemove` or `tasksToAdd` must be non-empty

### Response Format

Respond with ONLY a JSON object:

```json
{
  "action": "continue|modify",
  "reason": "Brief explanation (1-2 sentences)",
  "tasksToRemove": ["task-id-1", "task-id-2"],
  "tasksToAdd": [
    {
      "name": "Task Name",
      "description": "What this task does",
      "type": "setup|feature",
      "priority": 250
    }
  ]
}
```

### Priority Reference

- 100-149: setup (project initialization)
- 200-280: feature (implementation)
- 900-999: error fix (post-implementation)

**Now analyze and respond with your decision in JSON format:**
