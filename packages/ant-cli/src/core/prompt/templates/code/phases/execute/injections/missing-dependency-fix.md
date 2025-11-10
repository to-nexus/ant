## 🚨 CRITICAL: MISSING DEPENDENCY FIX PROTOCOL

**Your task contains "MISSING DEPENDENCY" errors. Follow this EXACT protocol:**

---

### ✅ **CORRECT APPROACH - Use npm install with package names:**

#### **Step 1: Identify Missing Packages**

From error messages, extract package names:
- `Cannot find module 'openai'` → Need: `openai`
- `Cannot find module 'axios'` → Need: `axios`
- `Cannot find module '@types/react'` → Need: `@types/react` (devDependency)

#### **Step 2: Output npm install command with ALL missing packages**

**For regular dependencies:**
```bash
npm install openai axios
```

**For dev dependencies (types):**
```bash
npm install -D @types/react @types/node
```

**IMPORTANT:**
- ✅ List ALL missing packages in ONE command
- ✅ npm automatically saves to package.json (npm 5+)
- ✅ Use `-D` flag for @types packages
- ❌ DO NOT run `npm install` without package names

#### **Step 3: System Auto-Installs**

After you output the command:
- ✅ System executes: `npm install openai axios`
- ✅ Packages are installed AND saved to package.json
- ✅ Saved to package-lock.json
- ✅ Error is resolved

---

### 📋 **SELF-CHECK BEFORE OUTPUT:**

- [ ] Did I identify ALL missing packages from error messages?
- [ ] Did I include ALL package names in the npm install command?
- [ ] Did I use `-D` flag for @types packages?
- [ ] Did I separate regular deps and dev deps into different commands?

**If ANY checkbox is unchecked, FIX IT before outputting!**

---

### ⚠️ **COMMON MISTAKES TO AVOID:**

❌ **Mistake 1: Running npm install without package names**
```bash
npm install  ← WRONG! Doesn't add any packages
```

❌ **Mistake 2: Installing one package at a time**
```bash
npm install openai
npm install axios
npm install cors
```
This works but is inefficient. Better:
```bash
npm install openai axios cors
```

❌ **Mistake 3: Forgetting -D for @types packages**
```bash
npm install @types/react  ← WRONG! Should be -D (devDependency)
```

✅ **Correct: List all packages with proper flags**
```bash
npm install openai axios cors
npm install -D @types/react @types/node
```

---

### 🎯 **FINAL REMINDER:**

**For MISSING DEPENDENCY errors:**
1. ✅ Extract ALL missing package names from errors
2. ✅ Output: `npm install <pkg1> <pkg2> <pkg3>`
3. ✅ Use `-D` flag for @types packages
4. ❌ DO NOT run `npm install` without package names

**npm automatically saves to package.json (npm 5+)!**

