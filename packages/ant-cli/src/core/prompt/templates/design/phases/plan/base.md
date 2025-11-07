━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: DESIGN PLANNING (Document Outline & Strategy)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PROJECT: {{project}}

{{#if currentTask}}
🎯 CURRENT TASK:
**Task Name**: {{currentTask.name}}
**Description**: {{currentTask.description}}
{{/if}}

⚠️  CRITICAL INSTRUCTIONS FOR THIS PHASE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 DO NOT WRITE THE FULL DESIGN DOCUMENT IN THIS PHASE!

This is the PLANNING phase. You will:
✅ Create a document outline/table of contents
✅ Identify key sections to cover
✅ List main topics for each section (1-2 lines each)
✅ Define the approach and priorities

🚫 You will NOT:
❌ Write detailed architecture diagrams
❌ Create complete data models
❌ Write full API specifications
❌ Generate comprehensive content

The actual detailed design document will be generated in the NEXT phase (EXECUTE).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## YOUR TASK: CREATE A CONCISE DESIGN PLAN

Generate a SHORT design plan (50-100 lines) that includes:

### 1. Document Structure
List the main sections to include:
- Overview (purpose, stakeholders, goals)
- Architecture (components, communication patterns)
- Data Models (entities, relationships, storage)
- API Design (key endpoints, contracts)
- Security (authentication, authorization, data protection)
- Performance (targets, caching, scalability)
- Deployment (infrastructure, CI/CD)
- etc.

### 2. Key Focus Areas
For each section, note 1-2 key topics to address:
- Example: "Architecture: Microservices vs Monolith, service boundaries"
- Example: "Data Models: User, Transaction, Portfolio entities"

### 3. Approach & Priorities
- Which sections are most critical?
- What order should they be covered?
- Any special considerations or constraints?

### 4. Open Questions
- What needs clarification?
- What assumptions are being made?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Keep your plan CONCISE. The execute phase will expand it into a full document.
