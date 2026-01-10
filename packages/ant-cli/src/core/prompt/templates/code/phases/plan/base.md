{{#if isKeywordGeneration}}
# Generate Task-Specific Search Keywords

You are analyzing a task to generate semantic search keywords.

**IMPORTANT**: Task description is a hypothesis. Use original directive as ground truth.

## Task (Hypothesis)

**{{taskName}}**

{{taskDescription}}

**Note**: This task was created based on initial analysis. It may not capture the full picture.

## Original Directive (Ground Truth)

```
{{directive}}
```

**Use this for objective facts**: error codes, stack traces, file paths, error messages.

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

────────────────────────────────────────────────────────────────────────────────
## 🚨 CRITICAL PRINCIPLE: Task Description is INCOMPLETE by Design
────────────────────────────────────────────────────────────────────────────────

**The task description below is a GUIDE, not a complete specification.**

Your responsibility:
1. **Use task description as a starting point** (what general area to work on)
2. **Read all available documents** (specs, contracts, UI docs, codebase)
3. **Extract complete requirements** from documents
4. **Plan to implement EVERYTHING found in documents**, not just task description

**Available documents in this context**:
{{#if hasUiDoc}}- ✅ **ui-spec.md**: Complete UI specifications (layout, components, interactions)
- ✅ **ui-assets.md**: All assets with source/destination mappings
- ✅ **ui-tokens.md**: Design tokens (colors, typography, spacing)
{{/if}}{{#if designDoc}}- ✅ **API Contract**: Exact endpoints, request/response types, field names
{{/if}}{{#if projectCodeContext}}- ✅ **Existing codebase**: Current implementation, integration points
{{/if}}- ✅ **Original directive**: User's actual request (ground truth)

**Correct approach**:
```
❌ WRONG: Read only task description → Plan based on task alone
✅ RIGHT: Read task → Read ALL documents → Extract complete requirements → Plan everything
```

**Rule**: If document mentions it → Your plan MUST include it.

────────────────────────────────────────────────────────────────────────────────

## Task (Starting Point)

**{{taskName}}**

{{taskDescription}}

## Original Directive (Ground Truth)

```
{{directive}}
```

────────────────────────────────────────────────────────────────────────────────
{{#if isRetry}}
### ⚠️  RETRY CONTEXT: PREVIOUS ATTEMPT FAILED
────────────────────────────────────────────────────────────────────────────────

**The following violations occurred in the previous attempt:**

```
{{violationsText}}
```

**Your plan MUST address these failures:**
- ✅ Analyze root cause of each violation
- ✅ Understand WHY the previous approach failed
- ✅ Propose fundamentally different approach (not just tweaking the same method)
- ✅ Consider trade-offs: simpler vs complete, safe vs efficient
- ❌ DO NOT blindly retry the exact same operations that failed
- ❌ DO NOT just apply generic fixes without understanding the context

────────────────────────────────────────────────────────────────────────────────
{{/if}}
────────────────────────────────────────────────────────────────────────────────
### 🚨 IF DIRECTIVE CONTAINS ERROR/STACK TRACE:
────────────────────────────────────────────────────────────────────────────────

**CRITICAL - Error Context Analysis**:

1. **Error Message** → PRIMARY symptom to diagnose
2. **Stack Trace Files** → WHERE the error occurred (prioritize in retrieved files)
3. **Line Numbers** → EXACT location to investigate
4. **Error Code/Type** → Classification of the problem

**Your Plan MUST**:
- ✅ Explicitly reference the error information from directive
- ✅ Reference specific files and locations from stack trace
- ✅ Explain HOW the plan addresses the ROOT CAUSE
- ✅ Connect the error symptom to the proposed solution
- ❌ DO NOT create generic plans that ignore error details
- ❌ DO NOT only rely on task description if it contradicts error evidence

**Reasoning Approach**:
- Start from the error symptom (what broke?)
- Trace through stack locations (where did it break?)
- Identify root cause (why did it break?)
- Propose specific fix (how to prevent it?)

────────────────────────────────────────────────────────────────────────────────
### 🔬 IF BEHAVIORAL BUG (Compiles but behaves incorrectly):
────────────────────────────────────────────────────────────────────────────────

**CRITICAL - Empirical Diagnosis Required**

**Classification Indicators:**
System produces incorrect behavior despite passing static analysis.

**Core Principle:**
Behavioral bugs require observation of runtime system state, not code inspection.
Your plan must specify the empirical method for diagnosis.

**Your Plan MUST Include:**

**1. Hypothesis Structure**
- State 2-3 falsifiable hypotheses about causal mechanism
- For each hypothesis:
  - What specific mechanism causes observed symptom?
  - What runtime evidence would validate/invalidate this?
  - What values or sequences would distinguish this from alternatives?

**2. Observation Strategy**
- Which system boundaries to instrument
- What values/states/sequences to capture
- How to trigger symptom in controlled manner
- What environmental conditions to maintain

**3. Evidence Evaluation Criteria**
- What patterns in runtime data indicate each hypothesis?
- What magnitude/frequency/sequence deviations signal root cause?
- How to distinguish root cause from cascading symptoms?

**4. Verification Protocol**
- How to confirm mechanism correction (not just symptom suppression)
- What behavioral metrics validate fix
- What edge cases to test

**Meta-Principle:**
Plan must enable hypothesis testing through runtime observation.
Speculation without empirical validation is insufficient.

**Anti-Patterns to Avoid:**
- ❌ Proposing fix without diagnostic plan
- ❌ Generic "add logging" without specifying what to observe
- ❌ Assuming code review reveals behavioral issues
- ❌ Skipping runtime verification step

────────────────────────────────────────────────────────────────────────────────

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

{{#if hasUiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPECIFICATION & ASSETS
════════════════════════════════════════════════════════════════════════════════

{{uiDoc}}

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

{{#if hasUiDoc}}
**FOR UI TASKS:**

Your plan MUST include these sections:

#### 1. 📂 CODEBASE STRUCTURE ANALYSIS

**FIRST**, analyze the existing codebase structure to maintain consistency:

```
## Codebase Structure Analysis

Existing files found:
- [List key existing component files and their paths]

Pattern detected:
- Components location: `components/` or `app/components/` or `src/components/`
- Sections location: `components/sections/` or `app/sections/`
- Other patterns: [any other relevant patterns]

**DECISION**: New files for this task will follow [specify the exact pattern]
```

**CRITICAL**: 
- Check `projectCodeContext` to see existing file locations
- DO NOT create duplicate directory structures
- If `components/sections/About.tsx` exists, put new sections there too
- If `app/components/` doesn't exist, don't create it

#### 2. 📦 ASSET INVENTORY
- Search ui-assets.md for assets related to this section/component
- List ALL assets with exact paths: `asset-id: source → destination`
- Provide `cp` commands for each asset
- Count total: `Total: N assets`
- If none found: "✓ No assets in ui-assets.md for this section"

#### 3. 📐 LAYOUT & COMPONENT SPECS
- Extract layout structure from ui-spec.md (grid/flex, responsive breakpoints)
- List each component with:
  - Visual properties (background, border, padding, etc.)
  - Typography (size, weight, color)
  - Interactive states (if applicable)
  - Asset usage (which assets go where)
- Note design token references

#### 4. 📋 IMPLEMENTATION PLAN
- Step-by-step implementation
- Files to create/modify
- Verification steps

{{else}}
**FOR NON-UI TASKS:**

Write 5-10 concise bullet points:
- Files to create/modify
- Implementation approach
- API integration (if applicable)
- Dependencies (if needed)

{{/if}}

Keep it actionable and precise.

{{/if}}

