================================================================================
FEW-SHOT EXAMPLES
================================================================================

These examples demonstrate how to interpret and respond to directives while following the design document.

────────────────────────────────────────────────────────────────────────────────

Example 1: Simple Directive - Remove Debug Code

**Directive**: "Remove console.log from Button.tsx"

**Response**:
```xml
<edit path="src/components/Button.tsx">
<search>
export function Button() {
  console.log('Button rendered');
  return <button>Click</button>;
}
</search>
<replace>
export function Button() {
  return <button>Click</button>;
}
</replace>
</edit>

<done>true</done>
```

I've removed the console.log statement from Button.tsx as requested.

────────────────────────────────────────────────────────────────────────────────

Example 2: Directive Identifies Problem - Fix Import Error

**Directive**: "Import error, why didn't you check?"

**Context**: File tried to import from wrong path

**Response**:
```xml
<edit path="src/pages/CatalogPage.tsx">
<search>
import { TabMenu } from '@/components/ui/TabMenu';
</search>
<replace>
import { TabMenu } from '@/components/TabMenu';
</replace>
</edit>

<done>true</done>
```

I apologize for not verifying the import path. I should have checked the actual 
file structure before creating the import statement. The TabMenu component is 
located at `@/components/TabMenu`, not in a `ui/` subdirectory. I've corrected 
the import path to match the actual file location.

────────────────────────────────────────────────────────────────────────────────

Example 3: Directive + Design Document - Add Feature with Specific Pattern

**Directive**: "Add error handling to DataDisplay"
**Design Document**: "Use ErrorBoundary pattern for all data-fetching components"

**Response**:
```xml
<edit path="src/components/DataDisplay.tsx">
<search>
import { useEffect, useState } from 'react';

export function DataDisplay() {
  const [data, setData] = useState(null);
</search>
<replace>
import { useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function DataDisplay() {
  const [data, setData] = useState(null);
</replace>
</edit>

<edit path="src/components/DataDisplay.tsx">
<search>
  return (
    <div className="data-display">
      {data ? <Content data={data} /> : <Loading />}
    </div>
  );
}
</search>
<replace>
  return (
    <ErrorBoundary fallback={<ErrorMessage />}>
      <div className="data-display">
        {data ? <Content data={data} /> : <Loading />}
      </div>
    </ErrorBoundary>
  );
}
</replace>
</edit>

<done>true</done>
```

I've added error handling following the ErrorBoundary pattern specified in the 
design document. The ErrorBoundary wraps the data display component and will 
catch any rendering errors, showing the ErrorMessage fallback UI.

────────────────────────────────────────────────────────────────────────────────

Example 4: Feedback Statement - Apply Constraint

**Directive**: "Don't use inline styles, use Tailwind classes"
**Context**: Previous implementation used inline `style=\{{...\}}`

**Response**:
```xml
<edit path="src/components/Card.tsx">
<search>
export function Card(\{ children \}: \{ children: React.ReactNode \}) \{
  return (
    <div style=\{\{ padding: '16px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' \}\}>
      \{children\}
    </div>
  );
\}
</search>
<replace>
export function Card(\{ children \}: \{ children: React.ReactNode \}) \{
  return (
    <div className="p-4 rounded-lg shadow-sm">
      \{children\}
    </div>
  );
\}
</replace>
</edit>

<done>true</done>
```

You're right, I should use Tailwind utility classes instead of inline styles. 
I've replaced the inline style object with equivalent Tailwind classes: 
`p-4` (padding), `rounded-lg` (border-radius), and `shadow-sm` (box-shadow).

────────────────────────────────────────────────────────────────────────────────

KEY PRINCIPLES DEMONSTRATED:

1. **Directive Priority**: Always address what the directive asks for first
2. **Design Document**: Follow architectural patterns specified in design
3. **Acknowledge + Fix**: When directive points out error, explain AND fix it
4. **Minimal Changes**: Only modify what's necessary for the task
5. **Complete Context**: Include enough surrounding code in <search> blocks

────────────────────────────────────────────────────────────────────────────────

For detailed XML tag syntax and output format rules, see execute/rules.md
