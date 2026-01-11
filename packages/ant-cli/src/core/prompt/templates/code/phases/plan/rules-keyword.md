## Keyword Generation for Code Search

### Goal

Generate high-quality search keywords to retrieve relevant code files from Vector DB.

**Key Principle**: Quality over quantity. Precise keywords yield better results.

---

## Output Format

```json
{
  "stackTrace": ["file1.ts", "file2.ts"],
  "keywords": ["keyword1", "keyword2", ...]
}
```

---

## Stack Trace Extraction

**⚠️ CRITICAL: Only use when directive contains ACTUAL ERROR STACK TRACE**

**When to use** (ALL conditions must be met):
1. Directive contains ERROR or EXCEPTION
2. Directive includes file paths with line numbers (e.g., `UserService.ts:85`)
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
Directive: "Error at UserService.ts:85 → AuthHandler.ts:144"

Extract:
✅ "UserService.ts"
✅ "AuthHandler.ts"

or better (if path visible):
✅ "src/services/UserService.ts"
✅ "src/handlers/AuthHandler.ts"
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
- ❌ Generic terms: `"function"`, `"variable"`, `"framework"`
- ❌ Language keywords: `"const"`, `"async"`, `"class"`
- ❌ Non-existent files (don't guess file names)
- ❌ Multi-word phrases with spaces: `"create user"` (use `"createUser"` instead)
- ❌ Redundant variations: If you have `"createUser"`, don't add `"creatingUser"`, `"userCreate"`

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
- If error mentions "create user" → include related: `"userValidation"`, `"userRepository"`
- If stack shows service layer → include: `"serviceError"`, `"businessLogic"`
- If mentions state → include: `"stateManagement"`, `"dataFlow"`

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
Error: RESOURCE_NOT_FOUND at UserService.ts:85
Stack: UserService.ts:85 → DataRepository.ts:144
Message: "User not found in database"
Warning: Cannot update UserProvider while processing request
```

**Output**:
```json
{
  "stackTrace": [
    "UserService.ts",
    "DataRepository.ts"
  ],
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
  ]
}
```

**Why good**:
- ✅ Exact file names from stack
- ✅ Error code included
- ✅ Related components (UserService, DataRepository)
- ✅ Domain concepts (userLookup, findUser)
- ✅ Technical patterns (errorHandler, dataAccess)
- ✅ 9 keywords (within limit)

---

### Example 2: Feature Request (No Stack Trace)

**Directive**:
```
Add user list display with pagination.
Show user name, email, and status.
Update automatically when filters change.
```

**Output**:
```json
{
  "stackTrace": [],
  "keywords": [
    "userList",
    "userDisplay",
    "pagination",
    "userStatus",
    "emailField",
    "dataTable",
    "userManagement",
    "listComponent",
    "filterHandler"
  ]
}
```

**Why good**:
- ✅ Empty stack trace (no error)
- ✅ Feature keywords (userList, display)
- ✅ Technical requirements (pagination, dataTable)
- ✅ Domain concepts (userStatus, emailField)
- ✅ Single-token format (camelCase for compound concepts)
- ✅ 9 keywords (within limit)

---

### Example 3: Common Mistakes

**❌ Don't**:
- Add file extensions incorrectly: `"UserList"` instead of `"UserList.ts"`
- Guess files that might not exist
- Use generic terms: `"map"`, `"undefined"`, `"error"`
- Use language keywords: `"property"`, `"const"`, `"async"`
- Add too many keywords (40+)
- Use multi-word phrases with spaces: `"user data"`, `"array null check"`

**✅ Do**:
- Use exact file names from error messages
- Use specific component/function names: `"UserList"`, `"validateInput"`
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
