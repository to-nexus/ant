## ExecutionTier Classification

**Authoring target**: The breadth of UI documentation implied by the directive, the mode, and the source documents supplied in this prompt.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only explanation; no UI document produced. |
| `1` | OneShot       | Single concrete edit to one existing UI document (e.g. a targeted token or asset change). |
| `2` | Exploratory   | Must consult sources before choosing what to document; still a single cohesive edit. |
| `3` | Task          | Multiple chapters of UI documentation driven by the directive alone. |
| `4` | RefsGrounded  | Multiple chapters systematically grounded in PRD / source documents supplied in this prompt. |

**Constraint**: Emit exactly one `<executionTier>N</executionTier>` tag BEFORE the JSON output. `N` is a single digit `0`–`4`.

⚠️ **Blind spot**: When the PRD / source documents are the source of truth for the breakdown, the tier is `4`, NOT `3`. Tier 4 applies when the documentation is produced BY mapping those source documents.

---

## 📋 CRITICAL RULES

### 1. Token Limit Safety (MOST IMPORTANT)

- **Claude Sonnet max output: 8,192 tokens**
- **~600 lines = ~7,200 tokens** (safe threshold)
- **Each TASK output must stay under 600 lines**
- Split into chapters if ANY document exceeds this

### 2. Chapter-Based = Sequential Append

- `ui-tokens-ch1` → writes to **ui-tokens.json**
- `ui-tokens-ch2` → **appends** to **ui-tokens.json**
- All chapters of same document share same `targetFile`

### 3. Line Budget Guidelines

**Each chapter ≤ 400 lines** (safe margin for ~8K token limit)

Adjust chapter count based on expected content:
- Simple content → fewer chapters
- Complex content → more chapters

### 4. Dependencies

- ui-tokens and ui-assets are independent (run in parallel)
- ui-spec chapters depend on ALL ui-tokens + ui-assets chapters
- Chapters within same document are sequential (ch2 after ch1)

### 5. Priority Ranges

| Document | Priority Range |
|----------|----------------|
| ui-tokens | 100-149 |
| ui-assets | 200-249 |
| ui-spec | 300-349 |

### 6. Source File Assignment

{{#if sourceFileNames}}
Each task MUST include `sourceFiles` — an array of source filenames that the task needs to reference.

- A task MAY reference 1 or more files depending on its scope
- Note each file's relevance to the task's domain concepts, not just its target document
- **Constraint**: Do NOT omit a file that contains requirements relevant to the task scope
- ⚠️ **Blind spot**: Foundational context files (domain glossaries, shared models) are relevant to tasks that reference those domain concepts — do NOT skip them because they lack a direct section mapping
{{/if}}

### 7. Overlap Prevention (MECE Principle)

**CONSTRAINT**: Each topic/component/behavior MUST be assigned to exactly ONE chapter.

- ch1 defines ONLY document structure and layout primitives (breakpoints, grid, containers)
- ch1 does NOT define component behavior, interaction patterns, toast systems, or accessibility
- ch2+ page chapters each own ALL specs for that page including its interactions and states
- Cross-cutting concerns (accessibility, toast, animations, keyboard navigation) belong ONLY to the shared components chapter
- Do NOT create a separate "interactions + accessibility" chapter
- If a behavior is used in only ONE page, it belongs to that page's chapter
- If a behavior is used across MULTIPLE pages, it belongs to the shared components chapter
- Shared chapter description MUST list component IDs it will define: `Components: <id1>, <id2>, ...` — these become JSON keys
- Each page chapter description MUST repeat the shared component list: `Shared components [<id1>, <id2>, ...]: reference by componentRef only`

### 8. PRD Hand-off Citation (when PRD is in source documents)

When the PRD provides `SC-XXX` identifiers in §5 IA / §6 Screen Composition, the page chapter list MUST be derived from those IDs:

- One page chapter per `SC-XXX` from PRD §5 — task ID format `ui-spec-SC-<Name>` (e.g., `ui-spec-SC-Search`, `ui-spec-SC-ProductDetail`)
- Each page chapter description MUST cite the PRD section it implements: `Implements PRD §6 / SC-<Name>` (and any `PRD §7 / CP-XXX` content policies that apply only to this page)
- Shared chapter description MUST cite cross-screen `PRD §6` patterns and `PRD §7 / CP-XXX` policies that span 2+ `SC-XXX`
- A page chapter that does not cite a `SC-` ID is a duplication risk — design is creating shadow page IDs that diverge from the PRD's IA. When the PRD does not surface `SC-` IDs (legacy mode), state `PRD lacks SC- IDs — page list extracted from prose` in the description so the gap is visible.

### 9. ui-assets.json Path Consistency (CRITICAL!)

**When creating ui-assets tasks:**

**ui-assets-ch1 description MUST include:**
- "Include `_meta.pathPattern` in JSON output mapping each asset category to its destination directory (e.g., `{ \"_meta\": { \"pathPattern\": { \"icons\": \"src/assets/icons/\", \"images\": \"public/images/\" } } }`)"

**ui-assets-ch2+ descriptions MUST include:**
- "Read existing ui-assets.json to extract `_meta.pathPattern` — follow those destination paths exactly, do NOT create new subdirectories"
- "Skip any assets already documented in ch1"

**Why?** Without `_meta.pathPattern`, ch2 may create inconsistent destination paths. The system reads `_meta.pathPattern` from JSON to inject path context into subsequent chapters.

---

## 🚫 FORBIDDEN TASKS

DO NOT CREATE:
- ❌ "Final verification" or "review" tasks
- ❌ Deployment / Operations / Infrastructure tasks
- ❌ Separate documents per chapter (all chapters → same file)
{{#if (eq detectedMode "refactor")}}
- ❌ Multiple chapter-based tasks (refactor mode = single focused task)
- ❌ Full document regeneration (only modify requested section)
{{/if}}

---

{{#if (eq detectedMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

**Principle**: Single focused task for modification. No multi-chapter decomposition.

Emit the meta tags first, then a `<tasks>` block with **one** `<task>{json}</task>` element. Each `<task>` body is a single JSON object. NO markdown fences anywhere. NO `<decompose>` wrapper.

Example:

```
<executionTier>1</executionTier>
<jobMode>refactor</jobMode>
<targetFiles>["{target}.json"]</targetFiles>
<tasks>
  <task>{"id":"refactor-{document}-{section}","name":"Refactor: {brief description}","targetFile":"{target}.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"{modification scope}. Keep all other content unchanged.","priority":300,"parallelGroup":"refactor-{document}-{section}"}</task>
</tasks>
```

### Constraints

| Constraint | Requirement |
|------------|-------------|
| Task count | Exactly ONE |
| ID format | `refactor-{document}-{section}` |
| Name format | `Refactor: {description}` |
| Description | Must include "Keep all other content unchanged" |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

Emit the meta tags first, then a `<tasks>` block with one `<task>{json}</task>` element per task. Each `<task>` body is a single JSON object. NO markdown fences anywhere. NO `<decompose>` wrapper.

Example:

```
<executionTier>4</executionTier>
<targetFiles>["ui-tokens.json", "ui-assets.json", "ui-spec.json"]</targetFiles>
<tasks>
  <task>{"id":"ui-tokens-ch1","name":"Design Tokens: Colors","targetFile":"ui-tokens.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Color palette and backgrounds in JSON format.","priority":100,"parallelGroup":"ui-tokens-ch1"}</task>
  <task>{"id":"ui-spec-ch1","name":"UI Spec: Global Settings","targetFile":"ui-spec.json"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Establish outline, breakpoints, layout rules in JSON format.","priority":300,"parallelGroup":"ui-spec-ch1"}</task>
</tasks>
```

### targetFiles Selection

| Scenario | targetFiles |
|----------|-------------|
| Full generation | `["ui-tokens.json", "ui-assets.json", "ui-spec.json"]` |
| Spec only (tokens/assets exist) | `["ui-spec.json"]` |
| Tokens only | `["ui-tokens.json"]` |
| Assets only | `["ui-assets.json"]` |

**Rule**: Only include documents that will be generated. Tasks MUST match targetFiles.

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique (e.g., "ui-tokens", "ui-spec-ch2") |
| name | Descriptive (e.g., "Design Tokens: Colors") |
| targetFile | MUST be in targetFiles array |
| description | Clear scope of what to document |
| priority | See priority ranges above |
| parallelGroup | Group ID for parallel scheduling (see rules below) |

### Parallel Execution Hints

Add `"parallelGroup"` to every task.

- `ui-tokens.json` chapters → use task ID as group (e.g., `"ui-tokens-ch1"`, `"ui-tokens-ch2"`) — enables parallel execution
- `ui-assets.json` chapters → shared group `"ui-assets"` — keeps sequential (category conflict risk)
- `ui-spec.json` chapters → use task ID as group (e.g., `"ui-spec-ch1"`, `"ui-spec-ch2"`) — enables parallel execution

The system uses per-file mutex + deep merge for concurrent writes. Cross-document ordering: tokens and assets run in parallel; spec waits for both via priority barrier.

---

## 📋 TASK DESCRIPTION GUIDELINES

### ui-spec-ch1 (Critical)

**MUST include in description:**
- "Global settings: breakpoints, grid, containers"
- "NO component specs"

### ch2+ (Page/Shared)

No required text indicators. `forceAppend` flag (auto-injected by the
decompose post-processor for every ch2+ task) and
`previousChaptersSummary` (auto-derived from the current target file)
together surface continuation context to the execute prompt — adding
duplicate signals into the description body is forbidden because the
keyword can be misread as a tool name (e.g., LLM hallucinated an
`append` tool call in incident `tall-ending-bluff`).

---

## ✅ VALIDATION CHECKLIST (GENERATE MODE)

Before outputting, verify:

### Output Structure
- ✅ `<executionTier>` tag emitted FIRST, BEFORE any other meta tag
- ✅ `<targetFiles>` body is a JSON-encoded array of filenames
- ✅ One `<task>{json}</task>` element per task inside `<tasks>...</tasks>`
- ✅ NO markdown fences anywhere in the output
- ✅ NO `<decompose>` wrapper

### JSON Structure (per `<task>` body)
- ✅ Valid JSON syntax
- ✅ Every task's `targetFile` is in the `<targetFiles>` array
- ✅ All fields present (id, name, targetFile, description, priority, parallelGroup)
- ✅ Priority in correct range (100-149, 200-249, 300-349)
- ✅ No forbidden tasks (verification, deployment, operations)
- ✅ Every task has `parallelGroup` (task ID for tokens/spec, shared basename for assets)

### Chapter Count
- ✅ At least 2 chapters for ui-spec (ch1 = global settings, ch2+ = page/shared content)
- ✅ Chapter count reflects complexity (more content → more chapters)

### Task Descriptions
- ✅ **ui-spec-ch1 description includes "global settings" or "breakpoints"**
- ✅ **ch2+ descriptions do NOT carry text indicators for continuation** — `forceAppend` flag is the SSOT
- ✅ **When PRD source contains `SC-` IDs**: each page chapter description cites `PRD §6 / SC-<name>` and the page chapter task ID embeds `SC-<name>`

---

## 🎨 VISUAL DESIGN POLICY DETECTION

After the main JSON output, output a `<visualTier>` tag with auto-detected visual design policy.

{{> jobs/shared/injections/visual-tier-detection}}
{{/if}}
