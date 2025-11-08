━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: DESIGN STRATEGY (CONCISE 전략 가이드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT: {{project}}

{{#if currentTask}}
🎯 CURRENT TASK: {{currentTask.name}}
{{currentTask.description}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  CRITICAL LENGTH RESTRICTION
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
