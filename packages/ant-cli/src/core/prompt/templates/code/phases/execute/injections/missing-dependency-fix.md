````markdown
## 🚨 MISSING DEPENDENCY FIX

**Task contains "MISSING DEPENDENCY" errors.**

### Fix Protocol

**1. Extract package names from errors:**
```
"Cannot find module 'openai'" → openai
"Cannot find module '@types/react'" → @types/react
```

**2. Install ALL in ONE command:**
```bash
npm install openai axios cors
npm install -D @types/react @types/node
```

────────────────────────────────────────────────────────────────────────────────

### Rules

✅ **DO:**
- List all missing packages in one command
- Use `-D` for @types packages
- npm 5+ auto-saves to package.json

❌ **DON'T:**
- Run `npm install` without package names
- Install one by one

────────────────────────────────────────────────────────────────────────────────

**Example:**
```
Error: Cannot find module 'openai'
Error: Cannot find module '@types/node'

Fix:
npm install openai
npm install -D @types/node
```

````
