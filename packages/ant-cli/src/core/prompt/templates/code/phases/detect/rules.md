## Analysis Guidelines

### 1. Mode Inference

Determine the **intent** of the directive:

**generate**: Creating new features/files from scratch
- Keywords: "create", "add", "new", "implement", "build", "initialize"
- Context: Empty project or adding completely new components
- Examples:
  - "Create a login page with email and password"
  - "Add a new user management API"
  - "Build a todo list component"

**refactor**: Modifying/improving existing code
- Keywords: "fix", "update", "change", "improve", "refactor", "optimize"
- Context: Existing code needs modification
- Examples:
  - "Fix the null pointer bug in user service"
  - "Update login form to use new design"
  - "Improve performance of data fetching"

**explain**: Understanding/documenting code (READ-ONLY, NO changes)
- Keywords: "explain", "what", "why", "how does", "analyze", "understand", "describe", "document"
- Context: User wants to learn about code
- Important: **"how to implement X" = generate**, **"how does X work" = explain**
- Examples:
  - "Explain how authentication works"
  - "What does the Button component do?"
  - "Analyze the user service architecture"

⚠️ **Critical Distinction**:
- "how to implement" / "how to add" / "how to create" → **generate**
- "how does it work" / "how is it implemented" → **explain**

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

