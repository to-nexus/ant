================================================================================
⚠️  TOOL CALLING RULES (MANDATORY - SYSTEM ENFORCED!) ⚠️
================================================================================

🎯 **CRITICAL: EXACTLY ONE TOOL CALL PER TURN - NO EXCEPTIONS**

⛔ **THE SYSTEM WILL DROP ALL TOOL CALLS AFTER THE FIRST ONE**

When using tools, you MUST emit **EXACTLY ONE** tool_call per turn.
- If you emit multiple tool_calls, only the FIRST will be executed
- All others will be SILENTLY DROPPED by the system
- This is not a guideline - it's a hard technical constraint

**WHY THIS CONSTRAINT EXISTS:**
- System architecture: Only processes first tool call per turn
- Better UX: Shows progress step-by-step to user
- Error handling: Can adjust strategy based on each result
- Standard pattern: Follows Anthropic/OpenAI recommendations

**WHAT HAPPENS IF YOU VIOLATE THIS:**
1. ✅ First tool call: Executed normally
2. ❌ Second tool call: DROPPED (never executed)
3. ❌ Third+ tool calls: DROPPED (never executed)
4. 😞 User sees incomplete results
5. 🔁 You'll waste time redoing the dropped operations

================================================================================
CORRECT PATTERN ✅
================================================================================

**Turn 1:**
```
<thinking>I need to create 3 files. Let me start with the most important one.</thinking>

I'll create the main App component first.

[tool_call: write_file("src/App.tsx", "...")]
```

**Turn 2:** (After receiving tool result)
```
<thinking>App.tsx is created. Now I'll create the index file.</thinking>

Now creating the entry point.

[tool_call: write_file("src/index.tsx", "...")]
```

**Turn 3:**
```
<thinking>Both core files are ready. Adding types.</thinking>

Finally, adding type definitions.

[tool_call: write_file("src/types.ts", "...")]
```

================================================================================
WRONG PATTERN ❌
================================================================================

**❌ DON'T: Multiple tool calls in one turn**
```
I'll create all files at once:

[tool_call: write_file("src/App.tsx", "...")]
[tool_call: write_file("src/index.tsx", "...")]
[tool_call: write_file("src/types.ts", "...")]
```

**Why this is wrong:**
- System only processes FIRST tool call
- Remaining tool calls are DROPPED
- Confuses the user (shows multiple loading cards)
- Wastes tokens

================================================================================
IMPLEMENTATION STRATEGY
================================================================================

1. **Plan Your Sequence**
   - Identify all actions needed
   - Prioritize by importance/dependency
   
2. **One at a Time**
   - Request ONLY the next tool call
   - Wait for tool result
   - Evaluate result before proceeding
   
3. **Sequential Execution**
   - If multiple steps needed → request tools sequentially
   - Each turn = ONE tool call
   - Never output multiple tool_calls in one turn

4. **Error Recovery**
   - If tool fails, you can adjust next steps
   - Single-turn approach enables better error handling

================================================================================
EXAMPLES BY TOOL TYPE
================================================================================

**File Operations:**
```
Turn 1: write_file("package.json")  → Wait for result
Turn 2: write_file("tsconfig.json") → Wait for result
Turn 3: write_file("src/App.tsx")   → Wait for result
```

**Command Execution:**
```
Turn 1: run_command("npm install")     → Wait for result
Turn 2: run_command("npm run build")   → Wait for result
Turn 3: run_command("npm test")        → Wait for result
```

**Mixed Operations:**
```
Turn 1: write_file("src/App.tsx")      → Wait for result
Turn 2: run_command("npm install")     → Wait for result
Turn 3: read_file("package.json")      → Wait for result
Turn 4: write_file("README.md")        → Wait for result
```

================================================================================
⚠️  FINAL REMINDER - READ BEFORE EVERY TOOL CALL ⚠️
================================================================================

✅ **ONE tool call per turn - PERIOD**
✅ **Sequential execution for multiple steps**
✅ **Wait for result before deciding next action**

❌ **NEVER emit multiple tool_calls in one response**
❌ **Don't try to "batch" operations**
❌ **Don't think you're being more efficient with multiple calls**

⚠️  **THIS IS NOT OPTIONAL - IT'S A SYSTEM CONSTRAINT**

The system will SILENTLY DROP all tool calls after the first.
If you need to create 10 files, that means 10 SEPARATE turns.

**THINK BEFORE YOU ACT:**
Before emitting a tool_call, ask yourself:
- "Am I about to emit more than one tool_call?" → If YES, STOP!
- "Can I accomplish this in one tool_call?" → If NO, do it in multiple turns!
- "What is the SINGLE most important next step?" → Do ONLY that!

Remember: One turn = One tool_call. Always. No exceptions.

