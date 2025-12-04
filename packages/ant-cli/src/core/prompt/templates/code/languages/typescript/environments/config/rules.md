## ⚙️ Configuration Files Environment

**Context**: Build tool configuration files (vite.config.ts, webpack.config.js, etc.)

---

### Key Characteristics

1. **Runs in Node.js**: Full Node.js API access (fs, path, etc.)
2. **Build time execution**: Runs before app, not at runtime
3. **Tool-specific**: Each build tool has its own API

---

### Key Constraints

1. **Match existing patterns**: Follow the project's established configuration style
2. **Tool version matters**: APIs differ between versions
3. **Path handling**: Use proper path resolution for cross-platform support

---

### When Solving Problems

**Analyze first:**
- What build tool is this project using?
- What's the existing configuration structure?
- What version of the tool is installed?

**Key principle:** Look at existing config files in the project first. Follow established patterns.

---

### Common Considerations

| Concern | Things to Check |
|---------|-----------------|
| Alias/paths | Both tsconfig.json AND build tool config need alignment |
| Environment vars | How does the existing config handle them? |
| Plugins | What plugins are already installed? |
| Build output | What's the expected output structure? |

---

**Remember:** You already know these build tools. Check the existing configuration and extend it appropriately.
