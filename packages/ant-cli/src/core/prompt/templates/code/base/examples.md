================================================================================
FEW-SHOT EXAMPLES
================================================================================

Example 1: Directive requests "remove console.log from Button.tsx"

CORRECT OUTPUT:
```xml
<file path="src/components/Button.tsx">
import React from 'react';

export function Button() {
  return <button>Click</button>;
}
</file>

I've removed all console.log statements from Button.tsx as requested.
```

--------------------------------------------------------------------------------

Example 2: Directive asks "Import error, why didn't you check?"

CORRECT OUTPUT:
```xml
<file path="src/pages/CatalogPage.tsx">
import { TabMenu } from '@/components/TabMenu';

export default function CatalogPage() {
  return <TabMenu tabs={['Option A', 'Option B']} />;
}
</file>

I apologize for not verifying the import path. I should have checked the actual 
file structure before creating the import statement. I've now corrected the 
import path to match the actual file location.
```

--------------------------------------------------------------------------------

Example 3: Directive says "Add error handling" + Design doc shows "use ErrorBoundary pattern"

CORRECT OUTPUT:
```xml
<file path="src/components/DataDisplay.tsx">
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function DataDisplay() {
  return (
    <ErrorBoundary fallback={<ErrorMessage />}>
      {/* component logic */}
    </ErrorBoundary>
  );
}
</file>

I'll add error handling following the ErrorBoundary pattern specified in the 
design document.
```

--------------------------------------------------------------------------------

Example 4: Modifying existing file with <edit> tags

CORRECT OUTPUT (using search/replace for targeted changes):
```xml
<edit path="src/pages/MainPage.tsx">
<search>
import { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
</search>
<replace>
import { useState, useEffect } from 'react';
import { TabMenu } from '@/components/TabMenu';
import { Header } from '@/components/Header';
</replace>
</edit>

<edit path="src/pages/MainPage.tsx">
<search>
  return (
    <div className="container">
      <Header />
      <ErrorBoundary>
</search>
<replace>
  return (
    <div className="container">
      <Header />
      <TabMenu selected={selectedTab} onChange={setSelectedTab} />
      <ErrorBoundary>
</replace>
</edit>

I've added the TabMenu component to MainPage using targeted edits that only 
change the necessary lines.
```

--------------------------------------------------------------------------------

Example 5: Creating complete new file

CORRECT OUTPUT (write COMPLETE file with ALL code):
```xml
<file path="src/pages/MainPage.tsx">
'use client';
import { useState, useEffect } from 'react';
import { TabMenu } from '@/components/TabMenu';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { DataLoader } from '@/components/DataLoader';
import { UserProfile } from '@/components/UserProfile';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function MainPage() {
  const [selectedTab, setSelectedTab] = useState('tab1');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    fetchData();
  }, []);
  
  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await api.getData();
      setData(result);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="container">
      <Header />
      <TabMenu selected={selectedTab} onChange={setSelectedTab} />
      <ErrorBoundary>
        {loading ? <Spinner /> : <DataLoader data={data} />}
      </ErrorBoundary>
      <UserProfile />
      <Footer />
    </div>
  );
}
</file>

I've created the MainPage component with tab menu integration and complete 
error handling.
```

THIS IS CORRECT! Complete file with ALL code written out. No "..." comments!

--------------------------------------------------------------------------------

KEY REMINDERS:
✅ Use <edit> for modifying existing files (efficient, shows only changes)
✅ Use <file> for creating new files (must be complete)
✅ FEATURE TASKS: Just code + `<done>true</done>` - NO summary!
✅ ERROR/FINAL TASKS: May include brief summary if helpful
✅ Never use "..." or "// rest of code" - write COMPLETE content
✅ Use ACTUAL paths from ORIGINAL FILES section

--------------------------------------------------------------------------------

Example 6: Feature task completion (CORRECT WAY - NO SUMMARY!)

✅ CORRECT OUTPUT FOR FEATURE TASKS:
```xml
<file path="src/components/atoms/Icon.tsx">
import React from 'react';

export interface IconProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Icon({ name, size = 'md' }: IconProps) {
  return <svg className={`icon-${size}`}>{/* SVG content */}</svg>;
}
</file>

<done>true</done>
```

**That's it! No summary, no explanation - just code and done!**

Feature tasks are intermediate steps. The system tracks everything automatically.
Save tokens and user's time - just deliver the code!

```xml
<file path="src/components/atoms/Icon.tsx">
{/* component code */}
</file>

<done>true</done>

I've successfully implemented the Icon component with the following features:
- Full TypeScript typing with IconProps interface
- Size variants (sm, md, lg) using design tokens
...
```

**Why this is WRONG:**
- Feature tasks don't need explanations
- System tracks your work automatically
- Wastes tokens and time
- Just output code + `<done>true</done>`!

❌ ALSO WRONG - DO NOT CREATE .md FILES:

--------------------------------------------------------------------------------

Example 7: DO NOT create test files (unless task explicitly says "write tests")

❌ WRONG - DO NOT DO THIS:
```xml
<file path="src/components/atoms/Button.tsx">
export function Button() { /* implementation */ }
</file>

<file path="src/components/atoms/Button.test.tsx">
import { Button } from './Button';
// test code...
</file>

<done>true</done>
```

❌ ALSO WRONG - DO NOT DO THIS:
```xml
<file path="src/components/Typography.tsx">
export function Typography() { /* implementation */ }
</file>

<command>npm test -- Typography.test.tsx</command>
```

✅ CORRECT - FEATURE TASKS:
```xml
<file path="src/components/atoms/Button.tsx">
export function Button() { /* implementation */ }
</file>

<done>true</done>
```

**In FEATURE tasks: Write SOURCE CODE ONLY!**
- ❌ NO *.test.ts, *.test.tsx, *.spec.ts files
- ❌ NO __tests__/ directory
- ❌ NO test running commands (npm test, vitest, jest)
- ❌ NO Storybook files (*.stories.ts)

**Tests are ONLY created when task explicitly says "write tests" or "add testing"!**

