## 🌐 Browser Environment Rules

**You are working on BROWSER-SIDE code (SPA, React, Vue, Angular)**

This code will be **bundled and executed in web browsers**, NOT in Node.js runtime.

---

### ✅ Environment Detection Confirmed

**Detected indicators:**
- Project type: Browser (SPA)
- Frontend framework: React/Vue/Angular/Svelte
- Build tool: Vite/Webpack/Rollup
- Entry point: `index.html`
- Target locations: `src/components/`, `src/pages/`, `src/hooks/`, `src/stores/`

---

### ❌ FORBIDDEN: Node.js Built-in Modules

**These modules are FORBIDDEN in browser code:**

```typescript
// ❌ NEVER import these in browser code:
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
import child_process from 'child_process';
```

**Why:**
- Browsers run in a **sandboxed environment** with NO filesystem access
- Node.js built-ins don't exist in browser runtime
- Build tools CANNOT polyfill these modules for security reasons
- Code will crash with "Cannot find module" errors

---

### ✅ CORRECT: Browser APIs and Alternatives

#### 1. **Data Storage** (instead of `fs.writeFileSync`)

```typescript
// ✅ Client-side persistence:
localStorage.setItem('userData', JSON.stringify(data));
const data = JSON.parse(localStorage.getItem('userData') || '{}');

// ✅ For larger data (>5MB):
import { openDB } from 'idb';
const db = await openDB('myDatabase', 1);
await db.put('store', data, 'key');
const data = await db.get('store', 'key');

// ✅ For persistent files:
// Upload to backend via fetch/axios
const formData = new FormData();
formData.append('file', file);
await fetch('/api/upload', { method: 'POST', body: formData });
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

// ✅ Download files to user:
const blob = new Blob([data], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'data.json';
a.click();
URL.revokeObjectURL(url);
```

#### 3. **Path Operations** (instead of `path.join`)

```typescript
// ✅ URL construction:
const assetUrl = new URL('./assets/image.png', import.meta.url).href;

// ✅ Path manipulation:
const joinPaths = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/');
const endpoint = joinPaths('/api/v1', 'users', userId); // '/api/v1/users/123'

// ✅ File extension:
const ext = filename.split('.').pop();
const ext = filename.substring(filename.lastIndexOf('.') + 1);
```

#### 4. **Environment Variables**

```typescript
// ✅ Vite projects:
const apiUrl = import.meta.env.VITE_API_URL;
const isDev = import.meta.env.DEV;
const mode = import.meta.env.MODE; // 'development' | 'production'

// ✅ Create React App:
const apiUrl = process.env.REACT_APP_API_URL;

// ✅ Next.js (client-side):
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// ⚠️ IMPORTANT: Only env vars prefixed with VITE_/REACT_APP_/NEXT_PUBLIC_ are exposed to browser!
```

#### 5. **Random Values** (instead of `crypto.randomBytes`)

```typescript
// ✅ Random UUIDs:
const id = crypto.randomUUID(); // Native Web Crypto API

// ✅ Random bytes:
const array = new Uint8Array(16);
crypto.getRandomValues(array);

// ✅ Random hex string:
const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
```

#### 6. **HTTP Requests**

```typescript
// ✅ Fetch API (native):
const response = await fetch('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(userData)
});
const data = await response.json();

// ✅ Axios (library):
import axios from 'axios';
const { data } = await axios.post('/api/users', userData);

// ❌ NEVER use Node.js http/https modules in browser code!
```

---

### 🔍 Self-Check Before Output

**For EVERY file you generate:**

1. **Location check:**
   - [ ] Is this file in `src/components/`, `src/pages/`, `src/hooks/`, `src/stores/`, `src/utils/`?
   - [ ] Will this be bundled for browser? (If YES → apply browser rules)

2. **Import check:**
   - [ ] Did I import any Node.js built-ins (`fs`, `path`, `crypto`, `os`, `http`, etc.)?
   - [ ] If YES → STOP! Replace with browser alternatives above

3. **API check:**
   - [ ] For data persistence → `localStorage`/`IndexedDB`/backend API
   - [ ] For file operations → `File API`/`FileReader`/`fetch`
   - [ ] For path operations → `URL` API or string manipulation
   - [ ] For random values → `crypto.randomUUID()`/`crypto.getRandomValues()`
   - [ ] For HTTP → `fetch`/`axios`

---

### ⚡ Common Mistakes to Avoid

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
```

```typescript
// ❌ MISTAKE 3: Trying to read local files without user input
// File: src/utils/config.ts
import fs from 'fs';  // ❌ WRONG!
const config = fs.readFileSync('./config.json', 'utf-8');  // ❌ CRASH!

// ✅ CORRECT:
const response = await fetch('/config.json');  // ✅ Serve as static asset
const config = await response.json();

// OR: Use backend API
const config = await fetch('/api/config').then(r => r.json());
```

---

---

### 🔧 Dev Server Configuration

**CRITICAL: Framework plugins and port configuration**

#### ❌ Common Mistakes

```typescript
// ❌ MISTAKE 1: React + Vite without plugin
// File: vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  // ❌ Missing @vitejs/plugin-react!
  // React JSX/TSX files won't work!
});
```

```typescript
// ❌ MISTAKE 2: Hardcoded port number
// File: vite.config.ts
export default defineConfig({
  server: {
    port: 3000  // ❌ WRONG! Prevents CLI --port option
  }
});
```

#### ✅ CORRECT Configuration

```typescript
// ✅ CORRECT: React + Vite with plugin
// File: vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],  // ✅ MUST include!
  // server.port removed - let CLI control it
});

// package.json devDependencies:
// "@vitejs/plugin-react": "^4.2.1"  ← REQUIRED!
```

```typescript
// ✅ CORRECT: Vue + Vite
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()]  // ✅ MUST include for Vue!
});
```

```typescript
// ✅ CORRECT: Svelte + Vite
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()]  // ✅ MUST include for Svelte!
});
```

#### 📌 Framework Plugin Requirements

| Framework | Required Plugin | Package Name |
|-----------|----------------|--------------|
| React + Vite | `react()` | `@vitejs/plugin-react` |
| Vue + Vite | `vue()` | `@vitejs/plugin-vue` |
| Svelte + Vite | `svelte()` | `@sveltejs/vite-plugin-svelte` |
| Next.js | Built-in | No extra plugin needed |

#### 📌 Port Configuration Rules

**❌ DO NOT hardcode port numbers:**
- Prevents users from choosing their own port
- Breaks dev server UI port selection
- Causes conflicts with other services

**✅ CORRECT approaches:**
1. **Remove port config entirely** (recommended):
   ```typescript
   export default defineConfig({
     plugins: [react()]
     // No server.port - let CLI --port flag control it
   });
   ```

2. **Use environment variable as fallback:**
   ```typescript
   export default defineConfig({
     plugins: [react()],
     server: {
       port: process.env.PORT ? parseInt(process.env.PORT) : undefined
     }
   });
   ```

---

### 📋 Final Checklist

- [ ] NO Node.js built-ins (`fs`, `path`, `crypto`, `http`, etc.) imported
- [ ] Used browser APIs: `localStorage`, `fetch`, `FileReader`, `URL`, `crypto.randomUUID()`
- [ ] Environment variables use framework-specific prefixes (`VITE_`, `REACT_APP_`, `NEXT_PUBLIC_`)
- [ ] All file operations go through backend API or File API
- [ ] All data persistence uses `localStorage`/`IndexedDB` or backend
- [ ] **Framework plugin included** (`@vitejs/plugin-react`, `@vitejs/plugin-vue`, etc.)
- [ ] **NO hardcoded port** in dev server config

**If you violate these rules, the code WILL crash at runtime with "Cannot find module" errors!**

