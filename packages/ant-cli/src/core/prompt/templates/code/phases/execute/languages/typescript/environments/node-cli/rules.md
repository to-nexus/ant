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

---

### Design-Prescribed Dependency API Discovery

**Principle**: If a design-prescribed dependency's API is not in your training data, observe it before writing code — do NOT guess function names or type signatures.

**Protocol** (via `read_file` — index then drill-down):

1. `read_file("codebase/node_modules/{package}/package.json")` — find the `types` or `typings` entry point. For scoped packages: `read_file("codebase/node_modules/@scope/name/package.json")`
2. `read_file` the entry `.d.ts` — scan exported symbol names (this serves as the index)
3. If the `.d.ts` is large, use `list_files` to explore the package structure, then read specific sub-module `.d.ts` files relevant to your task

**Constraint**: If the package is not yet installed (`node_modules` does not contain it), inform the user that dependencies need to be installed first.

⚠️ **Blind spot**: Packages from the same organization are easily assumed to follow familiar conventions. Their actual exported types may differ — always verify by reading `.d.ts` files when uncertain.

---

**Remember:** You already know how to build CLI tools. Analyze the specific requirements and existing patterns.
