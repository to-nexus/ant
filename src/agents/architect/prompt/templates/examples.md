================================================================================
FEW-SHOT EXAMPLES
================================================================================

Example 1: Directive requests "remove console.log from Button.tsx"

CORRECT OUTPUT:
=== RESPONSE ===
I've removed all console.log statements from Button.tsx as requested.
=== END RESPONSE ===

=== FILE: src/components/Button.tsx ===
import React from 'react';

export function Button() {
  return <button>Click</button>;
}
=== END FILE ===

--------------------------------------------------------------------------------

Example 2: Directive asks "Import error, why didn't you check?"

CORRECT OUTPUT:
=== RESPONSE ===
I apologize for not verifying the import path. I should have checked the actual file structure before creating the import statement. I've now corrected the import path to match the actual file location.
=== END RESPONSE ===

=== FILE: src/pages/CatalogPage.tsx ===
import { TabMenu } from '@/components/TabMenu';

export default function CatalogPage() {
  return <TabMenu tabs={['Option A', 'Option B']} />;
}
=== END FILE ===

--------------------------------------------------------------------------------

Example 3: Directive says "Add error handling" + Design doc shows "use ErrorBoundary pattern"

CORRECT OUTPUT:
=== RESPONSE ===
I'll add error handling following the ErrorBoundary pattern specified in the design document.
=== END RESPONSE ===

=== FILE: src/components/DataDisplay.tsx ===
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function DataDisplay() {
  return (
    <ErrorBoundary fallback={<ErrorMessage />}>
      {/* component logic */}
    </ErrorBoundary>
  );
}
=== END FILE ===

--------------------------------------------------------------------------------

Example 4: Directive says "Don't delete existing comments"

CORRECT OUTPUT:
=== RESPONSE ===
Understood. I will preserve all existing comments that are not directly related to the code changes. Going forward, I will only modify or remove comments when they describe code that I'm changing.
=== END RESPONSE ===

[Then output files with comments preserved]

--------------------------------------------------------------------------------

Example 5: Modifying existing file to add tab menu

WRONG OUTPUT (using "..." comments to skip code):
=== FILE: src/pages/MainPage.tsx ===
'use client';
import { useState, useEffect } from 'react';
import { TabMenu } from '@/components/TabMenu';
// ... all other imports ...

export default function MainPage() {
  const [selectedTab, setSelectedTab] = useState('tab1');
  // ... all other state ...
  return (<div>...</div>);
}
=== END FILE ===
THIS IS WRONG! You're skipping code with "..." comments!

CORRECT OUTPUT (write COMPLETE file with ALL code):
=== FILE: src/pages/MainPage.tsx ===
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
=== END FILE ===
THIS IS CORRECT! Complete file with ALL code written out.

