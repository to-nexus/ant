## 🛠️ Node.js CLI Tools Environment

**Context**: Command-line tools and scripts executed directly in Node.js runtime

---

### Key Characteristics

1. **Full Node.js API access**: All built-in modules available
2. **No concurrency concerns**: Sync operations are acceptable (unlike servers)
3. **User interaction**: stdin/stdout, progress indicators, colored output

---

### Key Constraints

1. **Exit codes matter**: Return appropriate exit codes for CI/CD integration
2. **Error messages**: Write to stderr, not stdout
3. **Cross-platform**: Consider Windows vs Unix differences (paths, commands)

---

### When Solving Problems

**Analyze first:**
- What does the existing CLI structure look like?
- Are there existing argument parsing patterns?
- What's the expected output format?

**Key principle:** Follow existing project conventions. If none exist, keep it simple.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Arguments | Is there existing parsing? What format? |
| Output | Structured (JSON) or human-readable? |
| Errors | How does existing code handle errors? |
| Progress | Is there existing progress indication? |

---

**Remember:** You already know how to build CLI tools. Analyze the specific requirements and existing patterns.
