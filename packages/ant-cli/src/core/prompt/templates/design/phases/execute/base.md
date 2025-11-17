You are creating a SYSTEM DESIGN DOCUMENT for: **{{project}}**

This is a detailed technical specification that will be used by the code generation phase.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **STEP 1: ANALYZE PRD TO INFER PROJECT TYPE** 🚨

**BEFORE you start designing, READ the PRD carefully and determine:**

1. **Is this a FRONTEND-ONLY project?**
   - Look for: "no backend", "no server", "no API", "client-side only", "local storage only", "useState/local state"
   - If YES → Skip all backend/API/database sections

2. **Is this a BACKEND-ONLY project?**
   - Look for: "API server", "REST API", "no frontend", "headless", "service/microservice"
   - If YES → Focus on API design, skip UI sections

3. **Is this a FULL-STACK project?**
   - Look for: both frontend and backend requirements
   - If YES → Design both layers

4. **Technology Stack Constraints:**
   - Check for EXPLICIT tech requirements (e.g., "React + Vite", "useState only", "Tailwind", "No Redux")
   - If specified → USE EXACTLY what's specified, don't suggest alternatives

5. **Complexity Level:**
   - Check for: "simple", "minimal", "basic", "quick prototype"
   - If simple → Don't over-engineer with microservices, complex patterns, or extensive infrastructure

**PRD CONSTRAINTS ARE ABSOLUTE - THEY OVERRIDE THIS TEMPLATE!**

If PRD says "no database" → Skip all database design
If PRD says "useState only" → Don't suggest Redux/Zustand
If PRD says "Tailwind" → Don't suggest Material-UI/Bootstrap

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{#if currentTask}}
🎯 CURRENT TASK:
**Task Name**: {{currentTask.name}}
**Description**: {{currentTask.description}}
{{/if}}

{{#if designDoc}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXISTING DESIGN DOCUMENT (from previous tasks):

{{designDoc}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CRITICAL INSTRUCTION - Incremental Update Mode**:

This is a CONTINUATION task. The design document above already exists from previous work.

**YOU MUST**:
1. Generate ONLY the new/modified sections relevant to your current task
2. DO NOT regenerate existing sections that don't need changes
3. Clearly mark which sections you're adding/updating with headers

**Example Format**:
```markdown
## 3. Detailed Design

### 3.2 Data Models (UPDATED)

[Your new/updated content here - only this section]

### 3.5 Security Considerations (NEW)

[Your new section here]
```

This approach saves tokens and prevents redundant work. The system will merge your changes with the existing document.

{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## YOUR DESIGN STRATEGY:

{{plan}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## INSTRUCTIONS:

🚨 **CRITICAL OUTPUT FORMAT** 🚨

You MUST output in TWO SEPARATE steps:
1. **`<thinking>`** tag: Your analysis (KEEP SHORT - just key decisions)
2. **Close `</thinking>`, then use `<file>` or `<append>` tag**: Your design document

❌ NEVER put design document content inside `<thinking>` tags!
✅ Always use separate `<file>` or `<append>` tags for the actual design document.

🚨 **CRITICAL: CHOOSING THE RIGHT TAG** 🚨

**IF this is your FIRST task (task 1 of N):**
- ✅ MUST use `<file>` tag to create the document
- ❌ NEVER use `<append>` for the first task
- Even if you see a previous design in context, IGNORE IT and use `<file>`

**IF this is a continuation task (task 2+):**
- ✅ Use `<append>` tag to add new chapters
- The system will merge your content with the existing document

**Check your task description** - if it says "Design Document: Chapter 1" or similar, it's the FIRST task!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **CRITICAL SCOPE LIMITATION** 🚨

You are creating a **TECHNICAL SOFTWARE DESIGN** document, NOT a project/operations plan.

**FOCUS ON**: System architecture, components, data models, APIs, technical decisions
**DO NOT INCLUDE**: Deployment plans, infrastructure setup, operations, monitoring, migration plans, test schedules, project timelines

(See detailed rules at the end for full list of forbidden sections)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{#unless designDoc}}
This is the INITIAL task. Create a system design document that **matches the inferred project type and constraints**.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **STEP 2: ADAPT SECTIONS TO PROJECT TYPE** 🚨

**FOR FRONTEND-ONLY PROJECTS:**
- ✅ INCLUDE: Overview, Component Architecture, UI Design, State Management, Tech Stack
- ❌ SKIP: Backend API endpoints, Database schemas, Server architecture
- ✅ FOR "API Design" section: Write "Not Applicable - This is a frontend-only application with no backend server"

**FOR BACKEND-ONLY PROJECTS:**
- ✅ INCLUDE: Overview, API Design, Data Models, Business Logic, Tech Stack, Security
- ❌ SKIP: UI components, State management, Screen flows
- ✅ FOR "UI Design" section: Write "Not Applicable - This is a backend API with no user interface"

**FOR FULL-STACK PROJECTS:**
- ✅ INCLUDE: All relevant sections (frontend + backend)

**FOR SIMPLE PROJECTS:**
- ✅ KEEP IT CONCISE: 2-3 pages total, not 20 pages
- ❌ DON'T ADD: Microservices, complex patterns, extensive NFRs unless required

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Design document structure** (include only relevant sections based on your analysis):

### 1. Overview
- System purpose and goals
- Key stakeholders
- High-level architecture diagram (in text/ASCII or description)
- Core use cases

### 2. Architecture
- **System Architecture**: Overall system structure and component layout
- **Component Architecture**: Major components and their responsibilities
- **Data Architecture**: Data models, storage strategy, and data flow (if applicable - skip for pure frontend with no backend)
- **Integration Architecture**: External systems, APIs, and communication patterns (if applicable - skip if PRD says "no external API")

### 3. Detailed Design

#### 3.1 Component Design
For each major component identified in your strategy:
- Purpose and responsibility
- Internal structure and organization
- Key algorithms or business logic
- Dependencies and interfaces
- Error handling approach

#### 3.2 Data Models
**(If applicable - SKIP if PRD specifies no backend/database)**
- Entity definitions with attributes
- Relationships and cardinality
- Schemas (database tables, collections, or TypeScript interfaces for frontend state)
- Data validation rules
- If no database: explain data is managed in client-side state (localStorage, useState, etc.)

#### 3.3 API Design
**(If applicable - SKIP if PRD specifies no backend/API)**
- If NO API/backend: Write "Not Applicable - Frontend-only application with no API server"
- If API exists: Endpoints, request/response formats, authentication, error handling

#### 3.4 User Interface Design (if applicable)
- Screen flows and navigation
- Key interactions and user journeys
- State management approach
- Responsive design considerations
- Accessibility requirements

### 4. Technical Decisions

#### 4.1 Technology Stack
**USE EXACTLY what PRD specifies - don't suggest alternatives!**
- Languages and frameworks (with versions) - from PRD constraints
- Databases and storage solutions (if applicable - skip if "no backend")
- Third-party services and libraries
- Infrastructure and deployment platform (keep minimal if PRD says "simple")
- Justification: "As specified in PRD requirements" (don't over-justify obvious choices)

#### 4.2 Design Patterns
- Architectural patterns (MVC, MVVM, microservices, event-driven, etc.)
- Code patterns and best practices
- Rationale for pattern selection

### 5. Non-Functional Requirements

#### 5.1 Performance
- Response time targets and SLAs
- Throughput requirements (requests/sec, transactions/sec)
- Scalability approach (horizontal vs. vertical)
- Caching strategy (where, what, TTL)
- Database query optimization

#### 5.2 Security
- Authentication and authorization approach
- Data encryption (at rest and in transit)
- API security (API keys, OAuth, JWT)
- Input validation and sanitization
- Security best practices and compliance

#### 5.3 Reliability & Availability
- Uptime targets (SLA)
- Fault tolerance and redundancy
- Backup and disaster recovery
- Monitoring and alerting strategy

### 6. Implementation Considerations

#### 6.1 Development Workflow (CODE STRUCTURE ONLY)
- Repository structure and organization
- Testing strategy (what to test, not QA project plan)

**⚠️ DO NOT INCLUDE** (unless explicitly requested in directive):
- ❌ Deployment pipelines/strategies
- ❌ Infrastructure provisioning plans
- ❌ Environment setup procedures
- ❌ Rollout/migration plans
- ❌ Operations/monitoring plans
- ❌ Project timelines/schedules

### 7. Future Considerations (TECHNICAL ONLY)
- Known limitations and technical debt
- Feature extensibility points (how to add features in future)
- Scalability approach (how the design supports growth)

**⚠️ DO NOT INCLUDE**:
- ❌ Migration roadmaps
- ❌ Phased rollout plans
- ❌ Budget/resource estimates

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IMPORTANT**: This document will be used by the code generation phase. 
Make it detailed, specific, and actionable. Include concrete examples where helpful.

Focus on the areas highlighted in your design strategy as most critical.

{{else}}

🚨 **THIS IS A CONTINUATION TASK - DO NOT REPEAT PREVIOUS WORK** 🚨

**EXISTING DESIGN DOCUMENT** (already completed):
```
{{designDoc}}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**YOUR SPECIFIC TASK**: {{currentTask.name}}
**Description**: {{currentTask.description}}

**⚠️ CRITICAL INSTRUCTIONS FOR CONTINUATION TASKS**:

1. **DO NOT REPEAT ANALYSIS** ❌
   - Do NOT write "Design Strategy" again
   - Do NOT re-analyze requirements
   - Do NOT summarize the entire project again
   - The project analysis is ALREADY DONE in the existing document above

2. **WRITE ONLY YOUR ASSIGNED CHAPTERS** ✅
   - Task name tells you which chapters to write
   - Example: "Component Design" → Write ONLY Component Design chapter
   - Example: "API Design & Data Models" → Write ONLY those 2 chapters
   - START IMMEDIATELY with your chapter heading (e.g., "## 3. Detailed Design")

3. **BUILD UPON EXISTING CONTENT** ✅
   - Reference chapters from existing document when needed
   - Maintain consistency with established architecture
   - Use the same technology stack and terminology
   - Extend, don't contradict

4. **OUTPUT FORMAT** ✅
   - Use `<append>` tag (not `<file>` - document already exists!)
   - Start with your chapter number/heading
   - Example:
     ```xml
     <append path="outputs/design/system-design.md">
     ## 3. Detailed Design
     
     ### 3.1 Component Architecture
     ...
     </append>
     ```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CORRECT CONTINUATION EXAMPLE**:

Task: "Design Document: Component Design"

✅ **START IMMEDIATELY WITH YOUR CHAPTER**:
```xml
<append path="outputs/design/system-design.md">
## 3. Detailed Design

### 3.1 Component Architecture

Based on the architecture established in Chapter 2, we define the following components:

#### TaskManager Component
- **Purpose**: Central state management for task collection
- **Responsibilities**: CRUD operations, filtering logic
- **State**: Array<Task>, currentFilter: FilterType
...
</append>
```

❌ **DO NOT DO THIS** (repeating project analysis):
```
Design Strategy: Simple Tasks

1. Key Requirements
   - Frontend-only task management
   ...

<-- This is WRONG! Skip this, you already did it in Task 1! -->
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{/unless}}
