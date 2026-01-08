## 🧭 Design Work Type + Domain + Environment Detection

You are analyzing a design task to determine:
1. **work type**: ui-design (generate UI specification documents) OR system-design (generate architecture documents)
2. **project domain** (only if system-design): game | service
3. **target environment** (only if system-design): frontend | backend | fullstack

**Environment Definitions:**
- **frontend**: Browser-based application (React, Vue, Next.js, Remix - SSR or CSR, NO separate backend server)
- **backend**: Server/API only (Express, NestJS, Fastify - NO frontend UI)
- **fullstack**: BOTH backend server AND frontend in the SAME project (monorepo or single repo with Express + React, etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🎯 Core Principle: Directive First, Then Completion Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Decision Priority:**
1. **Explicit directive** (highest) - If user clearly requests UI design or system design work, follow their intent
2. **Completion status** (medium) - If directive is ambiguous, check what documents are missing
3. **Available materials** (lowest) - Check references and assets availability

### Fundamental Rule

```
IF directive explicitly requests UI design work:
    → "ui-design" (user wants to work on visual/interface design)
    
ELSE IF directive explicitly requests system design work:
    → "system-design" (user wants to work on architecture/implementation planning)
    
ELSE IF directive is ambiguous (general planning/design terms):
    ↓ Check completion status:
    
    IF UI documents exist AND system documents missing:
        → "system-design" (UI phase complete, move to system phase)
        
    ELSE IF UI documents missing AND references available:
        → "ui-design" (visual materials available, generate UI docs first)
        
    ELSE IF UI documents missing AND no references:
        → "system-design" (cannot do UI design without visual materials)
        
    ELSE IF all documents exist:
        → "system-design" (default to system design for refinement)
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 📋 Document Completion Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{#if hasUiDocs}}
### ✅ UI Design Documents: COMPLETED

The following UI design documents already exist in `outputs/design/`:
{{#if hasUiTokens}}
- ✅ `ui-tokens.md` - Design tokens (colors, typography, spacing)
{{/if}}
{{#if hasUiAssets}}
- ✅ `ui-assets.md` - Asset mapping
{{/if}}
{{#if hasUiSpec}}
- ✅ `ui-spec.md` - UI specification
{{/if}}

**→ UI design work is COMPLETE. Do not regenerate UI documents.**

{{else}}
### ❌ UI Design Documents: NOT FOUND

No UI design documents exist in `outputs/design/`.
{{#if hasReferences}}
- Reference images ARE available → UI design is POSSIBLE
{{else}}
- Reference images NOT available → UI design is NOT possible
{{/if}}
{{/if}}

{{#if hasSystemDocs}}
### ✅ System Design Documents: COMPLETED

The following system design documents already exist in `outputs/design/`:
{{#if hasSystemDesign}}
- ✅ `system-design.md` - System architecture
{{/if}}
{{#if hasApiContract}}
- ✅ `api-contract.md` - API contracts
{{/if}}
{{#if hasFeSystemDesign}}
- ✅ `fe-system-design.md` - Frontend system design
{{/if}}
{{#if hasBeSystemDesign}}
- ✅ `be-system-design.md` - Backend system design
{{/if}}

**→ System design work is COMPLETE.**

{{else}}
### ❌ System Design Documents: NOT FOUND

No system design documents exist in `outputs/design/`.
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔎 Decision Logic (APPLY IN ORDER)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Priority 1: Check Directive Explicitness (HIGHEST PRIORITY)

**Analyze the directive to understand the user's intent. Focus on MEANING, not exact keywords.**

**UI Design Intent (visual/interface design work):**

*Core meaning*: User wants to work on **visual design, interface specifications, or frontend appearance**.

*Semantic indicators* (examples, not exhaustive):
- Terms related to visual design: UI, interface, screen, visual, layout, appearance, frontend design
- Design artifacts: design tokens, design system, UI specs, mockups, wireframes, prototypes
- Actions: designing screens, creating UI, styling, theming
- Modifications: updating UI docs, modifying design tokens, changing UI specs
- In any language: "UI 디자인", "화면 기획", "UI design", "interface design", "visual design", etc.

**Key principle**: If the directive semantically refers to **how things look or user-facing interfaces**, it's UI design work.

**System Design Intent (architecture/implementation planning):**

*Core meaning*: User wants to work on **technical architecture, system structure, or implementation planning**.

*Semantic indicators* (examples, not exhaustive):
- Terms related to architecture: system, architecture, backend, API, database, infrastructure
- Technical planning: implementation plan, system design, technical architecture, data model
- Actions: architecting system, planning backend, designing APIs, structuring code
- Modifications: updating system docs, modifying architecture, changing API contracts
- In any language: "시스템 디자인", "시스템 기획", "아키텍처", "system design", "architecture", etc.

**Key principle**: If the directive semantically refers to **technical structure, implementation, or how things work internally**, it's system design work.

**⚠️ CRITICAL: Modification Requests Require Existing Documents**

If directive indicates **modification/update** (e.g., "modify", "update", "change", "fix", "revise", "수정", "변경"):
  1. Identify the target: UI documents or System documents
  2. Check if target documents exist:
  
{{#if hasUiDocs}}
     - ✅ UI documents exist (ui-tokens.md, ui-assets.md, ui-spec.md)
       → UI modification is POSSIBLE
{{else}}
     - ❌ UI documents are missing
       → UI modification is IMPOSSIBLE
       → Return ERROR: "Cannot modify UI documents because they don't exist. Please create them first."
{{/if}}
    
{{#if hasSystemDocs}}
     - ✅ System documents exist (system-design.md, api-contract.md, etc.)
       → System modification is POSSIBLE
{{else}}
     - ❌ System documents are missing
       → System modification is IMPOSSIBLE
       → Return ERROR: "Cannot modify system documents because they don't exist. Please create them first."
{{/if}}

**Ambiguous/General Terms (proceed to Priority 2):**

If directive uses general planning terms without clear UI/system indication:
- General: "planning", "design", "start", "begin", "create", "기획", "설계", "시작"
- Vague: "do it", "proceed", "continue", "go ahead"
- No clear indication of UI vs system focus

→ These require checking completion status (Priority 2) to determine next phase.

{{#if directive}}
**Directive Analysis:**

Current directive: "{{directive}}"

**Your task:**
1. Understand the SEMANTIC INTENT, not just exact keywords
2. If directive clearly indicates UI design work (visual/interface focus) → `"ui-design"`
3. If directive clearly indicates system design work (architecture/technical focus) → `"system-design"`
4. If directive requests modification, check document existence first
5. If directive is ambiguous/general → Proceed to Priority 2 (check completion status)
{{/if}}

### Priority 2: Check Completion Status (MEDIUM PRIORITY)

**⚠️ Only apply this section if directive is AMBIGUOUS (no clear UI/system intent)**

Use completion status to determine the next logical phase:

{{#if hasUiDocs}}
{{#unless hasSystemDocs}}
**DECISION: Must choose `"system-design"`**

**Reasoning:**
- ✅ UI documents are complete (ui-tokens.md, ui-assets.md, ui-spec.md exist)
- ❌ System documents are missing (system-design.md, api-contract.md, etc. do not exist)
- 🎯 **Next phase**: Generate system design documents

**Even if directive is general** (e.g., "start planning", "begin design", "기획을 시작"), you MUST choose `"system-design"` because the UI phase is already complete. The natural progression is: UI design → System design → Implementation.

{{/unless}}
{{/if}}

{{#unless hasUiDocs}}
{{#if hasReferences}}
**CONSIDERATION: UI design is possible**

- ❌ UI documents are missing (ui-tokens.md, ui-assets.md, ui-spec.md)
- ✅ Reference images are available in `inputs/references/`
- 🤔 If directive is ambiguous, default to `"ui-design"` (create UI docs first before system design)

**Reasoning**: Visual materials are available, so it makes sense to document the UI design first before planning system architecture. This follows the natural design flow: Visual design → Technical architecture.

{{/if}}
{{/unless}}

{{#unless hasUiDocs}}
{{#unless hasReferences}}
**DECISION: Must choose `"system-design"`**

**Reasoning:**
- ❌ UI documents are missing
- ❌ Reference images are NOT available
- 🎯 **Cannot do UI design without visual materials**

UI design requires reference screenshots, mockups, or visual materials to extract design tokens, assets, and specifications. Without these materials, we must skip UI design and proceed directly to system design.

{{/unless}}
{{/unless}}

### Priority 3: Check Available Materials (LOWEST PRIORITY)

**⚠️ Only apply this section if BOTH directive is ambiguous AND completion status is unclear**

{{#if hasReferences}}
✅ **Reference images detected** (`inputs/references/`)
- Visual design materials ARE available
- This is a prerequisite for UI design work
{{else}}
❌ **No reference images detected**
- UI design work requires visual materials to analyze
- Without references, UI design is NOT possible
- **→ Must choose `"system-design"`**
{{/if}}

{{#if hasAssets}}
✅ **Asset files detected** (`inputs/assets/`)
- Runtime assets (logos, icons, images) ARE available
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ⚠️ Critical Decision Rules (Apply in Order)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Rule 1: Explicit Intent Overrides Everything (HIGHEST PRIORITY)

**Creation Requests:**

- **If directive SEMANTICALLY indicates UI design work** (visual/interface focus):
  → Choose `"ui-design"` (even if UI docs already exist - user wants to regenerate/modify)
  
  *Examples*: "design the UI", "create interface", "design screens", "UI 디자인해줘", "화면을 기획해줘"

- **If directive SEMANTICALLY indicates system design work** (architecture/technical focus):
  → Choose `"system-design"` (even if UI docs are missing - user explicitly wants architecture)
  
  *Examples*: "design the architecture", "plan the system", "시스템을 설계해줘", "아키텍처를 만들어줘"

**Modification Requests (CRITICAL - Check document existence):**

- **If directive requests UI modification** (e.g., "modify UI docs", "update design tokens", "UI 문서 수정"):
  - IF UI docs exist → Choose `"ui-design"`
  - IF UI docs missing → Return `"error"` with message explaining documents don't exist

- **If directive requests system modification** (e.g., "modify architecture", "update system docs", "시스템 문서 수정"):
  - IF system docs exist → Choose `"system-design"`
  - IF system docs missing → Return `"error"` with message explaining documents don't exist

### Rule 2: Ambiguous Directive → Check Completion Status

**Only apply if directive intent is unclear** (general terms like "start planning", "begin design", "기획해줘", "설계해줘"):

- **If UI docs exist + system docs missing:**
  → Choose `"system-design"` (UI phase complete, proceed to system phase)

- **If UI docs missing + references exist:**
  → Choose `"ui-design"` (visual materials available, document UI first)

- **If UI docs missing + no references:**
  → Choose `"system-design"` (cannot do UI design without visual materials)

- **If all docs exist:**
  → Choose `"system-design"` (default to system design for refinement)

### Rule 3: Edge Cases

- **If directive is completely unclear AND no context available:**
  → Default to `"system-design"` (safer default - can work without visual materials)

- **Key Principle**: When in doubt between UI and system design, prefer **semantic understanding of intent** over exact keyword matching. Consider synonyms, typos, and different phrasings in any language.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔎 Inputs for Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. Directive (user instruction)

```
{{directive}}
```

{{#if prdSpec}}
### 2. PRD (requirements document)

```
{{prdSpec}}
```
{{/if}}

{{#if referencesList}}
### 3. Available Reference Images

```
{{referencesList}}
```
{{/if}}

{{#if assetsList}}
### 4. Available Assets

```
{{assetsList}}
```
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 📤 Output Format
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CRITICAL: Respond using ONLY the JSON shape below, wrapped in `<detect>` tags. No markdown fences.**

### If workType is "ui-design":

```xml
<detect>
{
  "workType": "ui-design",
  "workTypeReasoning": "1-2 sentences explaining why this is UI design work"
}
</detect>
```

### If workType is "system-design":

```xml
<detect>
{
  "workType": "system-design",
  "workTypeReasoning": "1-2 sentences explaining why this is system design work",
  "domain": "game" | "service",
  "domainReasoning": "1-2 sentences explaining why (reference PRD/directive as evidence)",
  "environment": "frontend" | "backend" | "fullstack",
  "environmentReasoning": "1-2 sentences explaining why (reference PRD/directive as evidence)"
}
</detect>
```

### ⚠️ NEW: If modification requested but documents missing (ERROR case):

```xml
<detect>
{
  "workType": "error",
  "workTypeReasoning": "User requested to modify [UI/system] documents, but no such documents exist",
  "errorMessage": "Cannot modify [UI/system] documents because they don't exist",
  "errorType": "missing_documents",
  "suggestedAction": "Please create the documents first by requesting '[UI design/system design] creation'"
}
</detect>
```

**Error Response Examples:**

1. UI modification requested but UI docs missing:
```xml
<detect>
{
  "workType": "error",
  "workTypeReasoning": "User requested to modify UI documents (indicated by terms like 'modify', 'update', 'change' combined with UI-related terms), but ui-tokens.md, ui-assets.md, and ui-spec.md do not exist in outputs/design/",
  "errorMessage": "Cannot modify UI design documents because they don't exist. No ui-tokens.md, ui-assets.md, or ui-spec.md files were found.",
  "errorType": "missing_ui_documents",
  "suggestedAction": "Please first request UI design creation by saying something like: 'Create UI design' or 'Start UI design' or 'Generate UI specs'"
}
</detect>
```

2. System modification requested but system docs missing:
```xml
<detect>
{
  "workType": "error",
  "workTypeReasoning": "User requested to modify system design documents (indicated by terms like 'modify', 'update', 'change' combined with system/architecture terms), but system-design.md and related files do not exist in outputs/design/",
  "errorMessage": "Cannot modify system design documents because they don't exist. No system-design.md, api-contract.md, or related architecture files were found.",
  "errorType": "missing_system_documents",
  "suggestedAction": "Please first request system design creation by saying something like: 'Create system design' or 'Start architecture planning' or 'Generate system architecture'"
}
</detect>
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 📝 Decision Rules Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Work Type Decision Matrix

| Priority | Directive Intent | UI Docs | System Docs | References | → Decision |
|----------|-----------------|---------|-------------|------------|-----------|
| **1** | **UI design** (semantic) | Any | Any | Any | **ui-design** |
| **1** | **System design** (semantic) | Any | Any | Any | **system-design** |
| **1** | **UI modification** (semantic) | ❌ Missing | Any | Any | **error** |
| **1** | **System modification** (semantic) | Any | ❌ Missing | Any | **error** |
| 2 | Ambiguous/general | ✅ Exist | ❌ Missing | Any | **system-design** |
| 2 | Ambiguous/general | ❌ Missing | Any | ✅ Exist | **ui-design** |
| 2 | Ambiguous/general | ❌ Missing | Any | ❌ Missing | **system-design** |
| 3 | Unclear/none | Any | Any | Any | **system-design** (default) |

**Key Points:**
- **Priority 1**: Semantic intent (UI vs system focus, creation vs modification) **always wins**
- **Priority 2**: If intent is ambiguous (general planning terms), check completion status
- **Priority 3**: When everything is unclear, default to `"system-design"`
- **Critical**: Understand MEANING over exact keywords - consider synonyms, typos, different languages

**Work Type:**
- `"ui-design"`: 
  - Directive SEMANTICALLY indicates visual/interface design work, OR
  - Directive ambiguous + UI docs missing + references available
- `"system-design"`: 
  - Directive SEMANTICALLY indicates architecture/technical planning, OR
  - Directive ambiguous + UI docs exist, OR
  - Directive ambiguous + no references available, OR
  - Default fallback
- `"error"`:
  - Modification requested but target documents don't exist

**Domain (only for system-design):**
- `"game"`: Games or realtime/physics-based interactive applications
- `"service"`: Default for all other cases (web apps, APIs, dashboards, etc.)

**Environment (only for system-design):**
- `"frontend"`: Browser/UI-only app calling existing external APIs
- `"backend"`: API/service-only, no UI
- `"fullstack"`: Both frontend UI and backend implementation required
