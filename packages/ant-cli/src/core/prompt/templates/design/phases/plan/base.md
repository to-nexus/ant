━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: DESIGN STRATEGY (CONCISE 전략 가이드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT: {{project}}

{{#if currentTask}}
🎯 CURRENT TASK: {{currentTask.name}}
{{currentTask.description}}
{{/if}}

{{#unless designDoc}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  FIRST TASK: OVERALL PROJECT STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 MAXIMUM OUTPUT: 30-40 LINES (strict limit)
🚨 This is NOT the system design document - just a STRATEGY guide!

Your job is to create a BRIEF, ACTIONABLE strategy that will guide the EXECUTE phase.
Think of this as "design planning notes" - not detailed documentation.

✅ DO (keep each section 2-3 bullet points MAX):
- Identify 2-3 key requirements (NOT all of them)
- List 1-2 main technical challenges
- Define high-level approach (1-2 sentences)
- Note critical decisions needed (2-3 items)

❌ DON'T (these belong in EXECUTE phase):
- Write detailed explanations
- Create specifications
- Repeat task breakdown (already done)
- Add extra sections beyond the 4 required

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## REQUIRED FORMAT (STRICT - stay within 30-40 lines total):

# Design Strategy: {{currentTask.name}}

## 1. Key Requirements (2-3 items only)
- [Requirement 1]
- [Requirement 2]

## 2. Technical Challenges (1-2 items only)
- [Challenge]: [1-line approach]

## 3. Architectural Approach (3-5 lines max)
- Style: [architecture type]
- Principles: [1-2 key principles]
- Stack: [brief tech stack]

## 4. Execute Phase Focus (2-3 priorities)
- [Priority 1]
- [Priority 2]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STOP IMMEDIATELY after section 4. Do NOT add extra sections.
BE EXTREMELY CONCISE - every word must add value.

{{else}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  CONTINUATION TASK: CHAPTER-SPECIFIC PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**EXISTING DESIGN DOCUMENT**:
```
{{designDoc}}
```

🚨 **DO NOT REPEAT PROJECT-LEVEL STRATEGY** 🚨

The overall project strategy is ALREADY ESTABLISHED in the existing document.
Your job is to plan ONLY the specific chapters you will write in this task.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## REQUIRED FORMAT (10-15 lines max):

# Chapter Plan: {{currentTask.name}}

## 1. Chapters to Write (list chapter numbers/names)
- Chapter X: [Name]
- Chapter Y: [Name]

## 2. Key Content for Each Chapter (1-2 lines per chapter)
- **Chapter X**: [What will be covered]
- **Chapter Y**: [What will be covered]

## 3. References to Existing Content (1-2 items)
- Will build upon: [existing chapter/section]
- Will use tech stack from: [existing section]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CRITICAL**: This is a CHAPTER PLAN, not a PROJECT STRATEGY.
- ❌ DO NOT write "Key Requirements" (already in existing doc)
- ❌ DO NOT write "Technical Challenges" (already analyzed)
- ❌ DO NOT write "Architectural Approach" (already established)
- ✅ ONLY write what chapters YOU will add and what they will contain

{{/unless}}
