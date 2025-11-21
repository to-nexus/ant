## 🚨 MISSING DEPENDENCY FIX

**Your task contains "MISSING DEPENDENCY" errors.**

### Quick Fix Protocol:

**1. Extract package names from error messages:**
```
"Cannot find module 'openai'" → openai
"Cannot find module '@types/react'" → @types/react
```

**2. Install ALL missing packages in ONE command:**
```bash
npm install openai axios cors
npm install -D @types/react @types/node
```

### Critical Rules:

✅ **DO:**
- List ALL missing packages in one command
- Use `-D` flag for @types packages (devDependencies)
- npm automatically saves to package.json (npm 5+)

❌ **DON'T:**
- Run `npm install` without package names (does nothing!)
- Install packages one by one (inefficient)

### Example:

**Error:**
```
Cannot find module 'openai'
Cannot find module '@types/node'
```

**Fix:**
```bash
npm install openai
npm install -D @types/node
```
