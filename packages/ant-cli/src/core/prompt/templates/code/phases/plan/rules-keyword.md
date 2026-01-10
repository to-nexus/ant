## Keyword Generation for Code Search

### Goal

Generate high-quality search keywords to retrieve relevant code files from Vector DB.

**Key Principle**: Quality over quantity. Precise keywords yield better results.

---

## Output Format

```json
{
  "stackTrace": ["file1.tsx", "file2.tsx"],
  "keywords": ["keyword1", "keyword2", ...]
}
```

---

## Stack Trace Extraction

**⚠️ CRITICAL: Only use when directive contains ACTUAL ERROR STACK TRACE**

**When to use** (ALL conditions must be met):
1. Directive contains ERROR or EXCEPTION
2. Directive includes file paths with line numbers (e.g., `RoomPage.tsx:85`)
3. Files are explicitly mentioned as part of error stack

**When NOT to use** (return empty array `[]`):
- ❌ Feature requests ("add room list", "implement chat")
- ❌ Performance requests ("make it faster", "optimize queries")
- ❌ Bug fixes WITHOUT stack trace ("button doesn't work", "page is blank")
- ❌ Refactoring tasks ("clean up code", "improve structure")
- ❌ You're just guessing which files might be relevant

**How to extract**:
1. Look for file paths in ACTUAL stack trace
2. Extract EXACT file names with extensions and line numbers
3. Include relative paths if available

**Examples**:

```
Directive: "Error at RoomPage.tsx:85 → WebSocketContext.tsx:144"

Extract:
✅ "RoomPage.tsx"
✅ "WebSocketContext.tsx"

or better (if path visible):
✅ "src/pages/RoomPage.tsx"
✅ "src/contexts/WebSocketContext.tsx"
```

**Limit**: Maximum 5 files (most relevant ones from stack trace)

**Default**: If no EXPLICIT stack trace with line numbers → Return empty array `[]`

---

## Semantic Keywords

**Purpose**: Find related code through semantic similarity search.

**Format**: Single tokens only (no spaces). Use camelCase, PascalCase, or snake_case for compound concepts.

**What to include**:

1. **Error identifiers**
   - Error codes from directive/logs
   - Error constant names
   - Exception type names

2. **Technical identifiers**
   - Component/class names mentioned in task
   - Function/method names that implement the feature
   - Type/interface names related to data structures

3. **Domain concepts**
   - Feature names from task description (as single words or camelCase)
   - Business operations being implemented
   - State/status concepts in the domain

4. **Framework/technical patterns**
   - Lifecycle hooks if state management is involved
   - State management patterns if data flow is complex
   - Async patterns if network/IO operations exist

**What NOT to include**:
- ❌ Generic terms: `"function"`, `"variable"`, `"React"`
- ❌ Language keywords: `"const"`, `"async"`, `"class"`
- ❌ Non-existent files (don't guess file names)
- ❌ Multi-word phrases with spaces: `"join room"` (use `"joinRoom"` instead)
- ❌ Redundant variations: If you have `"joinRoom"`, don't add `"joiningRoom"`, `"roomJoin"`

**Limit**: 8-12 keywords maximum

---

## Extraction Strategy

### Step 1: Parse Directive

Identify:
- **Facts**: Stack trace, error codes, file names, line numbers
- **Context**: What user was doing, what failed
- **Technical details**: Framework, patterns mentioned

### Step 2: Extract Stack Trace

If error stack trace exists:
- Extract file paths → `stackTrace` array
- Don't repeat in keywords

### Step 3: Generate Keywords

**Priority order**:
1. Error codes/constants (highest relevance)
2. Component/function names directly mentioned
3. Domain concepts related to the error
4. Framework patterns relevant to the issue

**Semantic expansion**:
- If error mentions "join room" → include related: `"room status"`, `"player connection"`
- If stack shows React component → include: `"useEffect"`, `"lifecycle"`
- If mentions state → include: `"state management"`, `"dispatch"`

### Step 4: Quality Check

- Remove duplicates
- Remove generic terms
- Keep 8-12 most relevant
- Ensure diverse coverage (not all about one narrow topic)

---

## Examples

### Example 1: Error with Stack Trace

**Directive**:
```
Error: GAME_IN_PROGRESS at RoomPage.tsx:85
Stack: RoomPage.tsx:85 → WebSocketContext.tsx:144
Message: "Game is already in progress"
React warning: Cannot update GameProvider while rendering RoomPage
```

**Output**:
```json
{
  "stackTrace": [
    "RoomPage.tsx",
    "WebSocketContext.tsx"
  ],
  "keywords": [
    "GAME_IN_PROGRESS",
    "GameProvider",
    "GameContext",
    "room status",
    "game state",
    "join room",
    "useEffect",
    "render cycle",
    "state update"
  ]
}
```

**Why good**:
- ✅ Exact file names from stack
- ✅ Error code included
- ✅ Related components (GameProvider, GameContext)
- ✅ Domain concepts (room status, join room)
- ✅ Technical patterns (useEffect, render cycle)
- ✅ 9 keywords (within limit)

---

### Example 2: Feature Request (No Stack Trace)

**Directive**:
```
Add room list display with real-time updates.
Show room name, player count, and status.
Update automatically when rooms change.
```

**Output**:
```json
{
  "stackTrace": [],
  "keywords": [
    "roomList",
    "roomDisplay",
    "realTimeUpdates",
    "roomStatus",
    "playerCount",
    "WebSocket",
    "roomManagement",
    "listComponent",
    "autoRefresh"
  ]
}
```

**Why good**:
- ✅ Empty stack trace (no error)
- ✅ Feature keywords (roomList, display)
- ✅ Technical requirements (realTimeUpdates, WebSocket)
- ✅ Domain concepts (roomStatus, playerCount)
- ✅ Single-token format (camelCase for compound concepts)
- ✅ 9 keywords (within limit)

---

### Example 3: Common Mistakes

**❌ Don't**:
- Add file extensions incorrectly: `"UserList"` instead of `"UserList.tsx"`
- Guess files that might not exist
- Use generic terms: `"map"`, `"undefined"`, `"error"`
- Use language keywords: `"property"`, `"const"`, `"async"`
- Add too many keywords (40+)
- Use multi-word phrases with spaces: `"user data"`, `"array null check"`

**✅ Do**:
- Use exact file names from error messages
- Use specific component/function names: `"UserList"`, `"mapUndefined"`
- Keep 8-12 keywords maximum
- Use single-token format (camelCase): `"userData"`, `"arrayNullCheck"`

---

## Final Checklist

Before outputting:

- [ ] Stack trace: **ONLY if directive contains ACTUAL error with file:line format**
- [ ] Stack trace: If no explicit error trace → **MUST be empty array []**
- [ ] Stack trace: Exact file names with extensions
- [ ] Stack trace: Maximum 5 files
- [ ] Keywords: 8-12 keywords
- [ ] Keywords: No generic terms
- [ ] Keywords: No duplicates/redundancy
- [ ] Keywords: Diverse coverage (error + domain + technical)
- [ ] Output: Valid JSON only, no explanations

---

Output ONLY valid JSON. No explanations.
