## OUTPUT FORMAT

Return a JSON object with a "tasks" array.

### Task Object Schema

```typescript
{
  "tasks": Array<{
    id: string;        // Unique identifier (e.g., "design-ch1-2")
    name: string;      // Task name (e.g., "Design Document: Architecture & Data")
    description: string; // What to write + length budget
    priority: number;  // 200-299 range, lower = higher priority
  }>
}
```

### Task Property Rules

**id**:
- Format: `design-doc` (single task) or `design-ch1-2` (multi-chapter)
- Must be unique within the project
- Use kebab-case

**name**:
- Single task: "Create Design Document"
- Multi-task: "Design Document: [Chapter Names]"
- Keep concise (< 60 chars)

**description**:
- State which chapters/sections to write
- Specify key topics to cover
- **MUST include length budget**: "MAX [N] lines for this task!"
- **MUST include total limit**: "(Total doc limit: [Total] lines across N tasks)"
- For continuation tasks, state current progress: "(currently ~X lines after task N)"

**priority**:
- Use 200-299 range
- Sequential chapters: 220, 240, 260, 280
- Lower number = executes first

### Example Task Objects

**Single Task**:
```json
{
  "id": "design-doc",
  "name": "Create Design Document",
  "description": "Design the simple counter button component with state management. MAX 150 lines total!",
  "priority": 250
}
```

**Multi-Task (First)**:
```json
{
  "id": "design-ch1-2",
  "name": "Design Document: Architecture & Data Model",
  "description": "Write chapters 1-2: System overview, todo data model, and database schema. MAX 150 lines for this task! (Total limit: 300 lines across 2 tasks)",
  "priority": 220
}
```

**Multi-Task (Continuation)**:
```json
{
  "id": "design-ch3-4",
  "name": "Design Document: API & UI Components",
  "description": "Write chapters 3-4: REST API endpoints and UI component specifications. MAX 150 lines for this task! (Total limit: 300 lines, currently ~150 after task 1)",
  "priority": 240
}
```

### Validation Checklist

Before outputting, verify:
- ✅ Valid JSON syntax
- ✅ All required fields present (id, name, description, priority)
- ✅ Description includes length budget
- ✅ Priority in 200-299 range
- ✅ No forbidden task types (deployment, ops, testing)
- ✅ All tasks target the same document file

