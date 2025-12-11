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

### 🚨 CRITICAL: NEVER Output Tool Tags as Text

**FORBIDDEN**: Do NOT write `<tool_use>` tags inside markdown text blocks or code blocks.

### ❌ WRONG - Tool tags in text
```
Now I will install all dependencies:

<tool_use>
<name>run_command</name>
<parameters><command>npm install</command></parameters>
</tool_use>
```

### ✅ CORRECT - Tool tags directly
```
<tool_use>
<name>run_command</name>
<parameters><command>npm install</command></parameters>
</tool_use>
```

**Rule**: Tool calls must be standalone XML tags, NEVER embedded in text or markdown blocks.

