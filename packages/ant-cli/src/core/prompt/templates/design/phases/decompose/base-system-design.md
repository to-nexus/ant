# System Design Task Decomposition

You are analyzing requirements to break them into design tasks.

**Job Mode**: {{jobMode}}

{{#if (eq jobMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REFACTOR MODE - Modify Existing Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are modifying EXISTING system design documents.**

{{#if existingDesignFiles}}
### 📁 Existing Design Files
{{#each existingDesignFiles}}
- `{{this}}`
{{/each}}

**⚠️ CRITICAL: `targetFiles` and `targetFile` MUST use the EXACT filename from the list above.**
**Do NOT invent new filenames. Do NOT use `system-design.md` if it does not exist above.**
{{/if}}

**Philosophy**: Create a SINGLE focused task that modifies the specific section/part requested.

### Rules for Refactor Mode

1. **Create ONE task** - Do NOT create multiple chapter-based tasks
2. **Focus on the specific change** - Only modify what was requested
3. **Preserve existing content** - Do NOT regenerate entire documents
4. **Use descriptive task ID** - e.g., "modify-api-users", "modify-schema-orders"
5. **Use EXACT existing filename** - `targetFile` must match an existing document filename

### Task Output Format (Refactor Mode)

```json
{
  "documentType": "unified",
  "jobMode": "refactor",
  "targetFiles": ["{{primaryDesignFile}}"],
  "tasks": [
    {
      "id": "refactor-{section}",
      "name": "Refactor: {brief description}",
      "targetFile": "{{primaryDesignFile}}",
      "description": "{modification scope}. Keep all other content unchanged.",
      "priority": 200
    }
  ]
}
```

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE - Create New Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW system design documents from scratch.**
{{/if}}

---

## 📥 INPUT CONTEXT

### Requirements

{{spec}}

{{#if hasExistingDesign}}
### 📄 Existing Design Detected

Previous design:
{{designPreview}}
{{else}}
### 🆕 New Design (no previous design)
{{/if}}

---

## 📊 PROJECT SCOPE ANALYSIS

**Analyze requirements complexity before breaking down tasks.**

### Step 1: Complexity Questions

1. **Backend Complexity**: Does it need a backend? Database? How many tables/entities?
2. **Feature Count**: How many distinct user-facing features?
3. **Pages/Views**: How many different screens/pages?
4. **External Systems**: Does it integrate with external APIs, payment, auth services?
5. **User Roles**: Multiple user types with different permissions?

### Step 1.5: Backend/Fullstack Complexity Indicators

**Observe PRD for these patterns to determine Score in Step 2.**

| Category | Observe for Score |
|----------|------------------|
| **Communication** | Realtime (WebSocket/SSE)? Async jobs/queues? |
| **Storage** | Multiple DB types needed (RDB + Cache/NoSQL)? |
| **Scale** | Horizontal scaling mentioned? Stateful connections? |
| **Architecture** | Multiple independent domains? Service separation? |

**Note**: Detailed design guidance for these patterns is provided in document-specific guides (api-contract-guide, backend-guide) during DocGen phase.

### Step 2: Score the Project

| Condition | Score |
|-----------|-------|
| ❌ NO backend | → Simple (STOP counting) |
| Backend with 1-3 tables | +1 |
| Backend with 4+ tables | +2 |
| Multiple user roles/auth | +1 |
| 5+ distinct features | +1 |
| External integrations | +1 |
| Multiple pages (5+) | +1 |
| Realtime/WebSocket/SSE needed | +1 |
| Message queue/async processing needed | +1 |
| Multiple databases (RDB + NoSQL/Cache) | +1 |

### Step 3: Determine Budget

| Score | Complexity | Total Lines | Tasks |
|-------|------------|-------------|-------|
| 0 | Simple | 100-150 | 2 tasks |
| 1-2 | Medium | 180-300 | 3 tasks |
| 3+ | Complex | 360-600 | 4 tasks |

### Step 4: Divide Budget

- Divide total budget by number of tasks
- Each task description MUST include its line budget

---

## 🎯 WHAT SYSTEM DESIGN SHOULD COVER

**Focus on architecture, NOT implementation.**

### ✅ INCLUDE

- **Component boundaries and responsibilities** (WHAT each does, WHY it exists)
- **Interface definitions** (WHAT data flows, not HOW it's processed)
- **Abstraction layers** (WHY separated, WHAT each layer owns)
- **Interaction patterns** (call sequence, data flow direction)
- **Design rationale** (WHY this architecture vs alternatives)

### ❌ EXCLUDE

- Specific algorithms, formulas, calculation steps
- Exact parameter values (timeouts, coefficients, thresholds)
- Library/framework usage details (API calls, syntax)
- Performance optimization tricks
- Storage implementation details (key names, serialization format)

---

## 🔀 CONTRACT-FIRST DETECTION

### Principle

Separate API interface specification from implementation architecture when the project exposes APIs consumed by external clients.

### Observation Target

Observe whether the project defines API boundaries consumed by external parties:

| Observation | Document Structure |
|-------------|-------------------|
| Project has **both frontend and backend** | `contract-first` (api-contract + fe + be) |
| Project is **backend-only** and exposes external API | `contract-first` without FE (api-contract + be) |
| Project is **frontend-only** | `unified` (`fe-system-design.md`) |

### Decision

**IF fullstack → CONTRACT-FIRST** (`api-contract.md` + `fe-system-design.md` + `be-system-design.md`)
**IF backend with external API → CONTRACT-FIRST without FE** (`api-contract.md` + `be-system-design.md`)
**IF frontend-only → UNIFIED** (`fe-system-design.md`)

---

## 🏗️ MSA / SERVICE-ORIENTED DETECTION

**After CONTRACT-FIRST detection, check if backend requires service separation.**

### Observation Checklist

| Checkpoint | Observation Target |
|------------|-------------------|
| **Domain Boundaries** | Multiple independent business domains with separate data ownership? |
| **Deployment Independence** | PRD indicates services need independent deployment or scaling? |
| **Team Boundaries** | Different domains owned by different teams? |
| **Service Communication** | PRD specifies inter-service communication (sync API or async events)? |

### Decision Principle

| Observation Result | Document Structure |
|-------------------|-------------------|
| Single backend domain | `contract-first` |
| **Multiple independent service boundaries** | `msa-contract-first` |

**Constraint**: Do NOT assume MSA. Only choose `msa-contract-first` if PRD explicitly indicates service boundaries.

### If MSA Detected

**⚠️ MUST extract from PRD:**

1. **Service names** - exact names as PRD specifies (do NOT invent)
2. **Service responsibilities** - what each service owns
3. **Communication patterns** - sync (HTTP/gRPC) vs async (events/messages)

**Output structure for MSA:**
```json
{
  "documentType": "msa-contract-first",
  "services": ["<service1>", "<service2>", ...],
  "targetFiles": [
    "api-contract.md",
    "fe-system-design.md",
    "be-system-design-<service1>.md",
    "be-system-design-<service2>.md"
  ]
}
```

---

{{> design/phases/decompose/rules-system-design}}
