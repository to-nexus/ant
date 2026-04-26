/**
 * SSOT D27 enforcement — the only public predicate that knows the tier ×
 * domain × runtime matrix is `isTierActive` in `@ant/shared`. Per
 * `.cursorrules` Tier Matrix SSOT section, FE callers are expected to
 * funnel through:
 *
 *   - `useActiveTiers(slot)` (React hook surface — wizard, summary,
 *     ActionConfigView Section gating, ActionsPanel basis-edit guard)
 *   - `listActiveTiers(slot, domain, runtime)` (pure helper — used by
 *     `decideActionsStepAfterIntent` inside `useActiveTiers.ts`)
 *
 * Any direct `isTierActive(...)` call elsewhere reintroduces the
 * fragmentation the facade was created to eliminate. This test walks
 * every `.ts` / `.tsx` source file under `packages/ant-ui/src/` and
 * asserts the call is absent (after stripping comments). Documentation
 * mentions inside comments are still allowed.
 */

import { describe, it, expect } from 'vitest';

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (avoid eating URLs like https://)
}

describe('Tier Matrix SSOT — `isTierActive` call-site budget (D27)', () => {
  it('no direct isTierActive() call anywhere under packages/ant-ui/src', () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      // Exclude this file itself — it intentionally references the
      // pattern by name in copy strings.
      if (path.endsWith('/tier-matrix-callsite.test.ts')) continue;
      const stripped = stripComments(content);
      if (/\bisTierActive\s*\(/.test(stripped)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('listActiveTiers / useActiveTiers facades exist and are referenced', () => {
    const all = Object.values(sources).join('\n');
    expect(all).toMatch(/listActiveTiers\s*\(/);
    expect(all).toMatch(/useActiveTiers\s*\(/);
  });
});
