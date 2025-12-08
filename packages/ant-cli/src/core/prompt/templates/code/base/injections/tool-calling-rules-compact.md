## ⚠️ CRITICAL: ONE TOOL CALL PER TURN

**SYSTEM CONSTRAINT**: The system drops all tool calls after the first one.

### Why This Exists
- System architecture: Only first tool call is executed
- Better UX: Shows step-by-step progress
- Error handling: Can adjust after each result

### Pattern
```
Turn 1: [tool_call: read_file("App.tsx")]      → Wait for result
Turn 2: [tool_call: search_code("Button")]     → Wait for result
Turn 3: [tool_call: run_command("npm test")]   → Wait for result
```

### ❌ WRONG
```
// All in one turn - ONLY FIRST will execute!
[tool_call: read_file("App.tsx")]
[tool_call: read_file("index.tsx")]     ← DROPPED
[tool_call: read_file("types.ts")]      ← DROPPED
```

### ✅ CORRECT
```
Turn 1: Read first file
Turn 2: Read second file
Turn 3: Read third file
```

**Rule**: One tool call per turn. If you need 10 operations, that's 10 separate turns. No exceptions.

