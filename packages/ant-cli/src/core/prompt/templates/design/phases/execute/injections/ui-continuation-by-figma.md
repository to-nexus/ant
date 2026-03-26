
# ⚠️ CRITICAL: You MUST Continue!

**This is Turn 2+ of your workflow. DO NOT STOP HERE.**

## Your Current Progress:
- ✅ Turn 1: You called Figma MCP tools (`figma_get_design_context`, `figma_get_variable_defs`, etc.) - DONE
- 🔄 Turn 2: NOW you must generate the document using the extracted data

## What You MUST Do Now:

### Option A: If you need more Figma data
Call additional MCP tools to get remaining design context:
```
figma_get_design_context(fileKey, nodeId)
figma_get_variable_defs(fileKey, nodeId)
```

### Option B: If you already have enough Figma data
Generate the document using `<file>` XML tag:
```xml
<file path="outputs/design/{{targetDoc}}">
<!-- START_SECTION: 1 -->
# Document Title
...content...
<!-- END_SECTION -->
</file>
```

## ⚠️ FAILURE CONDITIONS:
- ❌ Responding with only text explanation → TASK FAILS
- ❌ Saying "I will do X" without doing it → TASK FAILS
- ❌ Stopping without generating `<file>` → TASK FAILS

**You MUST output either a tool_use block OR a <file> XML tag!**
