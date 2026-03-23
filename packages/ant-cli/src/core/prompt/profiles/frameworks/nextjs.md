# Next.js Framework Profile

## App Router (Next.js 13+)
- **Use App Router** under `src/app/` for new projects
- **Server Components by default** - add `'use client'` only when needed
- **File-based routing** with special files: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`

## Directory Structure

Next.js supports both `app/` and `src/app/`. **Default to `src/app/`** for new projects (per language profile src/ convention).

⚠️ Next.js resolves `app/` OR `src/app/` — not both. Do NOT create both. Internal directory organization under `src/` is determined by the project's architecture requirements.

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

**SVG assets**: Import as React component (SVGR). Webpack rule is configured in Platform Configuration below.

```tsx
import CalendarIcon from '@/assets/icon-calendar.svg';
<CalendarIcon className="h-4 w-4 text-gray-500" />
```

**Raster images** (png, jpg, webp): Use `next/image` with explicit dimensions.

```tsx
import Image from 'next/image';
<Image src="/assets/photo.png" alt="Photo" width={400} height={300} />
```

## Platform Configuration (next.config)

**Constraint**: `next.config` MUST include both the basePath setting and SVGR webpack rule. Omitting either causes proxy routing failure or SVG import errors.

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  webpack(config) {
    // Exclude SVGs from default file-loader so SVGR can handle them
    const fileLoaderRule = config.module.rules.find(
      (rule: any) => rule.test?.test?.('.svg')
    );
    if (fileLoaderRule) fileLoaderRule.exclude = /\.svg$/i;
    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: [{ loader: '@svgr/webpack', options: { typescript: true, dimensions: false } }],
    });
    return config;
  },
};

export default nextConfig;
```

Install `@svgr/webpack` as devDependency. Add type declaration at `src/types/svg.d.ts`:

```typescript
declare module '*.svg' {
  import type { FC, SVGProps } from 'react';
  const SVGComponent: FC<SVGProps<SVGElement>>;
  export default SVGComponent;
}
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
- **Optimize raster images** (png, jpg, webp) with `next/image`; import SVGs as SVGR components
- **Use TypeScript** for all files
- **Leverage caching** with `revalidate` and `cache` options
- **Keep layouts simple** - shared UI across routes

## Forbidden Patterns
- ❌ Using `<Image>` or `<img>` for SVG assets — import SVGs as React components via SVGR
- ❌ Global `images: { unoptimized: true }` in next.config — breaks proxy routing
- ❌ Fetching data in Client Components for initial render
- ❌ Using getServerSideProps or getStaticProps in App Router
- ❌ Forgetting 'use client' when using hooks
- ❌ Exposing secrets in client-side code

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

