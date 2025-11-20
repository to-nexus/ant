════════════════════════════════════════════════════════════════════════════════
🚨 CRITICAL: READ THIS FIRST - YOUR OUTPUT WILL BE REJECTED IF TOO LONG! 🚨
════════════════════════════════════════════════════════════════════════════════

You are creating a **EXTREMELY CONCISE** SYSTEM DESIGN DOCUMENT for: **{{project}}**

**ABSOLUTE LENGTH LIMITS** (if you exceed these, your output is REJECTED):

| Project Type | TOTAL Document MAX | Per-Chapter MAX |
|-------------|-------------------|-----------------|
| **Simple** (todo, counter) | **150 lines** | **30 lines** |
| **Medium** (blog, landing) | **300 lines** | **60 lines** |
| **Complex** (SaaS, marketplace) | **600 lines** | **120 lines** |

**EXAMPLE OF ACCEPTABLE LENGTH:**
```
Simple Todo App Design Document:
## 1. Architecture (25 lines)
- Pattern: MVC (1 line)
- Components: Model, View, Controller (3 lines)
- Tech: React + Context API (2 lines)
- ... (concise descriptions)

## 2. Data Models (30 lines)
- Todo interface (5 lines)
- State structure (5 lines)
- ... (brief definitions)

## 3. Implementation (40 lines)
- Component list (10 lines)
- API methods (10 lines)
- ... (signatures only)

TOTAL: ~95 lines ✅
```

**EXAMPLE OF UNACCEPTABLE LENGTH:**
```
❌ "Let me explain React Context in detail..." (tutorial mode)
❌ "First, we need to understand..." (verbose explanations)
❌ Code examples > 5 lines
❌ Detailed implementation guides
❌ Step-by-step tutorials
```

════════════════════════════════════════════════════════════════════════════════

🚨 **COUNTING RULE: COUNT EVERY LINE YOU WRITE** 🚨

**How to count:**
1. Every line of markdown = 1 line
2. Empty lines = 1 line
3. Code blocks count EVERY line inside
4. Headers count as 1 line each

**While writing:**
- After each section, COUNT: "I've written X lines so far"
- If approaching limit, STOP IMMEDIATELY
- Better to be incomplete than exceed limit!

**IF YOUR TASK SAYS "MAX 60 lines":**
- Write 50-60 lines MAX
- Do NOT write 61 lines
- Do NOT think "just a bit more is okay"
- STOP AT 60 LINES!

════════════════════════════════════════════════════════════════════════════════

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

🚨 **ABSOLUTE RULE #3: EXTREME CONCISENESS REQUIRED** 🚨

**Writing Rules:**
1. **1 sentence per point** - NO paragraphs!
2. **No tutorials** - Design decisions only, not explanations
3. **No code examples > 5 lines** - Signatures only
4. **Bullet points over prose** - Lists are shorter

**GOOD Examples (concise):**
```
✅ Architecture: Layered (Presentation/Domain/Infrastructure)
✅ State: React Context API
✅ Routing: React Router v6
✅ Components: Button, Card, Input (see ch.3)
```

**BAD Examples (too verbose):**
```
❌ "The architecture follows a layered pattern which separates concerns into three distinct layers. The presentation layer handles UI rendering, the domain layer manages business logic, and the infrastructure layer deals with external dependencies. This approach provides better maintainability and testability."

❌ "For state management, we will use React Context API. React Context is a built-in React feature that allows you to share data across the component tree without prop drilling. It's simpler than Redux for our use case..."

THESE ARE TUTORIALS, NOT DESIGN!
```

**Target length for each sentence:**
- ✅ 5-15 words per sentence
- ❌ NOT 30-50 words per sentence

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

**⚠️ LENGTH TRACKING (CRITICAL!):**
- **Existing document**: Count the lines above (estimate ~{{designDocLines}} lines)
- **Your task budget**: Extract from your task description (e.g., "MAX 600 lines")
- **TOTAL after your addition**: Existing + Your Addition MUST NOT exceed project limit!
- **Example**: If existing is 1200 lines and your budget is 600 lines, you can add UP TO 600 lines (but check total doesn't exceed 3000!)

**YOU MUST**:
1. Generate ONLY the new/modified sections relevant to your current task
2. DO NOT regenerate existing sections that don't need changes
3. Clearly mark which sections you're adding/updating with headers
4. **STOP WRITING when you hit your task's line budget!**

**Example Format**:
```markdown
## 3. Detailed Design

### 3.2 Data Models (UPDATED)

[Your new/updated content here - only this section]

### 3.5 Security Considerations (NEW)

[Your new section here]
```

**BEFORE YOU START WRITING:**
- Count existing lines (roughly): {{designDocLines}} lines
- Check your task budget from description
- Plan your sections to fit within budget
- Write concisely to stay under limit!

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
| Overview | 10 lines | 20 lines | 40 lines |
| Architecture | 20 lines | 40 lines | 80 lines |
| Design Decisions | 30 lines | 60 lines | 120 lines |
| Tech Stack | 15 lines | 30 lines | 60 lines |
| Components | 40 lines | 80 lines | 160 lines |
| Data Models | 20 lines | 40 lines | 80 lines |
| NFRs | 15 lines | 30 lines | 60 lines |

**CRITICAL CALCULATION:**
- Count TOTAL lines from ALL chapters
- Simple: **150 lines MAX** (all chapters combined)
- Medium: **300 lines MAX** (all chapters combined)
- Complex: **600 lines MAX** (all chapters combined)

**IF YOU'RE WRITING A CONTINUATION TASK:**
- Existing doc: {{designDocLines}} lines
- Your budget: [from task description] lines
- TOTAL MUST NOT EXCEED project limit!
- Example: Existing 150 lines + Your 150 lines = 300 lines (Medium project OK)
- Example: Existing 200 lines + Your 150 lines = 350 lines (Medium project FAIL!)

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
