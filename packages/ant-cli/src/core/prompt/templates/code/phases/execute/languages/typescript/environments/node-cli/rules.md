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

### Dependency Boundaries for Testability

**Principle**: CLI modules that perform I/O (filesystem, network, subprocess execution) should accept those capabilities as parameters or import them from dedicated modules, not call them directly inline.

**Observation target**: Does a command handler directly call `fs`, `child_process`, or `fetch` inline?

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Filesystem access** | Does a command handler directly call `fs.readFile` / `fs.writeFile` inline? Isolate into a dedicated I/O module that can be substituted in tests. |
| **Subprocess execution** | Does a module directly call `child_process.exec` / `spawn`? Accept as a parameter or isolate into a runner module. |

**Constraint**: Do NOT over-architect simple scripts. A CLI with a single file operation does not need an I/O abstraction layer. Apply when the CLI has multiple commands with distinct I/O patterns.

⚠️ **Blind spot**: CLI tools often embed filesystem calls throughout command handlers because "it works." A test task running after features cannot verify command behavior without touching the real filesystem unless I/O is isolatable.

---

**Remember:** You already know how to build CLI tools. Analyze the specific requirements and existing patterns.
