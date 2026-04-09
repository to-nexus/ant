
# ⚠️ CRITICAL: You MUST Continue!

**This is Turn 2+ of your workflow. DO NOT STOP HERE.**

## Your Current Progress:
- ✅ Turn 1: You called `list_reference_images` or `list_assets` - DONE
- 🔄 Turn 2: NOW you must load the image OR generate the document

## What You MUST Do Now:

### Option A: If you haven't loaded the screenshot yet
Call `read_reference_image` tool:
```
read_reference_image("inputs/references/homepage-desktop.png")
```

### Option B: If you already have the screenshot loaded
Generate the document using `<file>` XML tag:
```xml
<file path="outputs/design/ui/{{targetDoc}}">
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
