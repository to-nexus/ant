# Next.js Framework Profile

## App Router (Next.js 13+)
- **Use App Router** (`app/` directory) for new projects
- **Server Components by default** - add `'use client'` only when needed
- **File-based routing** with special files: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`

## Directory Structure
```
app/
├── layout.tsx          # Root layout (required)
├── page.tsx            # Home page
├── loading.tsx         # Loading UI
├── error.tsx           # Error boundary
├── not-found.tsx       # 404 page
├── (auth)/             # Route group (doesn't affect URL)
│   ├── login/
│   │   └── page.tsx
│   └── register/
│       └── page.tsx
└── api/
    └── users/
        └── route.ts    # API route
```

## Server vs Client Components
```typescript
// ✅ Server Component (default)
// - Can fetch data directly
// - Can access backend resources
// - Cannot use hooks or browser APIs
async function UserList() {
  const users = await db.users.findMany();
  return <div>{users.map(u => <User key={u.id} user={u} />)}</div>;
}

// ✅ Client Component
// - Add 'use client' directive
// - Can use hooks and browser APIs
// - Can handle interactivity
'use client';

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

## Data Fetching
```typescript
// ✅ Server Component: Direct async/await
async function UserProfile({ params }: { params: { id: string } }) {
  const user = await fetch(`https://api.example.com/users/${params.id}`)
    .then(res => res.json());
  
  return <div>{user.name}</div>;
}

// ✅ Client Component: Use React Query or SWR
'use client';

import useSWR from 'swr';

export function UserProfile({ id }: { id: string }) {
  const { data, error } = useSWR(`/api/users/${id}`, fetcher);
  
  if (error) return <div>Failed to load</div>;
  if (!data) return <div>Loading...</div>;
  
  return <div>{data.name}</div>;
}
```

## Routing and Navigation
```typescript
// ✅ Use Link for client-side navigation
import Link from 'next/link';

<Link href="/about">About</Link>
<Link href={`/users/${user.id}`}>Profile</Link>

// ✅ Use useRouter for programmatic navigation
'use client';

import { useRouter } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  
  const handleSubmit = async (data) => {
    await login(data);
    router.push('/dashboard');
  };
  
  return <form onSubmit={handleSubmit}>...</form>;
}

// ✅ Dynamic routes: [id]/page.tsx
export default async function UserPage({ 
  params 
}: { 
  params: { id: string } 
}) {
  const user = await getUser(params.id);
  return <div>{user.name}</div>;
}
```

## API Routes
```typescript
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';

// GET /api/users
export async function GET(request: NextRequest) {
  const users = await db.users.findMany();
  return NextResponse.json(users);
}

// POST /api/users
export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await db.users.create({ data: body });
  return NextResponse.json(user, { status: 201 });
}

// app/api/users/[id]/route.ts
// GET /api/users/:id
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await db.users.findUnique({ where: { id: params.id } });
  if (!user) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(user);
}
```

## Metadata and SEO
```typescript
// ✅ Static metadata
export const metadata = {
  title: 'My App',
  description: 'Welcome to my app',
};

// ✅ Dynamic metadata
export async function generateMetadata({ params }: { params: { id: string } }) {
  const user = await getUser(params.id);
  
  return {
    title: user.name,
    description: user.bio,
    openGraph: {
      title: user.name,
      description: user.bio,
      images: [user.avatar],
    },
  };
}
```

## Loading and Error States
```typescript
// app/users/loading.tsx
export default function Loading() {
  return <div>Loading users...</div>;
}

// app/users/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

## Image Optimization

**Primary Rule**: Follow rendering specs from `ui-assets.json` and `ui-spec.json` if available.

```typescript
import Image from 'next/image';

// Use explicit dimensions from design spec
<Image
  src="/profile.jpg"
  alt="Profile"
  width={200}   // from ui-assets.json rendering.width
  height={200}  // from ui-assets.json rendering.height
  priority      // For above-the-fold images
/>

// Fill mode: parent must have explicit size (from design spec containerSize)
<div className="relative w-[300px] h-[200px]">
  <Image src="/card-bg.png" fill alt="Background" className="object-cover" />
</div>

// CSS background for full-section backgrounds (rendering: "css-background")
<div 
  className="w-full h-[400px]"
  style={{ backgroundImage: 'url(/hero-bg.png)', backgroundSize: 'cover' }}
/>
```

### Remote Images
```typescript
// Add domain to next.config.js
images: { domains: ['example.com'] }
```

## Platform Configuration (next.config)

**Principle**: All generated URLs (routes, assets, SSR output) MUST include the correct path prefix for proxy-based deployment.

**Constraint**: `next.config` MUST read base path from `NEXT_PUBLIC_BASE_PATH` environment variable. Default to empty string when absent.

**Constraint**: Image optimization MUST be disabled when base path is set (proxy path breaks internal image fetch).

```typescript
const nextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  images: {
    unoptimized: !!process.env.NEXT_PUBLIC_BASE_PATH,
  },
};
```

## Environment Variables
```typescript
// ✅ Server-side only
const dbUrl = process.env.DATABASE_URL;

// ✅ Client-side (prefix with NEXT_PUBLIC_)
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
```

## Best Practices
- **Use Server Components by default** - only add `'use client'` when needed
- **Fetch data in Server Components** - faster, more secure
- **Use `loading.tsx` and `error.tsx`** for better UX
- **Optimize images** with `next/image`
- **Use TypeScript** for all files
- **Leverage caching** with `revalidate` and `cache` options
- **Keep layouts simple** - shared UI across routes

## Forbidden Patterns
- ❌ Fetching data in Client Components for initial render (use Server Components)
- ❌ Using `getServerSideProps` or `getStaticProps` in App Router (old pattern)
- ❌ Forgetting `'use client'` when using hooks
- ❌ Not using `next/image` for images
- ❌ Exposing secrets in client-side code (no `NEXT_PUBLIC_` for secrets)

## Known Issue: Build Succeeds but Dev Server Fails

**Symptom:**
```
Module parse failed: Unexpected character '@' (2:0)
> @tailwind base;
```

**Cause:** Next.js production build and dev server use different compilation pipelines. PostCSS/Tailwind may work in build but fail in dev hot-reload.

**Resolution:**
1. If `npm run build` PASSES → **Codebase is correct**
2. Dev server issues are framework-specific edge cases, NOT code bugs
3. **DO NOT retry dev server more than once** after successful build
4. **DO NOT spend tokens** trying to fix this - it's not fixable through code changes

**Decision Rule:**
```
✅ Build passes → Task is complete
⚠️ Dev fails after build passes → Acceptable, not blocking
```

This is documented behavior. Do not waste effort debugging dev server when build works.

