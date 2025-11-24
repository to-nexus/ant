## 🌐🖥️ Fullstack Framework Environment Rules

**You are working on FULLSTACK FRAMEWORK code (Next.js, Remix, SvelteKit, Nuxt)**

This code runs **BOTH on server (Node.js) AND client (browser)** depending on the file location and context.

---

### ✅ Environment Detection Confirmed

**Detected indicators:**
- Project type: Fullstack (SSR/SSG)
- Framework: Next.js/Remix/SvelteKit/Nuxt
- Hybrid execution: Server-side rendering + Client-side hydration
- API Routes: Built-in serverless functions
- Target locations: `app/`, `pages/`, `routes/`, `components/`

---

### ⚠️ CRITICAL: Dual Environment Awareness

**Fullstack frameworks have TWO execution contexts:**

1. **Server-side (Node.js runtime)**
   - API routes: `app/api/`, `pages/api/`, `routes/api/`
   - Server components: `app/` directory (Next.js 13+ App Router)
   - Server loaders/actions: `routes/` (Remix)
   - getServerSideProps, getStaticProps (Next.js Pages Router)

2. **Client-side (Browser runtime)**
   - Client components: `'use client'` directive (Next.js App Router)
   - Page components: `pages/` (Next.js Pages Router)
   - Client hooks: `useState`, `useEffect`, etc.
   - Browser event handlers: `onClick`, `onChange`, etc.

**You MUST identify which context you're in before choosing APIs!**

---

### 🎯 Next.js Specific Rules

#### 1. **Next.js App Router (app/ directory)**

```typescript
// ✅ Server Component (default in app/ directory)
// File: app/dashboard/page.tsx
import fs from 'fs/promises'; // ✅ Node.js modules OK (runs on server)
import path from 'path';

export default async function DashboardPage() {
  // ✅ Can fetch data directly (no API route needed)
  const data = await fs.readFile(path.join(process.cwd(), 'data.json'), 'utf-8');
  const config = JSON.parse(data);
  
  return <div>{config.title}</div>;
}

// ✅ Client Component (explicit 'use client' directive)
// File: app/dashboard/client-widget.tsx
'use client';

import { useState, useEffect } from 'react'; // ✅ Client hooks

// ❌ CANNOT import Node.js modules after 'use client'
// import fs from 'fs'; // ❌ ERROR!

export default function ClientWidget() {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    // ✅ Fetch from API route
    fetch('/api/data').then(r => r.json()).then(setData);
  }, []);
  
  return <div>{data?.title}</div>;
}
```

#### 2. **Next.js API Routes (Serverless Functions)**

```typescript
// ✅ API Route (runs in Node.js)
// File: app/api/users/route.ts (App Router)
import fs from 'fs/promises'; // ✅ Node.js modules OK
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const data = await fs.readFile('./users.json', 'utf-8');
  return NextResponse.json(JSON.parse(data));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  // Process data, save to database, etc.
  return NextResponse.json({ success: true });
}

// ✅ Pages Router API Route
// File: pages/api/users.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises'; // ✅ Node.js modules OK

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const data = await fs.readFile('./users.json', 'utf-8');
    res.status(200).json(JSON.parse(data));
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
```

#### 3. **Next.js Environment Variables**

```typescript
// ✅ Server-side only (no prefix)
// Available in: Server Components, API Routes, getServerSideProps
const dbUrl = process.env.DATABASE_URL;
const apiSecret = process.env.API_SECRET;

// ✅ Client-side exposed (NEXT_PUBLIC_ prefix)
// Available in: Client Components, Browser
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
const publicKey = process.env.NEXT_PUBLIC_STRIPE_KEY;

// ⚠️ NEVER expose secrets with NEXT_PUBLIC_ prefix!
// ❌ BAD:
const apiKey = process.env.NEXT_PUBLIC_API_SECRET; // ❌ Exposed to browser!

// ✅ GOOD:
const apiKey = process.env.API_SECRET; // ✅ Server-only
```

#### 4. **Next.js Data Fetching**

```typescript
// ✅ Server Component - Direct data fetching (App Router)
export default async function Page() {
  const res = await fetch('https://api.example.com/data', {
    next: { revalidate: 3600 } // Cache for 1 hour
  });
  const data = await res.json();
  return <div>{data.title}</div>;
}

// ✅ Client Component - Use React hooks (App Router)
'use client';
export default function Page() {
  const [data, setData] = useState(null);
  
  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(setData);
  }, []);
  
  return <div>{data?.title}</div>;
}

// ✅ getServerSideProps (Pages Router)
export async function getServerSideProps() {
  const data = await fetch('https://api.example.com/data').then(r => r.json());
  return { props: { data } };
}

// ✅ getStaticProps (Pages Router)
export async function getStaticProps() {
  const data = await fetch('https://api.example.com/data').then(r => r.json());
  return { props: { data }, revalidate: 3600 };
}
```

---

### 🎯 Remix Specific Rules

#### 1. **Remix Loaders and Actions**

```typescript
// ✅ Loader (runs on server)
// File: routes/dashboard.tsx
import { json } from '@remix-run/node';
import type { LoaderFunction } from '@remix-run/node';
import fs from 'fs/promises'; // ✅ Node.js modules OK

export const loader: LoaderFunction = async ({ request }) => {
  const data = await fs.readFile('./data.json', 'utf-8');
  return json(JSON.parse(data));
};

// ✅ Action (runs on server)
export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const name = formData.get('name');
  // Process form submission
  return json({ success: true });
};

// ✅ Component (runs on client after hydration)
export default function Dashboard() {
  const data = useLoaderData(); // Data from loader
  
  // ❌ CANNOT use Node.js modules here!
  // import fs from 'fs'; // ❌ ERROR!
  
  return (
    <div>
      <h1>{data.title}</h1>
      <Form method="post">
        <input name="name" />
        <button type="submit">Submit</button>
      </Form>
    </div>
  );
}
```

#### 2. **Remix Environment Variables**

```typescript
// ✅ Server-side only
// Available in: loaders, actions, server code
const dbUrl = process.env.DATABASE_URL;

// ✅ Client-side exposed (via loader)
export const loader: LoaderFunction = async () => {
  return json({
    publicApiUrl: process.env.PUBLIC_API_URL // Expose only what's needed
  });
};

export default function Component() {
  const { publicApiUrl } = useLoaderData();
  // Use publicApiUrl in client code
}
```

---

### 🎯 SvelteKit Specific Rules

#### 1. **SvelteKit Load Functions**

```typescript
// ✅ +page.server.ts (runs on server only)
import type { PageServerLoad } from './$types';
import fs from 'fs/promises'; // ✅ Node.js modules OK

export const load: PageServerLoad = async () => {
  const data = await fs.readFile('./data.json', 'utf-8');
  return { data: JSON.parse(data) };
};

// ✅ +page.ts (runs on both server and client)
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  // ❌ CANNOT use Node.js modules here!
  const response = await fetch('/api/data');
  return { data: await response.json() };
};

// ✅ +page.svelte (client-side component)
<script lang="ts">
  export let data; // From load function
  
  // ❌ CANNOT use Node.js modules here!
</script>
```

---

### 🔍 Decision Tree: Can I Use Node.js Modules?

```
Is the file an API route? (app/api/, pages/api/, routes/api/)
├─ YES → ✅ Full Node.js access
└─ NO → Continue...

Is the file a Server Component? (Next.js App Router)
├─ YES → ✅ Full Node.js access
└─ NO → Continue...

Is the file a loader/action? (Remix)
├─ YES → ✅ Full Node.js access
└─ NO → Continue...

Is the file a .server.ts file? (SvelteKit)
├─ YES → ✅ Full Node.js access
└─ NO → Continue...

Is the file a getServerSideProps/getStaticProps? (Next.js Pages)
├─ YES → ✅ Full Node.js access
└─ NO → Continue...

DEFAULT: Client-side component
└─ ❌ NO Node.js modules! Use browser APIs only.
```

---

### ⚡ Common Mistakes to Avoid

```typescript
// ❌ MISTAKE 1: Using Node.js modules in client components
'use client';
import fs from 'fs'; // ❌ ERROR!

export default function Component() {
  // ...
}

// ✅ CORRECT: Move logic to API route or Server Component
// Server Component (Next.js App Router)
import fs from 'fs/promises'; // ✅ OK

export default async function ServerComponent() {
  const data = await fs.readFile('./data.json', 'utf-8');
  return <div>{data}</div>;
}

// ❌ MISTAKE 2: Exposing server-only env vars to client
const apiSecret = process.env.NEXT_PUBLIC_API_SECRET; // ❌ Exposed!

// ✅ CORRECT: Keep secrets server-side
const apiSecret = process.env.API_SECRET; // ✅ Server-only

// ❌ MISTAKE 3: Using browser APIs in server components
import fs from 'fs/promises';

export default async function ServerComponent() {
  localStorage.setItem('data', 'value'); // ❌ ERROR! (no localStorage on server)
  const data = await fs.readFile('./data.json', 'utf-8'); // ✅ OK
  return <div>{data}</div>;
}

// ✅ CORRECT: Use browser APIs only in client components
'use client';

export default function ClientComponent() {
  localStorage.setItem('data', 'value'); // ✅ OK
  // Cannot use fs here!
}
```

---

### 📋 Final Checklist

- [ ] Identified if code runs on server, client, or both
- [ ] Used Node.js modules ONLY in server context (API routes, Server Components, loaders, .server.ts)
- [ ] Used browser APIs ONLY in client context (Client Components, hooks, event handlers)
- [ ] Environment variables: Secrets are server-only, public vars use framework-specific prefixes
- [ ] Data fetching: Server data fetching in Server Components/loaders, client data fetching with fetch
- [ ] No mixing: No `localStorage` in Server Components, no `fs` in Client Components

**Fullstack frameworks blur the line between server and client—always know which context you're in!**

