# Replan Decision

You are analyzing whether to **continue**, **modify**, or **restart** the current development plan based on new user feedback.

## Current State

**Project:** {{context.project}}
**Feature:** {{context.featureFolder}}

**Progress:** {{completedCount}}/{{totalTasks}} tasks completed

{{#if currentTask}}
**Current Task:**
- ID: `{{currentTask.id}}`
- Name: {{currentTask.name}}
- Type: {{currentTask.type}}
- Priority: {{currentTask.priority}}
{{else}}
**Current Task:** None (ready to start next task)
{{/if}}

**Remaining Tasks:**
{{#each remainingTasks}}
{{add @index 1}}. [P{{priority}}] {{name}} ({{type}})
   {{description}}
{{/each}}

{{#if completedTasksList}}
**Completed Tasks:**
{{#each completedTasksList}}
- {{name}} ({{type}})
{{/each}}
{{/if}}

---

## Original Directive

```
{{originalDirective}}
```

---

## New User Feedback

```
{{newFeedback}}
```

---

## Your Task

Analyze the relationship between the original directive and the new user feedback, then decide on the best course of action.

### Decision Options

**A) CONTINUE** - New feedback is minor clarification or confirmation. Current plan is still valid and aligned with user's intent.

Examples:
- "Make sure to use bcrypt for password hashing" (when already implementing auth)
- "Add error handling for edge cases" (minor addition)
- "Use port 3000 instead of 8080" (config detail)

**B) MODIFY** - New feedback requires adjusting specific tasks, but the overall plan structure is OK. Some tasks need to be updated or reordered.

Examples:
- "Only need 3 endpoints instead of 5" (reduce scope)
- "Skip the admin panel for now" (remove some tasks)
- "Add Redis caching to API" (add specific task)

**C) RESTART** - New feedback fundamentally changes the requirements or architecture. Need to decompose again from scratch.

Examples:
- "Actually, use GraphQL instead of REST" (architecture change)
- "Switch from React to Vue" (framework change)
- "Make it a CLI tool instead of web app" (product type change)

### Response Format

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):

```json
{
  "action": "continue|modify|restart",
  "reason": "Brief explanation (1-2 sentences)",
  "tasksToModify": ["task-id-1", "task-id-2"],
  "confidence": 0.0-1.0
}
```

**Rules:**
- `action` must be exactly one of: `"continue"`, `"modify"`, or `"restart"`
- `reason` should be concise but clear
- `tasksToModify` is REQUIRED if `action` is `"modify"`, otherwise empty array
- `confidence` is 0.0 (very uncertain) to 1.0 (very certain)
- If unsure between two options, pick the LESS disruptive one (continue > modify > restart)

### Examples

**Example 1: Continue**
```json
{
  "action": "continue",
  "reason": "New feedback is about implementation details (bcrypt) which doesn't change the plan structure.",
  "tasksToModify": [],
  "confidence": 0.95
}
```

**Example 2: Modify**
```json
{
  "action": "modify",
  "reason": "User wants to reduce endpoint count from 5 to 3. Need to remove specific API tasks.",
  "tasksToModify": ["api-endpoint-4", "api-endpoint-5"],
  "confidence": 0.85
}
```

**Example 3: Restart**
```json
{
  "action": "restart",
  "reason": "Architecture change from REST to GraphQL requires completely different task decomposition.",
  "tasksToModify": [],
  "confidence": 0.92
}
```

---

**Now analyze and respond with your decision in JSON format:**

