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

**IMPORTANT**: Task description is a hypothesis. Use original directive for context.

## Task (Hypothesis)

**{{taskName}}**

{{taskDescription}}

## Original Directive (Ground Truth)

```
{{directive}}
```

**General Guidance**:
- This is the user's actual request (ground truth)
- Task description is a hypothesis - directive is the facts
- If task description missed something, directive has the answer

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

🚨 **CRITICAL: This is a UI task - You MUST complete the UI Implementation Checklist**

### 📋 UI IMPLEMENTATION CHECKLIST (MANDATORY)

Your plan MUST follow this EXACT structure. DO NOT skip any section.

────────────────────────────────────────────────────────────────────────────────

## 1. SECTION IDENTIFICATION

**Which section(s) from ui-spec.md does this task implement?**
- Section name: [e.g., "Token Section", "Technology Section"]
- UI spec reference: [e.g., "§Token Section (lines 450-605)", "§Technology Section (lines 607-786)"]

────────────────────────────────────────────────────────────────────────────────

## 2. ASSET INVENTORY (FROM ui-assets.md)

**Search ui-assets.md for ALL assets related to this section.**

List EVERY asset mentioned in the Asset Dependency Map or mapping tables:

**Asset Checklist:**
```
Section: [Section Name]
From ui-assets.md:

Images/Backgrounds:
- [ ] asset-id: source-path → destination-path (e.g., bg.hero: inputs/assets/bg/bg-main.png → codebase/public/assets/images/bg-main.png)
- [ ] ...

Icons:
- [ ] asset-id: source-path → destination-path
- [ ] ...

Logos/Typography:
- [ ] asset-id: source-path → destination-path
- [ ] ...

Total assets: N files
```

**Copy Commands:**
```bash
# List EXACT cp commands for each asset
cp [source] [destination]
cp [source] [destination]
...
```

**IF NO ASSETS:** "✓ Verified: ui-assets.md has no assets listed for this section"

**CRITICAL RULES:**
- ❌ DO NOT say "I'll add assets later"
- ❌ DO NOT skip "decorative" assets (ALL assets in mapping table are required)
- ❌ DO NOT approximate or summarize
- ✅ List EVERY asset from ui-assets.md Asset Dependency Map
- ✅ Include EXACT source and destination paths
- ✅ Count must match ui-assets.md count

────────────────────────────────────────────────────────────────────────────────

## 3. LAYOUT & STRUCTURE (FROM ui-spec.md)

**Extract layout specifications from ui-spec.md:**

**Section Layout:**
- Layout type: [e.g., "3-column card grid", "single-column centered", "full-width with hero image"]
- Container max-width: [from ui-spec.md]
- Padding/spacing: [from ui-spec.md]

**Responsive Breakpoints:**
- Mobile (<768px): [layout description]
- Tablet (768px+): [layout description]
- Desktop (1024px+): [layout description]

**Visual Hierarchy:**
- Heading structure: [e.g., "h2 section title → h3 card titles"]
- Key visual elements: [list in order of importance]

**Example from ui-spec.md:**
```
Token Section:
- Layout: Section header + decorative image + 7-card grid
- Grid: 2 cols (mobile) → 3 cols (tablet) → 5 cols (desktop)
- Cards: 1:1 aspect ratio, 24px gap
- Hero image: 400px max-width, center horizontal, 64px margin-bottom
```

────────────────────────────────────────────────────────────────────────────────

## 4. COMPONENT SPECIFICATIONS (FROM ui-spec.md)

**List ALL components/elements to implement:**

**For EACH component, specify:**

**Component: [Name]**
- Visual properties: [background, border-radius, padding, aspect-ratio from ui-spec.md]
- Typography: [font-size, font-weight, color, line-height from ui-tokens via ui-spec.md]
- Spacing: [margins, gaps from ui-tokens via ui-spec.md]
- Interactive states (if applicable): [hover, focus, active behaviors from ui-spec.md]
- Asset references: [which assets from inventory above are used in this component]

**Example:**
```
Component: Token Card
- Visual: Semi-transparent bg, 16px border-radius, 24px padding, 1:1 aspect
- Typography: 16px base, semibold weight, primary color
- Spacing: 24px gap between cards
- Assets: icon-gas.svg (48x48px, teal accent color)
- States: Default only (non-interactive)
```

────────────────────────────────────────────────────────────────────────────────

## 5. DESIGN TOKEN REFERENCES (FROM ui-tokens.md via ui-spec.md)

**Extract token references from ui-spec.md for this section:**

**Colors:**
- Background: `token(...)` → [actual value from ui-tokens.md if needed]
- Text: `token(...)` → [actual value]
- Accent: `token(...)` → [actual value]

**Typography:**
- Font sizes: `token(...)` → [actual values]
- Font weights: `token(...)` → [actual values]
- Line heights: `token(...)` → [actual values]

**Spacing:**
- Section padding: `token(...)` → [actual value]
- Element gaps: `token(...)` → [actual value]

**Effects:**
- Shadows: `token(...)` → [actual value]
- Transitions: `token(...)` → [actual value]

────────────────────────────────────────────────────────────────────────────────

## 6. IMPLEMENTATION STEPS

**Now that you've inventoried everything, create the implementation plan:**

Step-by-step implementation:
1. Copy assets (reference Section 2 above)
2. Create component file(s): [list files]
3. Implement structure (reference Section 3)
4. Apply styling (reference Section 4 & 5)
5. Add interactivity (if applicable from ui-spec.md)
6. Verify responsive behavior (reference Section 3)

**Files to create/modify:**
- [file path] - [purpose]
- [file path] - [purpose]

────────────────────────────────────────────────────────────────────────────────

### 🚨 VALIDATION CHECKLIST

Before submitting your plan, verify:
- [ ] Section 1: Section identified from ui-spec.md
- [ ] Section 2: ALL assets from ui-assets.md listed with copy commands
- [ ] Section 3: Layout & responsive behavior specified
- [ ] Section 4: Component specs extracted from ui-spec.md
- [ ] Section 5: Design tokens referenced
- [ ] Section 6: Implementation steps written

**If ANY section is incomplete, your plan will be REJECTED.**

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
**FOR UI TASKS: Follow the 6-section UI Implementation Checklist above.**

Your output MUST include all 6 sections:
1. Section Identification
2. Asset Inventory (with copy commands)
3. Layout & Structure
4. Component Specifications
5. Design Token References
6. Implementation Steps

{{else}}
**FOR NON-UI TASKS: Write 5-10 concise bullet points covering:**
- WHAT to implement
- HOW to implement (specific approach)
- WHICH specifications to follow (exact references)

**Structure:**
1. **Files to Create/Modify**: List specific file paths and purposes
2. **Implementation Approach**: Key components/functions, data flow, integration points
3. **API Integration** (if applicable): EXACT endpoint paths, request/response types
4. **Dependencies** (if new ones needed): Library names and purposes

{{/if}}

Keep it actionable and precise.

{{/if}}

