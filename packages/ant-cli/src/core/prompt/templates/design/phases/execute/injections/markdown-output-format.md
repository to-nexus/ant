## 📝 Markdown File Output Format (Real-time Rendering)

**CRITICAL: You MUST wrap ALL content in `<file>` tags for real-time streaming!**

### Output Format:

```xml
<file path="outputs/design/system-design.md">
# System Design Document

## Chapter 1: Architecture
Content here...

## Chapter 2: Design System
More content...
</file>
```

### Rules:

1. **ALWAYS use `<file>` tags** - This enables real-time preview in the UI
2. **Stream content character-by-character** - Users see the document being written live
3. **Use exact path**: `outputs/design/system-design.md`
4. **Close the tag when done**: `</file>` - This saves the file automatically

### For Continuation Tasks (Appending):

When adding to an existing document, use `<append>`:

```xml
<append path="outputs/design/system-design.md">

## Chapter 3: Additional Content
More chapters here...
</append>
```

---

**NO TOOL CALLING NEEDED!** The `<file>` and `<append>` tags handle everything automatically.
