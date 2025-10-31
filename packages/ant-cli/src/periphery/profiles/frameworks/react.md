# React Framework Profile

## Component Structure
```typescript
// Preferred order:
// 1. Imports
// 2. Type definitions
// 3. Component
// 4. Exports

import React, { useState, useEffect } from 'react';
import type { User } from '@/types';

interface UserProfileProps {
  userId: string;
  onUpdate?: (user: User) => void;
}

export function UserProfile({ userId, onUpdate }: UserProfileProps) {
  // Component logic
}
```

## Component Best Practices
- **Use function components** (not class components)
- **Keep components < 200 lines** - split if larger
- **One component per file** (except small, tightly-coupled components)
- **Export by name, not default** for better refactoring
- **Use TypeScript for props** - always define prop types

## Hooks Rules
- **Call hooks at top level** - never in conditions or loops
- **Use custom hooks** to extract reusable logic
- **useState**: Local component state
- **useEffect**: Side effects and subscriptions
- **useMemo**: Expensive computations
- **useCallback**: Memoized callbacks (for child optimization)
- **useContext**: Shared state across tree
- **useRef**: DOM refs or mutable values

```typescript
// ✅ Good: Custom hook for reusable logic
function useUser(userId: string) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    let cancelled = false;
    
    async function fetchUser() {
      try {
        const data = await api.getUser(userId);
        if (!cancelled) {
          setUser(data);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    
    fetchUser();
    return () => { cancelled = true; };
  }, [userId]);
  
  return { user, loading };
}
```

## State Management
```typescript
// ✅ Local state for simple cases
const [count, setCount] = useState(0);

// ✅ Context for shared state across components
const ThemeContext = createContext<Theme | null>(null);

// ✅ Reducer for complex state logic
const [state, dispatch] = useReducer(reducer, initialState);

// ✅ External state library for large apps (Zustand, Jotai, Redux)
```

## Event Handlers
```typescript
// ✅ Good: Type-safe event handlers
function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  // Handle click
}

function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
  setValue(event.target.value);
}

// ✅ Good: Inline handlers for simple cases
<button onClick={() => setCount(c => c + 1)}>Increment</button>

// ✅ Good: Named handlers for complex logic
<button onClick={handleSubmit}>Submit</button>
```

## Conditional Rendering
```typescript
// ✅ Good: Short-circuit for simple conditions
{isLoading && <Spinner />}
{error && <ErrorMessage error={error} />}

// ✅ Good: Ternary for if-else
{isLoggedIn ? <Dashboard /> : <Login />}

// ✅ Good: Early return for complex conditions
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
return <Content />;
```

## Lists and Keys
```typescript
// ✅ Good: Stable, unique keys
{users.map(user => (
  <UserCard key={user.id} user={user} />
))}

// ❌ Bad: Index as key (causes bugs on reorder/filter)
{users.map((user, index) => (
  <UserCard key={index} user={user} />
))}
```

## Performance Optimization
- **React.memo**: Prevent re-renders for unchanged props
- **useMemo**: Cache expensive computations
- **useCallback**: Memoize callbacks passed to children
- **Code splitting**: Use `React.lazy` and `Suspense`
- **Virtualization**: Use `react-window` for large lists

```typescript
// ✅ Memoize component
export const UserCard = React.memo(function UserCard({ user }: Props) {
  return <div>{user.name}</div>;
});

// ✅ Memoize expensive computation
const sortedUsers = useMemo(
  () => users.sort((a, b) => a.name.localeCompare(b.name)),
  [users]
);

// ✅ Memoize callback
const handleClick = useCallback(
  () => onUserSelect(userId),
  [userId, onUserSelect]
);
```

## Forms
```typescript
// ✅ Controlled components
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(email, password);
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <button type="submit">Login</button>
    </form>
  );
}
```

## Forbidden Patterns
- ❌ Class components (use functions)
- ❌ Directly mutating state (`state.value = x`)
- ❌ Index as key in lists
- ❌ Hooks in conditions or loops
- ❌ Missing dependencies in useEffect/useMemo/useCallback
- ❌ Forgetting cleanup in useEffect
- ❌ Props drilling (use Context or state management)

