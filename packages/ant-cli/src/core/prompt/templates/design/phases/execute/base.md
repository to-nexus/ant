You are creating a **CONCISE** SYSTEM DESIGN DOCUMENT for: **{{project}}**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ **OUTPUT LENGTH ENFORCEMENT** ⚠️

Your output **WILL BE REJECTED** if it exceeds:
- Simple project: **800 lines MAX**
- Medium project: **1500 lines MAX**
- Complex project: **3000 lines MAX**

**COUNT YOUR LINES. STOP WHEN YOU HIT THE LIMIT.**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **ABSOLUTE RULE #1: STRICT LENGTH LIMITS** 🚨

**YOUR OUTPUT WILL BE REJECTED IF IT EXCEEDS THESE LIMITS:**

| Document Type | MAX Length | Per-Chapter MAX |
|--------------|------------|-----------------|
| Simple project (todo app) | **800 lines** | 150 lines |
| Medium project (blog) | **1500 lines** | 250 lines |
| Complex project (SaaS) | **3000 lines** | 400 lines |

**IF YOU WRITE MORE THAN THIS, YOU FAIL.**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **ABSOLUTE RULE #2: NO CODE IMPLEMENTATIONS** 🚨

**FORBIDDEN** (will cause rejection):
- ❌ Function bodies / implementations
- ❌ Component code (React/Vue/etc)
- ❌ SQL CREATE statements
- ❌ Config file contents
- ❌ Example code blocks > 10 lines
- ❌ Step-by-step implementation guides

**ALLOWED** (must be brief):
- ✅ Interface definitions (≤10 lines)
- ✅ Function signatures (1 line, NO body)
- ✅ Prose descriptions (explain in words)

**RATIO REQUIREMENT**: 80% prose, 20% code/diagrams MAX

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **ABSOLUTE RULE #3: WRITE CONCISELY** 🚨

**Before writing each section, ask:**
1. "Can I explain this in 3 sentences instead of 10?" → DO IT
2. "Is this implementation detail or design decision?" → Only keep design
3. "Would a developer understand without this?" → If YES, delete it

**Writing Style:**
- ✅ "Use React Context for state" (1 sentence)
- ❌ "React Context is a built-in feature that allows..." (tutorial mode)

**If you're writing a tutorial, YOU'RE DOING IT WRONG.**

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

## INSTRUCTIONS:

🚨 **CRITICAL OUTPUT FORMAT** 🚨

You MUST output in TWO SEPARATE steps:
1. **Think through your analysis** (internal reasoning - KEEP SHORT - just key decisions)
2. **Then use `<file>` or `<append>` tag**: Your design document

✅ Always use `<file>` or `<append>` tags for the actual design document.

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

🚨 **WHAT TO WRITE vs. WHAT TO SKIP** 🚨

**✅ WRITE** (design decisions):
- Architecture pattern choice + why
- Component responsibilities
- Data structure (interfaces only)
- API contracts (signatures only)
- Tech stack + rationale

**❌ SKIP** (implementation details):
- How to implement components
- Deployment/ops/monitoring
- Test cases/QA plans
- Migration/rollout plans
- Performance profiling
- Git workflows

**❌ SKIP** (unnecessary context):
- Technology tutorials
- "What is React?" explanations
- Detailed tech comparisons
- Background information
- Future roadmaps beyond extensibility

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 **REMINDER: NO CODE IMPLEMENTATIONS!** 🚨

This rule was already stated above. If you're tempted to write code, STOP and write prose instead.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(See detailed section-specific rules below)

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

**Design document structure** (adapt based on project type - skip irrelevant sections):

### 1. Overview (≤1 page)
- System purpose (2-3 sentences)
- High-level architecture (text diagram or 1 paragraph)
- Core use cases (bullet list, ≤5 items)

### 2. Architecture (≤2 pages)
- **Chosen Pattern**: Name + why (e.g., "MVC because...")
- **Major Components**: List with 1-sentence responsibility each
- **Data Flow**: How data moves through system (prose or simple diagram)

### 3. Key Design Decisions (≤2 pages)

#### 3.1 Component Structure
For each major component (≤3 components):
- **Purpose**: 1 sentence
- **Interfaces**: Type definitions ONLY (≤10 lines each)
- **Dependencies**: What it talks to

Example:
```typescript
interface TaskService {
  getTasks(): Task[];
  addTask(title: string): Task;
}
```

#### 3.2 Data Models
**(SKIP if no backend/database)**

List entities with fields ONLY. NO SQL. NO ORM code.

Example:
```typescript
interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}
// Relationships: User 1:N Tasks
```

#### 3.3 API Contracts
**(SKIP if no API)**

List endpoints with types ONLY. NO handler code.

Example:
```typescript
POST /api/tasks
Request: { title: string }
Response: { id: string; title: string }
```

### 4. Technology Stack (≤1 page)
- Framework: [name + version]
- Database: [name] (if applicable)
- Key libraries: [list 3-5]
- Rationale: "As specified in PRD" OR "Chosen because [1 sentence]"

### 5. Non-Functional Requirements (≤1 page)
**(SKIP if PRD doesn't mention)**
- Performance targets
- Security approach
- Scalability plan

### 6. Testing & Quality (≤0.5 page)
- What to test (unit/integration/e2e)
- Key quality concerns

---

**SECTION LENGTH LIMITS** (strictly enforced):

| Section | Simple | Medium | Complex |
|---------|--------|--------|---------|
| Overview | 50 lines | 80 lines | 100 lines |
| Architecture | 100 lines | 150 lines | 250 lines |
| Design Decisions | 150 lines | 250 lines | 400 lines |
| Tech Stack | 50 lines | 80 lines | 100 lines |
| NFRs | 50 lines | 100 lines | 150 lines |

**IF YOU EXCEED THESE, YOU FAIL.**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IMPORTANT**: This document will be used by the code generation phase. 
Make it detailed, specific, and actionable. Include concrete examples where helpful.

Focus on the areas highlighted in your design strategy as most critical.

{{else}}

🚨 **CONTINUATION TASK - ADD YOUR CHAPTER ONLY** 🚨

**EXISTING DOCUMENT**:
```
{{designDoc}}
```

**YOUR TASK**: {{currentTask.name}}

**RULES**:
1. ❌ NO project analysis (already done)
2. ❌ NO repeating existing content
3. ✅ Write ONLY your assigned chapter
4. ✅ Use `<append>` tag (not `<file>`)
5. ✅ Start with chapter heading immediately

**Example**:
```xml
<append path="outputs/design/system-design.md">
## 3. Component Design

### 3.1 TaskManager
- Purpose: CRUD operations
- Interface: { getTasks(), addTask(), deleteTask() }
...
</append>
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{/unless}}
