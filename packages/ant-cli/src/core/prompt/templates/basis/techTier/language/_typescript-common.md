# TypeScript Language Profile

## Source Root Convention

**Default**: Application source files go under `src/`. Configuration files (`package.json`, `tsconfig.json`, `*.config.*`, `.env`) remain at the project root. In monorepo packages, each package follows the same convention: `packages/{name}/src/`.

**Note**: Architectural patterns like FSD (Feature-Sliced Design) do NOT conflict with `src/` — place FSD layers (`app/`, `entities/`, `features/`, `shared/`, `widgets/`, `pages/`) inside `src/`. Design documents describe boundary separation, not source root placement — do NOT let design document directory mentions override this convention.

**Existing projects (modify mode)**: Observe where existing source files live. If the project already uses a root-level layout without `src/`, follow the established pattern.

**Constraint**: Do NOT mix layouts. If `src/` is used, ALL source directories belong under `src/`. Creating both `app/` and `src/app/` produces dead code.

## File Naming Conventions
- **kebab-case** for all source files: `user-profile.tsx`, `api-client.ts`, `use-auth.ts`
- **Framework-required exceptions**: Files mandated by frameworks keep their required names (`App.tsx`, `page.tsx`, `layout.tsx`)
- **Test files**: Match source file name with `.test` or `.spec` suffix: `user-profile.test.ts`

## Type Safety Rules
- **Always use explicit return types** for functions
- **Prefer `interface`** for object shapes and contracts
- **Use `type`** for unions, intersections, and mapped types
- **Avoid `any`** - use `unknown` if type is truly unknown, then narrow it
- **Enable strict mode** - assume `strict: true` in tsconfig.json
- **Use const assertions** for literal types when needed

## Naming Conventions
- **PascalCase**: Types, Interfaces, Classes, Enums
  - `User`, `UserProfile`, `HttpClient`
- **camelCase**: Variables, Functions, Methods, Properties
  - `userName`, `fetchData`, `isActive`
- **UPPER_SNAKE_CASE**: Constants and Enum values
  - `MAX_RETRY_COUNT`, `API_BASE_URL`
- **Prefix interfaces with `I` only if necessary** (modern convention: no prefix)

## Import Organization
```typescript
// 1. External dependencies (third-party libraries)
import React from 'react';
import { useState } from 'react';

// 2. Internal absolute imports (@/ aliases)
import { Button } from '@/components/ui';
import { useAuth } from '@/hooks';

// 3. Relative imports (same module)
import { helper } from './utils';

// 4. Type imports (separate for clarity)
import type { User } from '@/types';
```

## Best Practices
- **Prefer `const` over `let`** - immutability by default
- **Use optional chaining** (`?.`) for safe property access
- **Use nullish coalescing** (`??`) instead of `||` for default values
- **Destructure with default values** for function parameters
- **Use template literals** instead of string concatenation
- **Leverage type guards** for narrowing unions
- **Prefer async/await** over raw promises for readability

## Forbidden Patterns
- ❌ `any` without justification
- ❌ Type assertion without validation (`as` casting blindly)
- ❌ Non-null assertion (`!`) without checking
- ❌ `var` keyword (use `const` or `let`)
- ❌ Implicit `any` in function parameters

## Error Handling
```typescript
// ✅ Good: Explicit error types
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch user: ${error.message}`);
    }
    throw error;
  }
}
```

## Null/Undefined Handling
- **Prefer `undefined` over `null`** for optional values
- **Use `??` for default values**: `value ?? defaultValue`
- **Use `?.` for optional chaining**: `user?.profile?.name`
- **Be explicit in function signatures**: `name?: string` not `name: string | undefined`
