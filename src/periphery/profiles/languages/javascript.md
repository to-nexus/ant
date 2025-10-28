# JavaScript Language Profile

## Modern JavaScript (ES6+)
- **Use `const` by default**, `let` when reassignment needed
- **Never use `var`** - block scoping is essential
- **Use arrow functions** for callbacks and short functions
- **Use template literals** for string interpolation
- **Use destructuring** for objects and arrays
- **Use spread operator** for copying and merging

## Naming Conventions
- **camelCase**: Variables, Functions
  - `userName`, `fetchData`, `isActive`
- **PascalCase**: Classes, Constructors
  - `User`, `HttpClient`, `EventEmitter`
- **UPPER_SNAKE_CASE**: Constants
  - `MAX_RETRY_COUNT`, `API_BASE_URL`

## Import/Export Style
```javascript
// ES Modules (preferred)
import { useState } from 'react';
import utils from './utils';
export const helper = () => {};
export default MyComponent;

// Avoid CommonJS unless necessary
// const React = require('react');  ❌
```

## Best Practices
- **Use async/await** instead of promise chains
- **Use optional chaining** (`?.`) for safe access
- **Use nullish coalescing** (`??`) for defaults
- **Prefer immutable operations** (map, filter, reduce over forEach with mutations)
- **Use Array methods** over traditional for loops
- **Handle errors explicitly** with try/catch

## Code Structure
```javascript
// ✅ Good: Clear, modern JavaScript
const fetchUsers = async () => {
  try {
    const response = await fetch('/api/users');
    const data = await response.json();
    return data.filter(user => user.isActive);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return [];
  }
};
```

## Forbidden Patterns
- ❌ `var` keyword
- ❌ Callback hell (use async/await)
- ❌ Mutating function parameters
- ❌ Global variables
- ❌ `==` instead of `===`

## Object/Array Operations
```javascript
// ✅ Immutable operations
const updated = { ...original, name: 'New' };
const filtered = items.filter(item => item.active);
const mapped = items.map(item => ({ ...item, processed: true }));

// ❌ Avoid mutations
original.name = 'New';  // Mutates original
items.forEach(item => item.processed = true);  // Mutates array
```

## Error Handling
```javascript
// ✅ Good: Explicit error handling
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Fetch error:', error.message);
    throw error;
  }
}
```

