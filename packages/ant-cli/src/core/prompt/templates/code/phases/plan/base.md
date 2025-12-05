{{#if isKeywordGeneration}}
# Generate Task-Specific Search Keywords

You are analyzing a task to generate semantic search keywords.

## Task

**{{taskName}}**

{{taskDescription}}

## Project Context

- Language: {{language}}
- Framework: {{framework}}
- Mode: {{mode}}

{{#if hasReferences}}
## 📚 Reference Projects Available

{{referenceProjects}}

**IMPORTANT:** You may ONLY generate keywords for these reference projects listed above.

{{else}}
## 📚 Reference Projects

**NONE available.** Do NOT generate reference keywords.

{{/if}}

## Output Format

{{#if hasReferences}}
```json
{
  "codebase": ["keyword1", "keyword2", ...],
  "references": {
    "project1": ["ref-keyword1", "ref-keyword2", ...],
    "project2": [...]
  }
}
```

**Note:** Only include reference project in `references` if you actually need it for this task. Empty object `{}` is acceptable.
{{else}}
```json
{
  "codebase": ["keyword1", "keyword2", ...],
  "references": {}
}
```

**CRITICAL:** `references` MUST be empty object `{}` since no reference projects are available.
{{/if}}

{{> code/phases/plan/rules}}

{{else}}
# Generate Task Plan

You are planning HOW to implement a specific task.

## Task

**{{taskName}}**

{{taskDescription}}

{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
## 📐 DESIGN SPECIFICATION (SOURCE OF TRUTH)
════════════════════════════════════════════════════════════════════════════════

🚨 **CRITICAL: API Contract contains IMMUTABLE specifications**

**Use EXACT specifications from API Contract:**
- Endpoint paths (e.g., `POST /rooms/create` NOT `/rooms`)
- Field names and types (e.g., `userId: string` NOT `user_id`)
- Validation rules
- Response structures

**Your execution plan MUST reference specifications EXACTLY.**

{{designDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}

{{#if projectCodeContext}}
════════════════════════════════════════════════════════════════════════════════
## 📁 CURRENT CODEBASE
════════════════════════════════════════════════════════════════════════════════

{{projectCodeContext}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}

## Your Task

Generate a **concrete implementation plan** for this task.

### What to Include:

1. **API Integration** (if applicable):
   - EXACT endpoint paths from API Contract (copy verbatim)
   - EXACT request/response types
   - Example: "Call `POST /rooms/create` with `CreateRoomRequest { name, maxPlayers }`"

2. **Files to Create/Modify**:
   - Specific file paths
   - Purpose of each file

3. **Implementation Approach**:
   - Key components/functions
   - Data flow
   - Integration points

4. **Dependencies** (if new ones needed):
   - Library names
   - Purpose

### Rules:

- ✅ Copy API Contract specifications EXACTLY (endpoints, field names, types)
- ✅ Be specific and concrete
- ✅ Reference existing code when modifying
- ❌ DO NOT simplify endpoint paths (`/rooms/create` → `/rooms`)
- ❌ DO NOT rename fields for "consistency"
- ❌ DO NOT apply "best practices" that differ from spec

### Output Format:

Write 5-10 concise bullet points covering:
- WHAT to implement
- HOW to implement (specific approach)
- WHICH specifications to follow (exact references)

Keep it actionable and precise.

{{/if}}

