<thinking>
Apply the devDependencies-only change. Because decideInvalidationScope is
diff-aware (F2), this write emits `verificationInvalidated { scope: 'test' }`,
which preserves typecheckPassed/buildPassed on the tracker. When reverify
enters the plan node, F1's *Passed guard blocks a tsc re-run with ALREADY PASSED.
</thinking>

<file path="codebase/package.json">
{
  "name": "s10",
  "version": "1.0.0",
  "dependencies": { "react": "^18.0.0" },
  "devDependencies": { "vitest": "^1.0.0", "jsdom": "^26.0.0" },
  "scripts": { "build": "tsc", "test": "vitest run" }
}
</file>
<done>true</done>
