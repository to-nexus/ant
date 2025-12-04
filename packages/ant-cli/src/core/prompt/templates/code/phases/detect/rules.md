## Analysis Guidelines

### 1. Mode Inference

Determine the **intent** of the directive by analyzing the **action verbs**:

**generate**: Creating new features/files from scratch
- **Action verbs**: "create", "add", "new", "implement", "build", "initialize", "set up"
- **Context**: Empty project or adding completely new components
- **Key indicator**: No existing code is being modified
- Examples:
  - "Create a login page with email and password"
  - "Add a new user management API"
  - "Build a todo list component"

**refactor**: Modifying/improving existing code
- **Action verbs**: "fix", "update", "change", "improve", "refactor", "optimize", "modify", "correct", "adjust"
- **Context**: Existing code needs modification
- **Key indicator**: Directive mentions fixing, changing, or improving existing code
- Examples:
  - "Fix the null pointer bug in user service"
  - "Update login form to use new design"
  - "Improve performance of data fetching"
  - "Check the entry point and fix if needed" ← Has "fix" action
  - "Investigate the error and update the code" ← Has "update" action

**explain**: Understanding/documenting code (READ-ONLY, NO changes)
- **Action verbs**: "explain", "describe", "analyze", "understand", "document", "show", "tell"
- **Context**: User wants to learn about code (NO modification intended)
- **Key indicator**: NO action verbs for modification (fix, change, update, etc.)
- Examples:
  - "Explain how authentication works"
  - "What does the Button component do?"
  - "Analyze the user service architecture"
  - "Check the entry point configuration" ← Only "check", no fix/modify action

⚠️ **CRITICAL Decision Rules**:

1. **Look for action verbs FIRST**:
   - If directive contains ANY modification verbs (fix, change, update, modify, correct, improve) → **refactor**
   - If directive contains ONLY investigation verbs (check, analyze, investigate) with NO modification verbs → **explain**
   - If directive contains creation verbs (create, add, build, implement) → **generate**

2. **Multi-step directives** (e.g., "check X and fix Y"):
   - If BOTH investigation AND modification verbs exist → **refactor**
   - Example: "Check the configuration and update if needed" → **refactor** (has "update")

3. **Ambiguous cases**:
   - "how to implement X" → **generate** (creating new)
   - "how does X work" → **explain** (understanding existing)
   - "how to fix X" → **refactor** (modifying existing)

4. **Language-agnostic**: Works for all languages (English, Korean, etc.)
   - Focus on detecting action verbs regardless of language
   - Korean examples: "수정" (modify), "고치" (fix), "확인" (check)

### 2. Environment Detection

- **frontend**: UI, components, pages, styling, client-side, React, Vue, etc.
- **backend**: API, database, server, business logic, Node.js, Express, etc.
- **fullstack**: Both frontend and backend components
- **unknown**: Unclear or non-code tasks (documentation, planning)

### 3. RAG Requirement

Does the `decompose` node need codebase context?

⚠️ **CRITICAL: Mode ≠ Project Type!**
- **generate/refactor/explain** = What ACTION to take
- **NEW vs EXISTING project** = What PROJECT context exists

**RAG is needed when:**
- ✅ Modifying existing code (refactor)
- ✅ Adding to existing project (generate in existing codebase)
- ✅ Understanding code (explain)
- ✅ Directive mentions existing files, components, or patterns

**RAG is NOT needed when:**
- ❌ Brand new empty project with no code yet
- ❌ Pure documentation or planning tasks

**In practice:** Almost ALWAYS set `requireRagForDecompose: true` unless you're 100% certain it's an empty project with no existing code.

### 4. Keyword Generation (if RAG required)

**🎯 PURPOSE OF KEYWORDS:**

Keywords are used to search the Vector DB and find relevant files for the `decompose` node.
The `decompose` node will receive a **file list** (not full content) based on these keywords.
This file list helps LLM understand what files exist and plan tasks accurately.

**⚠️ CRITICAL: Generate COMPREHENSIVE keywords!**

The more relevant keywords you provide, the more complete the file list will be.
If you miss important keywords, the decompose node may incorrectly assume files don't exist.

**Main Project Keywords** (10-20 semantic keywords, be thorough!):

Include ALL of these categories:
1. **Direct mentions**: File names, function names, component names from directive
2. **Related concepts**: Patterns, APIs, types that might be relevant
3. **Potential dependencies**: Files that might import/export related code
4. **Error context**: If error mentioned, include error-related file patterns

**Keyword Generation Strategy:**

Think: "What files might exist that are related to this directive?"

Examples:
- Directive: "Add password toggle to login form"
  → Keywords: [
    "login", "LoginForm", "password", "input", "visibility", "toggle",
    "eye icon", "form", "auth", "authentication", "user input",
    "form validation", "password field", "show password", "hide password"
  ]
  
- Directive: "Fix ERR_MODULE_NOT_FOUND in WebSocketServer"
  → Keywords: [
    "WebSocketServer", "WebSocket", "EventHandler", "socket", "ws",
    "import", "module", "server", "connection", "handler",
    "message handler", "room", "game", "tsconfig", "package.json",
    "ESM", "module resolution"
  ]

- Directive: "서버 시작 시 포트 로깅 추가"
  → Keywords: [
    "server", "start", "listen", "port", "logging", "console.log",
    "express", "app.listen", "http server", "startup", "bootstrap",
    "main", "index", "entry point", "routes", "endpoints"
  ]

**Reference Project Keywords** (if directive mentions other projects):
- Per reference project: 5-10 specific keywords
- What to look for in that project

Examples:
- Directive: "Call backend API for user data"
  → Reference: {"backend": ["user API", "auth endpoint", "data schema", "routes", "controller", "response type"]}

