## 🧭 Design Work Type + Domain + Environment Detection

You are analyzing a design task to determine:
1. **work type**: ui-design (generate UI specification documents) OR system-design (generate architecture documents)
2. **project domain** (only if system-design): game | service
3. **target environment** (only if system-design): frontend | backend | fullstack

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔎 Work Type Classification (FIRST PRIORITY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Core Principle

**UI Design** and **System Design** are fundamentally different tasks:

| Aspect | UI Design | System Design |
|--------|-----------|---------------|
| **Input** | Visual materials (Figma, screenshots, mockups) | Requirements (PRD, user stories) |
| **Output** | Design tokens, asset maps, UI specifications | Architecture docs, API contracts |
| **Purpose** | Document **what exists visually** | Design **how to build** something |

### Decision Logic

**Step 1: Check for visual materials**

{{#if hasReferences}}
✅ **Reference images detected** (`inputs/references/`)
- Visual design materials ARE available
- This is a prerequisite for UI design work
{{else}}
❌ **No reference images detected**
- UI design work requires visual materials to analyze
- Without references, UI design is NOT possible
{{/if}}

{{#if hasAssets}}
✅ **Asset files detected** (`inputs/assets/`)
- Runtime assets (logos, icons, images) ARE available
{{/if}}

**Step 2: Analyze directive intent**

Read the directive and determine what the user wants:

- Does it mention **UI**, **design**, **visual**, **Figma**, **screenshot**, **token**, **spec**, **asset**?
  → If YES and reference images exist → `"ui-design"`
  
- Does it mention **architecture**, **system**, **API**, **backend**, **database**, **implement**, **build**?
  → `"system-design"`

**Step 3: Apply the rule**

```
IF (reference images exist) AND (directive is about UI/design/visual work):
    → "ui-design"
ELSE:
    → "system-design"
```

{{#if hasReferences}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ⚠️ IMPORTANT: References Detected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Since `inputs/references/` contains visual materials, you should carefully consider if this is UI design work.

**Choose `"ui-design"` if the directive:**
- Mentions "UI", "design", "visual", or related terms
- Is general/short (e.g., "start", "begin", "do it", "proceed")
- Does NOT explicitly mention system architecture or implementation

**Choose `"system-design"` only if the directive:**
- Explicitly asks for architecture/system design
- Mentions backend, API, database, implementation details
- Clearly wants to BUILD something, not document visuals
{{/if}}

{{#unless hasReferences}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ℹ️ No Visual References Available
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Without reference images in `inputs/references/`, UI design work is not possible.
Default to `"system-design"`.
{{/unless}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔎 Inputs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. Directive (user instruction)

{{directive}}

{{#if prdSpec}}
### 2. PRD (requirements document)

{{prdSpec}}
{{/if}}

{{#if referencesList}}
### 3. Available Reference Images

{{referencesList}}
{{/if}}

{{#if assetsList}}
### 4. Available Assets

{{assetsList}}
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Decision Rules Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Work Type:**
- `"ui-design"`: Reference images exist AND directive relates to UI/design/visual work
- `"system-design"`: All other cases (default)

**Domain (only for system-design):**
- `"game"`: Games or realtime/physics-based interactive applications
- `"service"`: Default for all other cases (web apps, APIs, dashboards, etc.)

**Environment (only for system-design):**
- `"frontend"`: Browser/UI-only app calling existing external APIs
- `"backend"`: API/service-only, no UI
- `"fullstack"`: Both frontend UI and backend implementation required
