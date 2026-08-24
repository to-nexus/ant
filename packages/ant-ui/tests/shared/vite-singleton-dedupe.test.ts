/**
 * The @ant/cloud overlay's FE source is compiled into THIS Vite graph through the
 * `@cloud` alias, but its bare imports resolve from the overlay package's own
 * node_modules — a different pnpm peer-hash directory. Libraries that keep a
 * module-level singleton then exist twice in one bundle.
 *
 * That is not theoretical: react-i18next stores its i18next instance in a module
 * global set by `initReactI18next`. With a second copy, `useTranslation` in every
 * overlay component fell through to `notReadyT`, which returns the raw
 * defaultValue — the billing UI rendered `Pay {{amount}}` / `{{n}} credits / mo`
 * and stayed English whatever the selected language was.
 *
 * @vitejs/plugin-react contributes `dedupe: ['react', 'react-dom']` on its own,
 * which is exactly why hooks kept working while translations did not. This locks
 * the rest of the list.
 */

import { describe, it, expect } from 'vitest';
import viteConfig from '../../vite.config';

/** Every package whose module identity must be shared with the overlay. */
const HOST_SINGLETONS = ['react', 'react-dom', 'react-i18next', 'i18next', 'zustand'] as const;

const resolved = (viteConfig as any)({ mode: 'production', command: 'build' });
const dedupe: string[] = resolved.resolve?.dedupe ?? [];

describe('vite resolve.dedupe covers the host singletons', () => {
  it.each(HOST_SINGLETONS)('%s is deduped', (name) => {
    expect(dedupe).toContain(name);
  });
});
