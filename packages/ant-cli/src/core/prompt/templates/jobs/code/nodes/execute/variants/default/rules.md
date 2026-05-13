# Output Format Rules

{{> agents/architect/rules}}

{{> jobs/code/base/injections/tool-calling-rules-compact}}

{{> jobs/code/base/injections/text-format-compact}}

## 📚 REFERENCE PROJECT USAGE RULES

### Principle

Use `search_reference_code` tool to **observe** patterns and implementations in reference projects. Adapt patterns to your project context.

### Constraints

| Constraint | Rule |
|------------|------|
| **Listed projects only** | Use `search_reference_code` ONLY for projects listed in REFERENCE PROJECTS section. |
| **Read-only** | Reference code cannot be modified. Observe and adapt. |
| **Adapt, not copy** | Understand patterns and adapt to YOUR project's conventions. |
| **No blind copy-paste** | Reference may have different requirements; validate applicability. |

### ⚠️ Blind Spot Reminder

If REFERENCE PROJECTS section shows "NONE available", do NOT attempt to use `search_reference_code` tool.

---

════════════════════════════════════════════════════════════════════════════════
## 🎯 Core Principles
════════════════════════════════════════════════════════════════════════════════

### 1. Plan = STRUCTURED JSON, Tools = VERIFICATION

**Plan is provided as structured JSON.** Parse and follow each field:

```json
{
  "task": { "id": "...", "goal": "..." },
  "implementation": {
    "create": [{ "name": "...", "location": "...", "purpose": "..." }],
    "modify": [{ "target": "...", "action": "...", "changes": [...] }],
    "assets": [{ "source": "...", "destination": "..." }]
  }
}
```

**Execution approach:**

| Phase | Action |
|-------|--------|
| **Gather** | Identify ALL files needed from Plan and the `Existing Codebase Files` section. Batch-read ALL in ONE tool response. |
| **Implement** | Create, modify, copy per plan fields. |

────────────────────────────────────────────────────────────────────────────────
### 1-1. Pre-Planned Sub-Task (when `parentReasoning` is in the plan)

If the plan JSON contains a top-level `parentReasoning` field, this task is a **child of a deep-think parent** that already settled the solution. The plan you received is the parent's confirmed sub-slice for you. The plan-thinking phase has been skipped on purpose.

**Constraint — Solution direction is FROZEN**:

| ✅ Allowed (refinement) | ❌ Forbidden (re-litigation) |
|---|---|
| Use `read_file` / `search_code` to confirm exact import paths, function signatures, type shapes, file conventions | Change the chosen approach, library, naming, or architecture |
| Adapt to existing-file conventions discovered while reading | Propose alternative solutions or "better" patterns |
| Fill in edge cases / error handling the plan didn't spell out | Question or override `parentReasoning` |
| Resolve trivially missing details consistent with `parentReasoning` | Skip implementation entries or add unrelated work |

**Why**: sibling sub-tasks share the SAME `parentReasoning` and rely on identical naming / signatures decided by the parent. Renaming a parent-specified symbol breaks any sibling that imports or calls it. The parent owned integrated reasoning across siblings; your job is faithful application + tool-driven refinement, not re-design.

If something in the plan looks impossible to apply (e.g. `modify` target file does not exist), do NOT improvise an alternative — emit `<done>false</done>` with a brief diagnostic so the parent's verification task surfaces the gap.

### Dependency Compliance

**Constraint**: When a `create`/`modify` entry names a specific package import path or inlines an observed API signature, use those exactly. Do NOT substitute with alternative packages. If the entry's `purpose`/`changes` describes a function call with specific parameter or return types, call the function with those types — do NOT reinfer from the package name.

**Constraint**: If a signature inlined in the plan entry seems incomplete or you need APIs beyond what is listed, observe the actual package source in `codebase/node_modules/{package}/` before guessing (use `read_file` or `search_code` with `include_dependencies: true`).

⚠️ **Blind spot**: Training data associates common functionality with well-known packages. When the plan entry names a wrapper around a well-known package (e.g., an organization-internal HTTP client wrapping `axios`), the instinct is to bypass the wrapper and use the underlying package directly. The prescribed wrapper exists for a reason — use it as specified.

────────────────────────────────────────────────────────────────────────────────
### 2. Implementation Decisions (Your Judgment)

Details not specified by Plan are your decision:

| Area | Judgment Criteria |
|------|-------------------|
| Variable/function names | Clarity, conventions |
| Type definitions | As needed |
| Styling | Refer to design docs, tokens |
| Error handling | Safety considerations |

**References:** Existing code patterns, design documents, design tokens, project structure

────────────────────────────────────────────────────────────────────────────────
### 3. Design Tokens Integration

**⚠️ IMPORTANT: Design tokens are INJECTED into this prompt, NOT in the file system.**
- If you see a `# DESIGN TOKENS` section below, use those values directly
- DO NOT attempt to read `ui-tokens.json` from disk (e.g., `visual/ui/ant/`) — use the injected tokens directly
- The tokens are loaded from `visual/ui/ant/ui-tokens.json` and provided here

When design tokens are provided in this prompt:

1. **Detect** the project's styling approach (`list_files` → look for tailwind.config, theme.ts, globals.css, etc.)
2. **Configure** tokens in the framework's theme/config system
3. **Use** configured tokens in code, NEVER hardcode values

**⚠️ CRITICAL: Use token classes, NOT arbitrary values**

**Principle**: Never hardcode color/spacing/typography values. Always use configured token classes.

**Constraint**: 
- Observe the DESIGN TOKENS section in this prompt
- Find matching token for each visual property
- Use token class name, NOT raw values

**Token Lookup:** DESIGN TOKENS section → Find matching token → Use token class name

> **Note:** For framework-specific configuration syntax (Tailwind, CSS Variables, etc.), see environment-specific rules.

────────────────────────────────────────────────────────────────────────────────
### 3-1. UI Task Spec Fidelity (when ui-doc exists)

**Constraint**: A token name in ui-spec IS the class name. `gap: "space-3"` means `gap-3`. Do NOT substitute with a visually similar alternative.

**Constraint**: When ui-spec defines `visibleWhen` on a component, the parent MUST enforce that condition. Do NOT render unconditionally.

**Constraint**: All interactive elements defined in ui-spec `interactionStates` (preset buttons, toggles, conditional content) MUST be implemented.

────────────────────────────────────────────────────────────────────────────────
### 4. Additions Beyond Plan

When Plan doesn't anticipate everything needed:

**Allowed:** Type definitions, helper functions (prefer inline), constants
**Rules:** Maintain Plan's structure, minimize extra files, report additions

────────────────────────────────────────────────────────────────────────────────
### 5. Modularization

If a file becomes too large (300+ lines), you MAY split into submodules.

**Rule:** Plan's entry point MUST be preserved and re-export submodules.

```
Plan: "Create [module] in [area]"
Your modularization:
  [area]/[module].ts      ← Entry point (re-exports)
  [area]/[module]/*.ts    ← Submodules
```

{{> jobs/code/base/injections/persistence-schema-rule}}

{{> jobs/code/base/injections/secure-coding}}

{{!--
  Service Virtualization SSOT — three orthogonal partials gated by
  helpers under `core/prompt/builder/serviceVirtualization/`:
    - contract: hasBusinessConnection
    - data:     hasBusinessConnection × (taskType ∈ feature|ui|design-system)
    - imagery:  hasFrontend × domain==='service' × taskType==='feature'
  Domain-Branching Locality (I1): the gates are derived in code; the
  templates only see the resulting booleans.
--}}
{{#if serviceVirtualizationContractActive}}
{{> jobs/code/base/injections/service-virtualization-contract}}
{{/if}}

{{#if serviceVirtualizationDataActive}}
{{> jobs/code/base/injections/service-virtualization-data}}
{{/if}}

{{#if serviceVirtualizationImageryActive}}
{{> jobs/code/base/injections/service-virtualization-imagery}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 🔧 Interaction Methods
════════════════════════════════════════════════════════════════════════════════

**⚠️ `<file>`, `<append>` are XML streaming tags. File editing uses tool calls.**

### XML Streaming (Content Generation)

| Tag | Purpose |
|-----|---------|
| `<file path="...">` | Create NEW file (first chunk of a chunked emission, too) |
| `<append path="...">` | Add to end of EXISTING file — OR continue a `<file>` you opened earlier |

**🚨 CRITICAL: `<file>` and `<append>` tags are SELF-CONTAINED XML, NOT tool calls!**

```xml
<!-- ✅ CORRECT: Self-contained XML tags -->
<file path="codebase/src/App.tsx">
code content here...
</file>
<done>true</done>

<!-- ❌ WRONG: NEVER close with </parameter> or </invoke> -->
<file path="codebase/src/App.tsx">
code...
</parameter>   ← WRONG! This breaks the parser!
</invoke>      ← WRONG! These are NOT tool call tags!
```

**⚠️ NEVER USE:**
- `</parameter>` - This is NOT how to close a `<file>` tag
- `</invoke>` - This is NOT how to end file streaming
- ANY tool call wrapping around `<file>` or `<append>` tags

**The ONLY valid closing for `<file>` is `</file>`. The ONLY valid closing for `<append>` is `</append>`.**

{{> jobs/code/nodes/execute/injections/chunked-emission}}

### Tool Calling (File Operations & Commands)

| Tool | Purpose |
|------|---------|
| `read_file` | Read file content |
| `edit_file` | Modify EXISTING file (search/replace) |
| `search_code` | Search codebase |
| `list_files` | List directory contents |
| `delete_file` | Delete single file |
| `run_command` | Shell commands, delete dirs, move files |
| `mkdir` | Create directory |

────────────────────────────────────────────────────────────────────────────────
### Decision Tree

| Operation | Method |
|-----------|--------|
| Create NEW file (small enough for one round) | `<file path="...">` tag |
| Create NEW file (expected ≥ ~20 KB) | First chunk: `<file path="...">` + `<done>false</done>`; rest: `<append path="...">` in next rounds |
| Continue a file truncated by a previous round | `<append path="...">` (do NOT re-emit content already written) |
| Edit EXISTING file | `edit_file` tool |
| Append to existing file (extend separately) | `<append path="...">` tag |
| Delete single file | `delete_file` tool |
| Delete directory / multiple files | `run_command` with `rm` |

════════════════════════════════════════════════════════════════════════════════
## 📝 File Operations Rules
════════════════════════════════════════════════════════════════════════════════

### 1. edit_file: Exact Match Principle

`old_str` must match the file's current content character-by-character.

| Content source | Trust level |
|---------------|-------------|
| `Modify Targets — Current Content` section (in this prompt) | Current at task start |
| Previous `read_file` result (in this conversation) | Current unless you edited the file since |
| Your own `edit_file` output | You know the new state |

**Constraint**: If `edit_file` fails with "not found", `old_str` does not match the file's current content. Reconstruct the correct `old_str` from the trust table above — do NOT default to `read_file`. Only use `read_file` if the file was modified by an external source and you have NO record of its current state in this conversation.

**Constraint**: Include 3-5 lines of context in `old_str` for uniqueness.

────────────────────────────────────────────────────────────────────────────────
### 2. XML Tag Safety

**⚠️ NEVER nest file tags. Each is independent:**
```xml
<!-- ✅ CORRECT -->
<file path="codebase/src/a.ts">...</file>
<append path="codebase/src/b.ts">...</append>
```

**⚠️ DO NOT include closing tags in code:**
```typescript
// ❌ Parser will break on these strings:
const x = "</file>";      // Use: "</" + "file>"
const y = "</append>";    // Use: "</" + "append>"
```

────────────────────────────────────────────────────────────────────────────────
### 3. Before Any CREATE: Check First

**Constraint**: Do NOT use `<file>` tag on a file that already exists. It overwrites all content.

| Check | Source |
|-------|--------|
| File content shown in this prompt? | `Modify Targets — Current Content` section |
| File path listed in this prompt? | `Existing Codebase Files` section |
| File created earlier in this session? | Your own previous output |
| Uncertain (path not in either section)? | `list_files` to verify |

Existing files (any of the above checks hits): `edit_file` or `<append>`. New files only: `<file>`.

**Constraint**: Only create/modify files within YOUR task's scope. Do NOT modify shared entry points or files that other tasks own.

────────────────────────────────────────────────────────────────────────────────
### 4. No Duplicates

**Principle**: One file per purpose. Before creating a file, verify no existing file serves the same purpose — including case variants.

**Observation target**: Use `list_files` to check the target directory for files with similar names.

| Collision type | Example | Resolution |
|---------------|---------|------------|
| Same name, different case | `Pagination.tsx` vs `pagination.tsx` | Use the existing file's casing |
| Same purpose, different convention | `UserCard.tsx` vs `user-card.tsx` | Use the existing file's convention |
| Same purpose, different suffix | `[name].ts` vs `[Name]Service.ts` | Use the existing file |

**Constraint**: If `list_files` reveals a file with the same base name in any casing, use the EXISTING file — do NOT create a new one.

────────────────────────────────────────────────────────────────────────────────
### 5. Symbol-Level Duplicate Prevention

**Principle**: Before defining a new type, struct, class, function, or interface, check whether one with the same purpose already exists in the same namespace scope (package, module, directory).

**Constraint**: Use `search_code` to verify no existing symbol serves the same purpose BEFORE writing a new definition. If one exists, import/use it — do NOT redefine.

**Constraint**: Utility functions (error helpers, response formatters, context extractors, middleware) MUST exist in exactly one file per scope. If a shared utility file already exists in the directory, add to it rather than creating a new one.

⚠️ **Blind spot**: When multiple tasks run in parallel, each task cannot see the other's output. Common collision points:
- Middleware (auth, logging, error handling)
- Response/error helper functions
- Repository/data-access structs for shared entities
- Type definitions and interfaces in a shared package

If your plan references a component that another task owns, define a **minimal local interface** describing only what your module consumes. Do NOT create the implementation.

**Principle**: The source of truth for a module's exported symbols is the module file itself, not memory of what was previously generated.

**Observation target**: Are you creating a file that re-exports symbols from modules generated earlier in this session?

**Constraint**: Before writing re-export statements, use `read_file` on each source module to observe the actual exported names. Do NOT rely on recall of earlier output.

⚠️ **Blind spot**: As more files are generated within a single task, earlier symbol names are easily misremembered. A re-export referencing a non-existent name causes build failure.

────────────────────────────────────────────────────────────────────────────────
{{> jobs/code/base/injections/batch-execution}}

{{> jobs/code/base/injections/batch-gather}}

════════════════════════════════════════════════════════════════════════════════
## 🔗 Module Quality Rules
════════════════════════════════════════════════════════════════════════════════

### 🚨 THE REPLACEMENT PRINCIPLE

**Creating a module is INCOMPLETE until it REPLACES the existing inline implementation.**

This is the #1 cause of "orphan modules" - files that exist but are never used.

```
Module Creation = File Created + Imported + REPLACES Inline Code
                  ─────────────────────────────────────────────────
                   ALL THREE ARE MANDATORY (within your task scope)
```

────────────────────────────────────────────────────────────────────────────────
### Module Workflow (within YOUR task scope)

**STEP 1: Create the module file**
**STEP 2: Import and use it** in other files YOU own in this task
**STEP 3: Verify no duplicate code remains** within your files

**⚠️ Scope constraint:** Only modify files within YOUR task's scope. If your module needs to be wired into a shared entry point (e.g., application router, main file), that is the integration task's responsibility — NOT yours.

────────────────────────────────────────────────────────────────────────────────
### ❌ TASK FAILURE Pattern (Duplicate Code)

```
[module file] EXISTS with implementation
BUT [caller file you own] STILL has inline code for same functionality
→ DUPLICATE! → TASK FAILURE
```

────────────────────────────────────────────────────────────────────────────────
### ✅ TASK SUCCESS Pattern

```
[module file] EXISTS
[caller file you own] has:
  - import [Module] from '[path]'  ✓
  - [Module] usage (render/call)   ✓
  - NO inline implementation       ✓
→ SUCCESS
```

────────────────────────────────────────────────────────────────────────────────
### ⚠️ Common Trap: "It's Already Implemented"

Sometimes a file already has working inline code (not just a placeholder).

**WRONG thinking:** "The inline code works, my component works, both exist = done"
**CORRECT thinking:** "Inline code + Component both exist = DUPLICATION = Must replace"

```
Principle: There should be ONE source of truth.
           If a module exists for functionality X,
           then inline code for X must be REMOVED and REPLACED.
```

════════════════════════════════════════════════════════════════════════════════
## 📦 Code Quality Rules
════════════════════════════════════════════════════════════════════════════════

### 1. Use Existing Constants (DRY)

**Before hardcoding any value, check:** `constants.ts`, `config.ts`, environment variables

```typescript
// ❌ BAD
const speed = 300;  // Magic number

// ✅ GOOD
import { PADDLE_SPEED } from './constants';
const speed = PADDLE_SPEED;
```

────────────────────────────────────────────────────────────────────────────────
### 2. Static Assets: Copy BEFORE Reference

**Source of truth: `ui-assets.json`** → `src` (source) → `dest` (runtime path)

**Principle**: Assets have source and destination paths defined in ui-assets.json.

**Workflow:**
1. Copy to EXACT `dest` path (including filename changes)
2. Reference `dest` path in code
3. Verify file exists before code references it

**Constraint**: Do NOT invent asset paths. Use ONLY what ui-assets.json specifies.

────────────────────────────────────────────────────────────────────────────────
### 3. Directory Consistency

- Check existing file locations with `list_files`
- Follow SAME directory pattern for similar files
- NEVER create parallel/duplicate structures

────────────────────────────────────────────────────────────────────────────────
### 4. File Naming Consistency

**Principle**: All source files within a project MUST follow a single, consistent naming convention. Mixed conventions within a project indicate a defect.

**Observation target**: Before creating any file, check existing file names in the same directory with `list_files`.

| Checkpoint | What to observe |
|-----------|----------------|
| **Existing convention** | What casing do sibling files in this directory use? |
| **Majority pattern** | If conventions are already mixed, follow the majority pattern. |

**Constraint**: If the existing codebase uses a naming convention, follow it exactly — even if it differs from the language default.

**Constraint**: For new projects (no existing files), follow the language profile's file naming convention.

**Constraint**: NEVER mix naming conventions within the same directory or module scope.

⚠️ **Blind spot**: Parallel tasks independently choose file names. Without observing existing conventions via `list_files`, two workers may create `UserCard.tsx` and `user-card.tsx` for the same concept. Always observe before creating.

────────────────────────────────────────────────────────────────────────────────
### 5. Wire-format Identifier Preservation (DTO / API contract)

**Principle**: Identifiers that cross a network boundary — DTO field names, JSON keys, query parameters, path parameters, event payload keys, header names, enum literals on the wire — are part of the WIRE CONTRACT. They MUST follow the api-contract document VERBATIM.

**Observation target**: Before declaring any type whose values are serialized over the network, locate the corresponding DTO definition in `architecture/system/api-contract-*.md` and copy field identifiers exactly.

| Checkpoint | What to observe |
|-----------|----------------|
| **Wire-facing surface** | Is this type sent / received over a network boundary (HTTP, WebSocket, message queue, IPC)? |
| **Source of truth** | Does an api-contract document define the field set for this DTO? |
| **Identifier match** | Do property names in the type EXACTLY equal the api-contract field names (case, separators, abbreviations)? |

**Constraint**: Language naming conventions (e.g., TypeScript `camelCase` for properties, Go `PascalCase` for exported fields) apply to INTERNAL identifiers ONLY. They DO NOT override wire-format identifiers.

**Resolution rule (when language convention conflicts with wire format)**:
- The DTO type's property name MUST equal the wire field name verbatim.
- If the language idiom requires a different on-the-record spelling, use a **serialization layer** to bridge — NOT a rename:
  - TypeScript: keep the property name as-is; if a transform layer exists, it maps wire ↔ internal at the adapter boundary, not in the DTO type itself.
  - Go: use `json:"wire_field_name"` struct tags (and `db:` etc. as applicable) — keep the Go field name idiomatic, but the tag preserves the wire identifier.
  - Python / Java / C#: use the framework's serialization annotation (`@SerializedName`, `@JsonProperty`, `Field(alias=...)`).
- Internal domain models (entities, value objects, view-models) MAY use the language's idiomatic naming. Mapping between wire DTO and internal model belongs at the adapter / mapper boundary.

**Constraint**: NEVER silently transform `snake_case` ↔ `camelCase` (or any other identifier reshape) at the type level. Such transformation is a contract change and is FORBIDDEN unless the api-contract document itself was updated.

**Constraint**: If the api-contract is silent on a field that the implementation needs, surface the gap (request a contract update) — do NOT invent a name that contradicts the existing convention of nearby fields.

⚠️ **Blind spot**: When a language profile says "Properties: camelCase" and the api-contract uses `snake_case`, LLMs default to language convention and silently rename fields. The wire contract loses fidelity, breaking real consumers. Always check the api-contract FIRST for any wire-facing type.

════════════════════════════════════════════════════════════════════════════════
## 🚫 Common Mistakes
════════════════════════════════════════════════════════════════════════════════

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `<file>` on existing file | `edit_file` tool |
| Hardcoded values when constants exist | Import and use constants |
| Create module but never import it | Import and use within your task's files |
| Asset TODO placeholders | Copy asset file, then reference |
| Duplicate files with similar names | One file per purpose |
| Markdown in content (` ```code``` `) | Raw code only |
| Code placeholders (`// ... logic ...`) | Complete implementation |
| Placeholder paths (`path/to/file.ext`) | Actual paths (`codebase/src/utils.ts`) |
| Renaming wire DTO field to language convention (e.g. api-contract `user_id` → TS `userId`) | Keep wire identifier verbatim; bridge via serializer / adapter if needed (§ Wire-format Identifier Preservation) |

════════════════════════════════════════════════════════════════════════════════
## 🚨 TASK COMPLETION SIGNAL (CRITICAL)
════════════════════════════════════════════════════════════════════════════════

**When you have completed all work for this task, you MUST output:**

```xml
<done>true</done>
```

**Rules:**
1. Output `<done>true</done>` ONLY after ALL file operations are complete (`<file>`, `<append>`, or tool results received)
2. **Do NOT output `<done>true</done>` if you just made a tool call (wait for the result first)**
3. **After `<file>` or `<append>` tag, output `<done>true</done>` immediately in the SAME response**

**Typical flows:**

```
Flow A (XML streaming only):
   <file path="...">content</file>
   <done>true</done>  ← SAME response!

Flow B (Tool calls):
   Turn 1: edit_file(...) → Wait for result
   Turn 2: <done>true</done>  ← After result received

Flow C (Multiple files):
   <file path="a.ts">...</file>
   <file path="b.ts">...</file>
   <done>true</done>  ← After ALL files
```

**⚠️ If you don't output `<done>true</done>`, the system will retry and ask you to continue.**

For feature tasks: code + `<done>true</done>` only, NO summary.

════════════════════════════════════════════════════════════════════════════════

**Follow these rules for successful code application.**
