## 📝 File Output Format (XML Streaming)

**CRITICAL: Use ONLY XML tags for file operations. NO tool calls!**

### File Operations:

#### 1. Create New File (`<file>`)

```xml
<file path="path/to/document.md">
# Document Title

## Section 1
Content here...

## Section 2
More content...
</file>
```

- Use for **new files** that don't exist yet
- Content is streamed in real-time to the UI
- File is written to disk immediately upon completion

#### 2. Append to Existing File (`<append>`)

```xml
<append path="outputs/design/system-design.md">

## New Section
Additional content to add at the end...
</append>
```

- Use to **add content at the end** of an existing file
- Preserves all existing content
- New content is appended seamlessly

#### 3. Edit Existing File (`<edit>`)

```xml
<edit path="src/App.tsx">
<search>
const oldFunction = () => {
  console.log('old');
};
</search>
<replace>
const newFunction = () => {
  console.log('new');
};
</replace>
</edit>
```

- Use to **modify specific parts** of an existing file
- `<search>` must **exactly match** the content to replace (including whitespace)
- `<replace>` contains the new content

---

### ⚠️ CRITICAL RULES:

1. **NEVER use `<file>` on existing files** - it will overwrite everything!
2. **NEVER call tools** like `write_file()` - they are not available
3. **ALWAYS use `<append>`** for adding to existing files
4. **ALWAYS use `<edit>`** for modifying existing files
5. **ALL file operations happen via XML tags ONLY**

