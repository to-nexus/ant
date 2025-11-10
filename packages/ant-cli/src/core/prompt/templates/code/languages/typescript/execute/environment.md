## ⚠️ CRITICAL: NODE.js vs BROWSER Environment Rules

**Before writing ANY code, you MUST identify the execution environment!**

---

### 🌐 BROWSER Environment Detection

**Browser code locations:**
- `src/components/` - React/Vue components
- `src/pages/` - Page components
- `src/hooks/` - React hooks
- `src/utils/` - Frontend utilities
- `src/stores/` - State management (Zustand, Pinia, etc.)
- `src/lib/` - Frontend libraries
- Any `.tsx`, `.jsx` files in `src/`

**Indicators:**
- Project uses: `vite`, `react`, `@vitejs/plugin-react`, `vue`
- `index.html` entry point exists
- `package.json` contains frontend frameworks

---

### ❌ BROWSER ENVIRONMENT - FORBIDDEN

**Node.js built-in modules are FORBIDDEN in browser code:**

```typescript
// ❌ WRONG - Will cause "Cannot find module 'fs'" error!
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import http from 'http';
import https from 'https';
import stream from 'stream';
import buffer from 'buffer';
import process from 'process';
import util from 'util';

// ❌ WRONG - Browser cannot access filesystem!
fs.writeFileSync('data.json', JSON.stringify(data));
fs.readFileSync('./config.json', 'utf-8');
```

**Why this fails:**
- Browsers run in a **sandboxed environment** with NO filesystem access
- Node.js built-ins don't exist in browser runtime
- Build tools (Vite, Webpack) CANNOT polyfill `fs`, `path`, etc. for security reasons

---

### ✅ BROWSER ENVIRONMENT - CORRECT ALTERNATIVES

#### 1. **Data Storage** (instead of `fs.writeFileSync`)

```typescript
// ✅ For client-side data persistence:
localStorage.setItem('userData', JSON.stringify(data));
const data = JSON.parse(localStorage.getItem('userData') || '{}');

// ✅ For larger data (>5MB):
// Use IndexedDB
const db = await openDB('myDatabase', 1);
await db.put('store', data, 'key');
const data = await db.get('store', 'key');
```

#### 2. **File Operations** (instead of `fs.readFileSync`)

```typescript
// ✅ Load data from backend API:
const response = await fetch('/api/data');
const data = await response.json();

// ✅ User file uploads (File API):
const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      // Process file content
    };
    reader.readAsText(file);
  }
};
```

#### 3. **Path Operations** (instead of `path.join`)

```typescript
// ✅ For URL construction:
const assetUrl = new URL('./assets/image.png', import.meta.url).href;

// ✅ For path manipulation:
const joinPaths = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
const basePath = '/api/v1';
const endpoint = joinPaths(basePath, 'users', userId); // '/api/v1/users/123'
```

#### 4. **Environment Variables** (instead of `process.env` in code)

```typescript
// ✅ Vite projects:
const apiUrl = import.meta.env.VITE_API_URL;
const isDev = import.meta.env.DEV;

// ✅ Create React App:
const apiUrl = process.env.REACT_APP_API_URL;

// ✅ Next.js:
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
```

#### 5. **Random Values** (instead of `crypto.randomBytes`)

```typescript
// ✅ For random IDs:
const id = crypto.randomUUID(); // Native browser API

// ✅ For random values:
const array = new Uint8Array(16);
crypto.getRandomValues(array);
```

---

### 🖥️ NODE.js Environment Detection

**Node.js code locations:**
- `server/` - Backend server code
- `scripts/` - Build/utility scripts
- `*.config.ts`, `*.config.js` - Config files (vite.config.ts, etc.)
- `api/` - API routes (if backend)
- Root-level utility scripts

**Indicators:**
- File runs in Node.js runtime (not bundled for browser)
- Config files for build tools
- Backend server code

---

### ✅ NODE.js ENVIRONMENT - ALLOWED

```typescript
// ✅ OK in Node.js server/scripts/config files
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// ✅ Filesystem operations
const data = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8');
fs.writeFileSync('./output.json', JSON.stringify(result));

// ✅ Path operations
const fullPath = path.resolve(__dirname, '../dist');
const ext = path.extname(filename);

// ✅ Crypto operations
const hash = crypto.createHash('sha256').update(data).digest('hex');
```

---

### 🔍 SELF-CHECK BEFORE OUTPUT

**For EVERY file you generate:**

1. **Identify environment:**
   - [ ] Is this file in `src/components/`, `src/pages/`, `src/hooks/`, `src/utils/`?
   - [ ] Will this file be bundled and run in a browser?

2. **Check imports:**
   - [ ] Did I import `fs`, `path`, `crypto`, `os`, or other Node.js built-ins?
   - [ ] If YES → Is this a Node.js file (config/script/server)?
   - [ ] If NO → REMOVE the import and use browser alternatives!

3. **Verify APIs:**
   - [ ] For data storage → Use `localStorage`/`IndexedDB`/backend API
   - [ ] For file operations → Use `File API`/`fetch`/backend API
   - [ ] For path operations → Use `URL` or string manipulation
   - [ ] For environment config → Use `import.meta.env` or `process.env.REACT_APP_*`

---

### ⚡ COMMON MISTAKES TO AVOID

```typescript
// ❌ MISTAKE 1: Using Node.js fs in frontend utils
// File: src/utils/storage.ts
import fs from 'fs';  // ❌ WRONG!
export const saveData = (data: any) => {
  fs.writeFileSync('data.json', JSON.stringify(data));  // ❌ CRASH!
};

// ✅ CORRECT:
export const saveData = (data: any) => {
  localStorage.setItem('data', JSON.stringify(data));  // ✅ Works!
};
```

```typescript
// ❌ MISTAKE 2: Using Node.js path in React components
// File: src/components/FileUploader.tsx
import path from 'path';  // ❌ WRONG!
const ext = path.extname(file.name);  // ❌ CRASH!

// ✅ CORRECT:
const ext = file.name.split('.').pop();  // ✅ Works!
// OR:
const ext = file.name.substring(file.name.lastIndexOf('.'));  // ✅ Works!
```

```typescript
// ❌ MISTAKE 3: Confusing config files vs source files
// File: vite.config.ts (Node.js environment)
import path from 'path';  // ✅ OK! Config files run in Node.js

// File: src/utils/helpers.ts (Browser environment)
import path from 'path';  // ❌ WRONG! This will be bundled for browser
```

---

### 📋 FINAL CHECKLIST

Before outputting ANY file:

- [ ] I identified if this file runs in **browser** or **Node.js**
- [ ] I verified NO Node.js built-ins (`fs`, `path`, etc.) in browser code
- [ ] I used browser APIs (`localStorage`, `fetch`, `URL`) instead
- [ ] I checked ALL imports at the top of the file
- [ ] If unsure, I assumed **browser environment** (safer default)

**If you violate these rules, the generated code WILL crash at runtime!**

