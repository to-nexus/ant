## Keyword Generation for Code Search

### Goal

Generate high-quality search keywords to retrieve relevant code files from Vector DB.

**Key Principle**: Quality over quantity. Precise keywords yield better results.

---

## Required Files Selection

**Purpose**: Directly specify files from the codebase structure that this task needs.

**When to use** (codebase structure is visible):
- Entry point files that the task must MODIFY (e.g., main.go, index.ts, app.py)
- Configuration files the task reads (e.g., go.mod, package.json)
- Existing files that will be modified as part of this task

**When NOT to use**:
- Files that will be CREATED (they don't exist yet)
- Files loosely related but not directly needed
- When no codebase structure is provided (return empty array `[]`)

**Limit**: Maximum 10 files. Select only directly relevant ones.
**Format**: Exact relative paths from the codebase structure tree.

---

## Error Files Extraction

**CRITICAL: Only use when directive contains ACTUAL ERROR STACK TRACE**

**When to use** (ALL conditions must be met):
1. Directive contains ERROR or EXCEPTION
2. Directive includes file paths with line numbers (e.g., `UserService.ts:85`)
3. Files are explicitly mentioned as part of error stack

**When NOT to use** (return empty array `[]`):
- Feature requests ("add room list", "implement chat")
- Performance requests ("make it faster", "optimize queries")
- Bug fixes WITHOUT stack trace ("button doesn't work", "page is blank")
- Refactoring tasks ("clean up code", "improve structure")
- You're just guessing which files might be relevant

**How to extract**:
1. Look for file paths in ACTUAL stack trace
2. Extract EXACT file names with extensions and line numbers
3. Include relative paths if available

**Examples**:

```
Directive: "Error at UserService.ts:85 -> AuthHandler.ts:144"

Extract:
"UserService.ts"
"AuthHandler.ts"

or better (if path visible):
"src/services/UserService.ts"
"src/handlers/AuthHandler.ts"
```

**Limit**: Maximum 5 files (most relevant ones from stack trace)

**Default**: If no EXPLICIT stack trace with line numbers -> Return empty array `[]`

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
- Generic terms: `"function"`, `"variable"`, `"framework"`
- Language keywords: `"const"`, `"async"`, `"class"`
- Non-existent files (don't guess file names)
- Multi-word phrases with spaces: `"create user"` (use `"createUser"` instead)
- Redundant variations: If you have `"createUser"`, don't add `"creatingUser"`, `"userCreate"`

**Limit**: 0-12 keywords. If `requiredFiles` and/or `errorFiles` already cover all files this task needs, keywords can be empty `[]`. Only generate keywords when additional file discovery through semantic search is needed.

---

## Extraction Strategy

### Step 1: Parse Directive

Identify:
- **Facts**: Stack trace, error codes, file names, line numbers
- **Context**: What user was doing, what failed
- **Technical details**: Framework, patterns mentioned

### Step 2: Select Required Files

If codebase structure is visible:
- Identify files this task needs to read or modify
- Use exact paths from the tree

### Step 3: Extract Error Files

If error stack trace exists:
- Extract file paths -> `errorFiles` array
- Don't repeat in keywords

### Step 4: Generate Keywords

**Priority order**:
1. Error codes/constants (highest relevance)
2. Component/function names directly mentioned
3. Domain concepts related to the error
4. Framework patterns relevant to the issue

**Semantic expansion**:
- If error mentions "create user" -> include related: `"userValidation"`, `"userRepository"`
- If stack shows service layer -> include: `"serviceError"`, `"businessLogic"`
- If mentions state -> include: `"stateManagement"`, `"dataFlow"`

### Step 5: Quality Check

- Remove duplicates
- Remove generic terms
- Keep 0-12 most relevant keywords (empty if requiredFiles/errorFiles are sufficient)
- Ensure diverse coverage (not all about one narrow topic)

---

## Examples

### Example 1: Error with Stack Trace

**Directive**:
```
Error: RESOURCE_NOT_FOUND at UserService.ts:85
Stack: UserService.ts:85 -> DataRepository.ts:144
Message: "User not found in database"
Warning: Cannot update UserProvider while processing request
```

**Output**:
```json
{
  "requiredFiles": [],
  "keywords": [
    "RESOURCE_NOT_FOUND",
    "UserService",
    "DataRepository",
    "userLookup",
    "databaseQuery",
    "findUser",
    "errorHandler",
    "dataAccess",
    "notFoundError"
  ],
  "errorFiles": [
    "UserService.ts",
    "DataRepository.ts"
  ],
  "references": {}
}
```

### Example 2: Error with Stack Trace (files sufficient)

**Directive**:
```
TypeError: Cannot read property 'id' of undefined
  at OrderController.ts:42
  at OrderService.ts:118
```

**Output** (errorFiles are sufficient, no additional semantic search needed):
```json
{
  "requiredFiles": [],
  "keywords": [],
  "errorFiles": [
    "OrderController.ts",
    "OrderService.ts"
  ],
  "references": {}
}
```

### Example 3: Feature Request with Codebase Structure

**Directive**:
```
Add profile management endpoints
```

**Codebase structure visible** with `main.go`, `handlers/`, `services/` directories.

**Output**:
```json
{
  "requiredFiles": ["main.go"],
  "keywords": [
    "profileHandler",
    "profileService",
    "profileRepository",
    "userProfile",
    "updateProfile",
    "getProfile",
    "routerGroup",
    "middleware"
  ],
  "errorFiles": [],
  "references": {}
}
```

### Example 4: Simple Modification with Codebase Structure (requiredFiles sufficient)

**Directive**:
```
Add a health check endpoint to the server
```

**Codebase structure visible** with `main.go`, `go.mod`, `handlers/` directory.

**Output** (requiredFiles cover all needed files, no semantic search needed):
```json
{
  "requiredFiles": ["main.go", "go.mod"],
  "keywords": [],
  "errorFiles": [],
  "references": {}
}
```

### Example 5: Feature Request without Codebase Structure

**Output** (no requiredFiles or errorFiles available, keywords are essential):
```json
{
  "requiredFiles": [],
  "keywords": [
    "userList",
    "userDisplay",
    "pagination",
    "userStatus",
    "dataTable",
    "userManagement",
    "listComponent",
    "filterHandler"
  ],
  "errorFiles": [],
  "references": {}
}
```

---

## Final Checklist

Before outputting:

- [ ] Required files: Only from codebase structure (if visible), exact paths
- [ ] Required files: Only files to READ or MODIFY, not files to CREATE
- [ ] Required files: Maximum 10 files
- [ ] Error files: **ONLY if directive contains ACTUAL error with file:line format**
- [ ] Error files: If no explicit error trace -> **MUST be empty array []**
- [ ] Error files: Exact file names with extensions
- [ ] Error files: Maximum 5 files
- [ ] Keywords: 0-12 keywords (empty `[]` allowed if requiredFiles/errorFiles already cover all needed files)
- [ ] Keywords: No generic terms
- [ ] Keywords: No duplicates/redundancy
- [ ] Keywords: Diverse coverage (error + domain + technical)
- [ ] Output: Valid JSON only, no explanations

---

Output ONLY valid JSON. No explanations.
