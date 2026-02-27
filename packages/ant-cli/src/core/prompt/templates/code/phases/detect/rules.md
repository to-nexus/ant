## Analysis Guidelines

### 1. Mode Inference

**Principle**: Mode is determined by what the directive describes, not by the action verb used.

**Observation target**: Observe what the directive addresses to determine mode.

| Checkpoint | What to observe | Mode |
|-----------|----------------|------|
| **Broken behavior** | Does the directive describe incorrect, missing, or failing behavior? | `refactor` |
| **New capability** | Does the directive describe functionality that does not yet exist? | `generate` |
| **Understanding only** | Does the directive request explanation without describing any problem or missing capability? | `explain` |

**Constraint**: Do NOT classify as `explain` when the directive describes broken or incorrect behavior. Broken behavior implies modification is needed → `refactor`.

**Constraint**: Classify as `explain` ONLY when the directive requests pure understanding and describes NO broken behavior and NO missing capability.

**Constraint**: When the directive describes both broken behavior and new capability, choose `refactor` if existing behavior is the primary subject, `generate` if new capability is the primary subject.

⚠️ **Blind spot**: Investigation verbs ("analyze", "investigate", "find root cause", "check") easily mask modification intent. When these verbs accompany descriptions of broken or incorrect behavior, the mode is `refactor`, not `explain`.

---

### 2. RAG Requirement

Does the `decompose` node need codebase context?

**RAG is needed when:**
- ✅ Modifying existing code (refactor)
- ✅ Adding to existing project (generate in existing codebase)
- ✅ Understanding code (explain)
- ✅ Directive mentions existing files, components, or patterns

**RAG is NOT needed when:**
- ❌ Brand new empty project with no code yet

**In practice:** Almost ALWAYS set `requireRag: true` unless you're 100% certain it's an empty project.

---

### 3. Keyword Generation (if RAG required)

**🎯 PURPOSE:**

Keywords search Vector DB to find **file paths** (not full content) for the decompose node.
The decompose node uses this file list to understand what exists and plan tasks accurately.

**⚠️ CRITICAL PRINCIPLES:**

1. **Quality over quantity**: 8-15 precise keywords, not 30+
2. **Stack trace priority**: Extract exact file names from error stacks
3. **Avoid generic terms**: "component", "service", "function" are useless

---

**Stack Trace Extraction** (if directive contains error):

Extract EXACT file names from stack trace:
- ✅ Include file extensions: `"UserList.ts"` (not `"UserList"`)
- ✅ Include relative paths if available: `"src/pages/UserList.ts"`
- ✅ Maximum 5 files from stack trace

Example:
```
Directive: "Error at UserList.ts:85 → AuthService.ts:144"

Extract:
- "UserList.ts"
- "AuthService.ts"
```

---

**Semantic Keywords** (8-12 keywords):

**⚠️ CRITICAL: Single-token principle**
- All keywords MUST be single tokens (no spaces)
- Use camelCase, PascalCase, or kebab-case
- Spaces break Vector DB search efficiency

1. **Error identifiers** (if error directive):
   - Error codes: `"RESOURCE_NOT_FOUND"`, `"VALIDATION_ERROR"`
   - Error constants

2. **Domain entities**:
   - Component/class names: `"DataService"`, `"UserRepository"`
   - Type/interface names: `"UserDTO"`, `"ApiResponse"`

3. **Operations** (single tokens only):
   - ✅ `"joinRoom"`, `"createUser"`, `"fetchNews"`
   - ❌ `"join room"`, `"create user"`, `"fetch news"`

4. **Framework patterns** (if relevant):
   - ✅ `"useEffect"`, `"WebSocket"`, `"eventHandler"`
   - ❌ `"event handler"`, `"web socket"`

**What NOT to include**:
- ❌ Generic terms: `"component"`, `"service"`, `"function"`, `"file"`
- ❌ Framework names: `"React"`, `"Express"`, `"NestJS"`
- ❌ Language keywords: `"const"`, `"async"`, `"class"`
- ❌ Redundant variations: Choose one form only
- ❌ Multi-word phrases with spaces: `"Korean news"` → use `"KoreanNews"`

---

**Reference Project Keywords**:

If directive mentions other projects (e.g., "check backend API"):
```json
{
  "references": [
    {
      "project": "backend",
      "keywords": ["room API", "game state", "WebSocket handler", "room service"]
    }
  ]
}
```

Maximum 8 keywords per reference project.
