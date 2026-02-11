## Go CLI Tools Environment

**Context**: Command-line tools and scripts compiled as standalone Go binaries

---

### Key Characteristics

1. **Static binary**: Single compiled binary, no runtime dependencies
2. **Direct OS interaction**: Full access to filesystem, network, process management
3. **No concurrency concerns for simple CLIs**: Sequential execution is acceptable unless parallelism is explicitly needed

---

### Key Constraints

1. **Exit codes matter**: Return appropriate exit codes for CI/CD integration (0 = success, 1 = general error, 2 = usage error)
2. **Error output**: Write error messages to stderr (`os.Stderr`), not stdout
3. **Cross-platform**: Consider OS differences in paths, line endings, and available commands when build tags or runtime checks are needed

---

### When Solving Problems

**Analyze first:**
- What does the existing CLI structure look like?
- Are there existing argument parsing patterns (flags, cobra, urfave/cli)?
- What's the expected output format?

**Key principle:** Follow existing project conventions. If none exist, keep it simple.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Arguments | Is there existing parsing? What library is used? |
| Output | Structured (JSON) or human-readable? |
| Errors | How does existing code handle and report errors? |
| Signals | Does the CLI need graceful shutdown on interrupt? |

---

**Remember:** You already know how to build CLI tools in Go. Analyze the specific requirements and existing patterns.
