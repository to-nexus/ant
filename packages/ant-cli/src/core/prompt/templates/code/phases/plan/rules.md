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

**When to use**: Directive contains error stack trace or explicit file references.

**How to extract**:
1. Look for file paths in stack trace
2. Extract EXACT file names with extensions
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

**If no stack trace**: Return empty array `[]`

---

## Semantic Keywords

**Purpose**: Find related code through semantic similarity search.

**What to include**:

1. **Error identifiers**
   - Error codes: `"GAME_IN_PROGRESS"`, `"NOT_FOUND"`
   - Error constants: `"ERROR_TYPES"`, `"ValidationError"`

2. **Technical identifiers**
   - Component names (without extensions): `"RoomPage"`, `"GameProvider"`
   - Function/method names: `"joinRoom"`, `"handleConnect"`
   - Type/interface names: `"GameState"`, `"Player"`

3. **Domain concepts**
   - Features: `"room management"`, `"player connection"`
   - Operations: `"join room"`, `"game start"`
   - States: `"room status"`, `"game state"`

4. **Framework/technical patterns**
   - Lifecycle: `"useEffect"`, `"componentDidMount"`
   - State management: `"useState"`, `"dispatch"`
   - Async patterns: `"WebSocket"`, `"event handler"`

**What NOT to include**:
- ❌ Generic terms: `"function"`, `"variable"`, `"React"`
- ❌ Language keywords: `"const"`, `"async"`, `"class"`
- ❌ Non-existent files (don't guess file names)
- ❌ Redundant variations: If you have `"join room"`, don't add `"joining room"`, `"room join"`

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
    "room list",
    "room display",
    "real-time updates",
    "room status",
    "player count",
    "WebSocket",
    "room management",
    "list component",
    "auto refresh"
  ]
}
```

**Why good**:
- ✅ Empty stack trace (no error)
- ✅ Feature keywords (room list, display)
- ✅ Technical requirements (real-time, WebSocket)
- ✅ Domain concepts (room status, player count)
- ✅ 9 keywords (within limit)

---

### Example 3: BAD (What NOT to do)

**Directive**:
```
Error: Cannot read property 'map' of undefined in UserList.tsx
```

**BAD Output**:
```json
{
  "stackTrace": [
    "UserList",                    ❌ Missing .tsx
    "useUserList.ts"               ❌ Guessed file (doesn't exist)
  ],
  "keywords": [
    "map",                         ❌ Too generic
    "undefined",                   ❌ Too generic
    "property",                    ❌ Language keyword
    "read",                        ❌ Too generic
    "error",                       ❌ Too generic
    "TypeError",                   ❌ Generic error type
    "user",                        ❌ Too broad
    "list",                        ❌ Too broad
    "array",                       ❌ Generic
    "iteration",
    "foreach",
    "loop",
    ... 40 more keywords           ❌ Way too many!
  ]
}
```

**GOOD Output**:
```json
{
  "stackTrace": [
    "UserList.tsx"                 ✅ Exact file name
  ],
  "keywords": [
    "UserList",                    ✅ Component name
    "map undefined",               ✅ Specific error pattern
    "array null check",            ✅ Related concept
    "user data",                   ✅ Domain concept
    "data loading",                ✅ Likely cause
    "useState",                    ✅ State management
    "useEffect",                   ✅ Data fetching
    "API response"                 ✅ Data source
  ]
}
```

---

## Final Checklist

Before outputting:

- [ ] Stack trace: Exact file names with extensions
- [ ] Stack trace: Maximum 5 files
- [ ] Keywords: 8-12 keywords
- [ ] Keywords: No generic terms
- [ ] Keywords: No duplicates/redundancy
- [ ] Keywords: Diverse coverage (error + domain + technical)
- [ ] Output: Valid JSON only, no explanations

---

Output ONLY valid JSON. No explanations.
