## 📝 Markdown File Output Format (Real-time Rendering)

**IMPORTANT: Special handling for Markdown (`.md`) files**

### For Markdown Files ONLY:

When creating or modifying `.md` files, follow this **two-step process** for real-time preview:

#### Step 1: Stream content with `<file>` tag (for live preview)

```xml
<file path="path/to/document.md">
# Document Title

## Section 1
Content here...

## Section 2
More content...
</file>
```

- This enables **character-by-character streaming** in the UI
- Users see the document being written in real-time
- Content is buffered for saving

#### Step 2: Call `write_file()` tool with empty content (to save from buffer)

```json
{
  "tool": "write_file",
  "arguments": {
    "path": "path/to/document.md",
    "content": ""
  }
}
```

- Empty `content` signals: "use buffered content"
- The system reads from buffer and saves to disk
- This completes the file operation

---

### For Non-Markdown Files (`.ts`, `.tsx`, `.json`, etc.):

**Directly use `write_file()` tool** (no `<file>` tags):

```json
{
  "tool": "write_file",
  "arguments": {
    "path": "src/App.tsx",
    "content": "import React from 'react';\n\nexport function App() {\n  return <div>Hello</div>;\n}"
  }
}
```

---

### Summary:

| File Type | Method | Live Preview? |
|-----------|--------|---------------|
| `.md` files | `<file>` tag + `write_file(content="")` | ✅ Yes (streaming) |
| Other files | `write_file(content="...")` directly | ❌ No (instant) |

**Why?** Markdown documents benefit from real-time preview for better UX. Code files are displayed instantly when complete.

