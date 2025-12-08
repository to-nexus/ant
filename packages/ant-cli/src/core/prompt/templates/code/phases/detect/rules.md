## Analysis Guidelines

### 1. Mode Inference

Determine the **intent** of the directive by analyzing the **action verbs**:

**generate**: Creating new features/files from scratch
- **Action verbs**: "create", "add", "new", "implement", "build", "initialize", "set up"
- **Key indicator**: No existing code is being modified

**refactor**: Modifying/improving existing code
- **Action verbs**: "fix", "update", "change", "improve", "refactor", "optimize", "modify", "correct", "adjust"
- **Key indicator**: Directive mentions fixing, changing, or improving existing code

**explain**: Understanding/documenting code (READ-ONLY, NO changes)
- **Action verbs**: "explain", "describe", "analyze", "understand", "document", "show", "tell"
- **Key indicator**: NO action verbs for modification

⚠️ **Decision Rules**:
- If directive contains ANY modification verbs (fix, change, update) → **refactor**
- If directive contains ONLY investigation verbs (check, analyze) with NO modification → **explain**
- If directive contains creation verbs (create, add, build) → **generate**

---

### 2. Environment Detection

- **frontend**: UI, components, pages, styling, client-side, React, Vue, etc.
- **backend**: API, database, server, business logic, Node.js, Express, etc.
- **fullstack**: Both frontend and backend components
- **unknown**: Unclear or non-code tasks

---

### 3. RAG Requirement

Does the `decompose` node need codebase context?

**RAG is needed when:**
- ✅ Modifying existing code (refactor)
- ✅ Adding to existing project (generate in existing codebase)
- ✅ Understanding code (explain)
- ✅ Directive mentions existing files, components, or patterns

**RAG is NOT needed when:**
- ❌ Brand new empty project with no code yet

**In practice:** Almost ALWAYS set `requireRagForDecompose: true` unless you're 100% certain it's an empty project.

---

### 4. Keyword Generation (if RAG required)

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
- ✅ Include file extensions: `"RoomPage.tsx"` (not `"RoomPage"`)
- ✅ Include relative paths if available: `"src/pages/RoomPage.tsx"`
- ✅ Maximum 5 files from stack trace

Example:
```
Directive: "Error at RoomPage.tsx:85 → WebSocketContext.tsx:144"

Extract:
- "RoomPage.tsx"
- "WebSocketContext.tsx"
```

---

**Semantic Keywords** (8-12 keywords):

1. **Error identifiers** (if error directive):
   - Error codes: `"GAME_IN_PROGRESS"`, `"NOT_FOUND"`
   - Error constants

2. **Domain entities**:
   - Component/class names: `"GameProvider"`, `"RoomService"`
   - Type/interface names: `"GameState"`, `"Player"`

3. **Operations**:
   - Action keywords: `"join room"`, `"create user"`
   - State keywords: `"game status"`, `"player state"`

4. **Framework patterns** (if relevant):
   - `"useEffect"`, `"WebSocket"`, `"event handler"`

**What NOT to include**:
- ❌ Generic terms: `"component"`, `"service"`, `"function"`, `"file"`
- ❌ Framework names: `"React"`, `"Express"`, `"NestJS"`
- ❌ Language keywords: `"const"`, `"async"`, `"class"`
- ❌ Redundant variations: Choose one form only

---

**Examples**:

**GOOD** (Error with stack trace):
```json
{
  "codebase": [
    "RoomPage.tsx",
    "WebSocketContext.tsx",
    "GameContext.tsx",
    "GAME_IN_PROGRESS",
    "GameProvider",
    "join room",
    "room status",
    "useEffect",
    "WebSocket event"
  ]
}
```
**Why good**: 9 keywords, exact file names, focused semantic terms.

---

**GOOD** (Feature without stack trace):
```json
{
  "codebase": [
    "room list",
    "lobby",
    "room display",
    "real-time updates",
    "WebSocket",
    "room status",
    "player count",
    "list component"
  ]
}
```
**Why good**: 8 keywords, domain-focused, no generic terms.

---

**BAD** (Over-generating):
```json
{
  "codebase": [
    "WebSocketContext", "WebSocket", "socket", "ws", "connection",
    "RoomPage", "room", "page", "component", "React component",
    "GameContext", "game", "context", "state", "state management",
    "provider", "GameProvider", "RoomProvider", "context provider",
    "useEffect", "useContext", "useState", "React hooks", "hooks",
    "error", "error handling", "try catch", "validation",
    "room creation", "room join", "room leave", "room management",
    "player", "user", "client", "server"
  ]
}
```
**Why bad**: 36+ keywords, generic terms ("component", "state"), redundant variations ("WebSocket", "socket", "ws").

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
