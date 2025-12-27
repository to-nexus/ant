# Development Server Configuration (Ant Platform)

**CRITICAL REQUIREMENT FOR FRONTEND PROJECTS:**

When implementing a frontend application (React, Vue, Svelte, etc.) that will be served through the Ant platform's development server proxy, you MUST configure the router to support dynamic basename.

## Why This Is Required

The Ant platform serves development servers through a proxy URL like:
```
/dev/{tenantId}:{userId}:{projectId}:{feature}/
```

Without proper basename configuration, client-side routing will fail because the router won't be aware of the proxy prefix.

## Implementation Requirements

### For React Projects (React Router v6+)

1. **Add Window Type Declaration** (typically in `App.tsx` or a separate `global.d.ts`):

```typescript
// Type declaration for proxy injected basename
declare global {
  interface Window {
    __BASENAME__?: string;
  }
}
```

2. **Configure BrowserRouter with basename**:

```tsx
import { BrowserRouter } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter basename={window.__BASENAME__ || ''}>
      {/* Your app routes */}
    </BrowserRouter>
  );
}
```

### For Vue Projects (Vue Router 4+)

```typescript
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory((window as any).__BASENAME__ || '/'),
  routes: [
    // your routes
  ]
});
```

### For Svelte Projects (SvelteKit)

```typescript
// svelte.config.js
export default {
  kit: {
    paths: {
      base: process.env.BASE_PATH || ''
    }
  }
};
```

## What Happens Behind the Scenes

When the development server starts:
1. The Ant platform proxy intercepts the HTML response
2. It injects `<script>window.__BASENAME__ = "/dev/...";</script>` into the `<head>`
3. Your router reads this value and adjusts all navigation accordingly

## Verification

After implementing this, you can verify it works by:
1. Starting the development server from the Ant UI
2. Clicking the "Open" button
3. Verifying that navigation works correctly in the proxied environment

## When to Skip

You can skip this configuration if:
- Building a pure backend API (no frontend routing)
- Building a static site without client-side routing
- Using a meta-framework that handles this automatically (e.g., Next.js with basePath)

**Remember**: This is a platform requirement, not a project-specific configuration. All frontend projects on the Ant platform need this setup for development server access to work correctly.

