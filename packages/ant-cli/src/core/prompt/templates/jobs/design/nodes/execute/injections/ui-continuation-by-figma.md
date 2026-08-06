
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
Write the document via a `create_file` tool call (the content streams to the user live as the call's arguments generate):
```
create_file(path="visual/ui/{{targetDoc}}", content="<!-- START_SECTION: 1 -->\n# Document Title\n...content...\n<!-- END_SECTION -->")
```

## ⚠️ FAILURE CONDITIONS:
- ❌ Responding with only text explanation → TASK FAILS
- ❌ Saying "I will do X" without doing it → TASK FAILS
- ❌ Stopping without calling `create_file` → TASK FAILS

**You MUST output a tool call — either a Figma MCP call (Option A) or the `create_file` call (Option B)!**
