/**
 * Settings width measures have ONE owner.
 *
 * Hard pixel `maxWidth` values scattered across the settings kit are why
 * content wrapped far short of its container, and why a single screen ended up
 * with three different prose columns (560 / 480 / 380). Every max-width must
 * come from `ConfigEditor/aurora/measures.ts`, whose values are `min(100%, …)`
 * and therefore both grow and shrink with the box.
 *
 * This is a STRUCTURAL check, not prose pinning: it asserts where a value
 * comes from, never what any string says. Fixed `width:` is out of scope —
 * icon boxes and column-aligning cells legitimately use it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = [
  'src/presentation/components/AgentSettings',
  'src/presentation/components/ConfigEditor/aurora',
];
const PKG = join(__dirname, '..', '..');
/** The module that is allowed to state a raw measure. */
const OWNER = 'measures.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && entry !== OWNER) out.push(full);
  }
  return out;
}

/** `maxWidth: 420` / `maxWidth:420` — a bare numeric literal, not an identifier. */
const BARE_MAX_WIDTH = /maxWidth:\s*\d/g;
/** The Tailwind equivalent, e.g. `max-w-[420px]`. */
const ARBITRARY_MAX_W = /max-w-\[/g;

describe('settings width measures', () => {
  it('no bare numeric maxWidth outside measures.ts', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(PKG, root))) {
        const text = readFileSync(file, 'utf8');
        const hits = [...text.matchAll(BARE_MAX_WIDTH), ...text.matchAll(ARBITRARY_MAX_W)];
        if (hits.length > 0) {
          offenders.push(`${relative(PKG, file)} (${hits.length}): ${hits.map((h) => h[0]).join(', ')}`);
        }
      }
    }
    expect(
      offenders,
      `Use PROSE_MEASURE / CONTROL_MEASURE / FIELD_MEASURE from ConfigEditor/aurora/measures.ts:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every exported measure is container-relative, so it can never overflow', async () => {
    const measures = await import('../../src/presentation/components/ConfigEditor/aurora/measures');
    for (const name of ['PROSE_MEASURE', 'CONTROL_MEASURE', 'FIELD_MEASURE'] as const) {
      expect(measures[name], name).toMatch(/^min\(100%,/);
    }
  });
});
