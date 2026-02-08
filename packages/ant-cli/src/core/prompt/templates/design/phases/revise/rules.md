## Decision Protocol

Analyze the relationship between the original directive and new user feedback. Decide whether to **continue** as-is or **modify** the remaining design task queue.

### Decision Criteria

**CONTINUE** — The remaining tasks are still valid. New feedback does not change scope, target documents, or priorities.

**MODIFY** — New feedback changes scope, removes document requirements, adds new document targets, or adjusts design approach. Adjust the task queue accordingly.

### Constraints

- NEVER remove completed tasks (they are already done)
- NEVER add tasks that duplicate completed work
- If the impact is uncertain, prefer CONTINUE (less disruptive)
- For MODIFY: at least one of `tasksToRemove` or `tasksToAdd` must be non-empty
- Design tasks produce documents — each task targets a specific output file

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
      "description": "What this task produces",
      "type": "doc",
      "priority": 250,
      "targetFile": "output-filename.md"
    }
  ]
}
```

### Priority Reference

- 200-249: API contract / shared interface documents
- 250-299: System design / architecture documents
- 300-349: UI specification documents

**Now analyze and respond with your decision in JSON format:**
