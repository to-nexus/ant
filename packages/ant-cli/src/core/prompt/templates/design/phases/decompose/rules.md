## OUTPUT FORMAT

Return a JSON object with document type and tasks array.

### Schema

```typescript
{
  "documentType": "unified" | "contract-first";  // Document strategy
  "targetFiles": string[];  // File(s) to create (e.g., ["system-design.md"] or ["api-contract.md", "fe-system-design.md", "be-system-design.md"])
  "tasks": Array<{
    id: string;        // Unique identifier (e.g., "design-ch1-2")
    name: string;      // Task name (e.g., "Design Document: Architecture & Data")
    targetFile: string; // Which file this task writes to (MUST match targetFiles array)
    description: string; // What to write + length budget
    priority: number;  // 200-299 range, lower = higher priority
  }>
}
```

### Document Type Rules

**"unified"** - Single document for all content:
- Use when: Frontend-only, Backend-only, or tightly coupled fullstack
- targetFiles: `["system-design.md"]`
- All tasks write to `system-design.md`

**"contract-first"** - Separate documents for contract and implementations:
- Use when: Frontend AND Backend with clear API separation
- targetFiles: `["api-contract.md", "fe-system-design.md", "be-system-design.md"]`
- Phase 1 tasks write to `api-contract.md`
- Phase 2 tasks write to `fe-system-design.md`
- Phase 3 tasks write to `be-system-design.md`

**⚠️ CRITICAL: Once documentType is chosen, ALL tasks MUST use the correct targetFile from targetFiles array!**

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
- State WHAT to design (NOT HOW to write)
- Specify architectural scope (e.g., "Design system architecture and data models")
- **MUST include length budget**: "MAX [N] lines for this task!"
- **MUST include total limit**: "(Total doc limit: [Total] lines across N tasks)"
- For continuation tasks, state current progress: "(currently ~X lines after task N)"

**priority**:
- Use 200-299 range
- Sequential chapters: 220, 240, 260, 280
- Lower number = executes first

### Example Outputs

**Example 1: Unified (Frontend-only project)**
```json
{
  "documentType": "unified",
  "targetFiles": ["system-design.md"],
  "tasks": [
    {
      "id": "design-arch",
      "name": "Design Document: Architecture & Data",
      "targetFile": "system-design.md",
      "description": "Design system architecture and data models. MAX 100 lines for this task! (Total limit: 200 lines across 2 tasks)",
      "priority": 220
    },
    {
      "id": "design-ui",
      "name": "Design Document: UI Components",
      "targetFile": "system-design.md",
      "description": "Design component structure and user interactions. MAX 100 lines for this task! (Total limit: 200 lines, currently ~100 after task 1)",
      "priority": 240
    }
  ]
}
```

**Example 2: Contract-First (Frontend + Backend)**
```json
{
  "documentType": "contract-first",
  "targetFiles": ["api-contract.md", "fe-system-design.md", "be-system-design.md"],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract.md",
      "description": "Define API endpoints, DTOs, auth scheme. MAX 120 lines!",
      "priority": 200
    },
    {
      "id": "design-frontend",
      "name": "Frontend System Design",
      "targetFile": "fe-system-design.md",
      "description": "Design frontend architecture consuming api-contract.md. MAX 200 lines!",
      "priority": 220
    },
    {
      "id": "design-backend",
      "name": "Backend System Design",
      "targetFile": "be-system-design.md",
      "description": "Design backend architecture implementing api-contract.md. MAX 200 lines!",
      "priority": 240
    }
  ]
}
```

### Validation Checklist

Before outputting, verify:
- ✅ Valid JSON syntax
- ✅ `documentType` is either "unified" or "contract-first"
- ✅ `targetFiles` array matches documentType
- ✅ Every task's `targetFile` is in `targetFiles` array
- ✅ All required fields present (id, name, targetFile, description, priority)
- ✅ Description includes length budget
- ✅ Priority in 200-299 range
- ✅ No forbidden task types (deployment, ops, testing)

