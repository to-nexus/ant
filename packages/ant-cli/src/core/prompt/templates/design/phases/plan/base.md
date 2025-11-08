━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: DESIGN STRATEGY (메타적 전략 문서)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT: {{project}}

{{#if currentTask}}
🎯 CURRENT TASK:
**Task Name**: {{currentTask.name}}
**Description**: {{currentTask.description}}
{{/if}}

⚠️  CRITICAL INSTRUCTIONS FOR THIS PHASE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 DO NOT WRITE THE SYSTEM DESIGN DOCUMENT IN THIS PHASE!

This is the STRATEGY phase. You will create a META-LEVEL design strategy document that guides the next phase.

✅ You will:
- Analyze requirements and constraints
- Identify key design challenges and priorities
- Define architectural approach and principles
- List critical decisions that need to be made
- Outline document structure and focus areas
- Specify what to emphasize and what to omit

🚫 You will NOT:
❌ Write detailed architecture diagrams
❌ Create complete data models
❌ Write full API specifications
❌ Generate comprehensive technical content
❌ Write the actual system design document

The actual system design document will be generated in the NEXT phase (EXECUTE).
This phase is about STRATEGY, not EXECUTION.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## YOUR TASK: CREATE A DESIGN STRATEGY DOCUMENT

Generate a CONCISE strategy document (50-100 lines) that serves as a guide for writing the system design.

### Format:

# Design Strategy for {{project}}

## 1. Requirements Analysis
- Key functional requirements (top 3-5)
- Critical non-functional requirements (performance, security, scalability)
- Constraints and limitations

## 2. Design Challenges & Priorities
- Main technical challenges to address
- Priority order (what's most critical?)
- Risk areas that need special attention

## 3. Architectural Approach
- High-level architectural style (e.g., monolith, microservices, event-driven)
- Key principles to follow (e.g., separation of concerns, modularity)
- Technology strategy (language, frameworks, infrastructure)

## 4. Critical Design Decisions
- What needs to be decided? (e.g., database choice, API style, auth method)
- Decision criteria for each
- Recommended direction (with brief rationale)

## 5. Document Structure Plan
- Main sections to include in the system design
- What to emphasize (detailed vs. high-level)
- What to omit or keep minimal

## 6. Execution Guidance
- What should the execute phase focus on?
- Any special instructions or considerations?
- Output format and structure preferences

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Remember: This is a STRATEGY document, not the system design itself.
Keep it SHORT, FOCUSED, and ACTIONABLE for the next phase.
