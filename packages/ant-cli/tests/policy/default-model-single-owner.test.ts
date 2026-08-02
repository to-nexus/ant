/**
 * Default-model single-owner sweep.
 *
 * `core/config/defaultModels.ts` is the only module allowed to read the model
 * selection env vars, and the only place the job × node default table is written.
 * Both rules exist because the same table used to be hand-copied across five
 * surfaces (creation snapshot, load-time merge base, config heal map, config-missing
 * fallback, FE seed) and the `commit` slot reached only two of them — the picker
 * rendered a blank chip while the runtime quietly used a different model.
 *
 * `AI_MODEL_NAME` / `MODEL_NAME` were a blunt all-slots override that flattened the
 * per-node assignments; both are REMOVED, and the sweep below keeps them from
 * returning. Provider API keys (`ANTHROPIC_API_KEY` &co) are a different concern,
 * owned by `PROVIDER_API_KEY_ENV`, and are not in scope here.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_MODELS } from '@ant/shared';
import {
  FALLBACK_BINDING,
  FALLBACK_ENV_VAR,
  listBindingEnvVars,
  listDefaultBindings,
} from '../../src/core/config/defaultModels';

const cliRoot = path.resolve(__dirname, '../..');
const OWNER = 'src/core/config/defaultModels.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Strip comments so a documentation mention is not read as a code reference.
 * Trailing `//` comments count too — `model?: string; // e.g. "claude-opus-5"` is
 * prose. `://` is preserved so URLs survive.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const sourceFiles = walk(path.join(cliRoot, 'src'));

describe('default-model single owner', () => {
  it('the owner module exists', () => {
    expect(fs.existsSync(path.join(cliRoot, OWNER))).toBe(true);
  });

  it('the removed AI_MODEL_NAME / MODEL_NAME override is not read anywhere', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = path.relative(cliRoot, file);
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (/process\.env\.(AI_MODEL_NAME|MODEL_NAME)\b/.test(src)) offenders.push(rel);
      if (/process\.env\[\s*['"](AI_MODEL_NAME|MODEL_NAME)['"]\s*\]/.test(src)) offenders.push(rel);
    }
    expect(offenders, 'a blunt all-slots model override came back').toEqual([]);
  });

  it('the env examples do not advertise the removed override', () => {
    for (const file of ['.env.example.local', '.env.example.cloud']) {
      const text = fs.readFileSync(path.join(cliRoot, file), 'utf8');
      expect(text, `${file}`).not.toMatch(/^#?\s*(AI_MODEL_NAME|MODEL_NAME)=/m);
    }
  });

  it('no module except the owner reads ANT_DEFAULT_MODEL_*', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = path.relative(cliRoot, file);
      if (rel === OWNER) continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (/ANT_DEFAULT_MODEL_/.test(src)) offenders.push(rel);
    }
    expect(offenders, `read a binding var outside ${OWNER}`).toEqual([]);
  });

  it('the env examples document exactly the binding vars the code derives', () => {
    // Env var names are derived from the binding table, so a new slot appears in
    // code with no doc edit. This row catches the reverse drift: an example file
    // advertising a name nothing reads, or omitting one that exists.
    const declared = new Set(listBindingEnvVars());
    for (const file of ['.env.example.local', '.env.example.cloud']) {
      const text = fs.readFileSync(path.join(cliRoot, file), 'utf8');
      const documented = new Set(text.match(/ANT_DEFAULT_MODEL_[A-Z_]+/g) ?? []);
      expect([...documented].filter((v) => !declared.has(v)), `${file}: documents unknown var`).toEqual([]);
      expect([...declared].filter((v) => !documented.has(v)), `${file}: missing var`).toEqual([]);
    }
  });

  it('every binding value shown in the examples is a resolvable provider:tier', () => {
    for (const file of ['.env.example.local', '.env.example.cloud']) {
      const text = fs.readFileSync(path.join(cliRoot, file), 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^#?\s*(ANT_DEFAULT_MODEL_[A-Z_]+)=(.+)$/);
        if (!m) continue;
        const [provider, tier] = m[2].trim().split(':');
        expect(
          DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS]?.[tier],
          `${file}: ${m[1]}=${m[2]} does not resolve`,
        ).toBeDefined();
      }
    }
  });

  it('every binding value shown in the examples equals its built-in', () => {
    // The examples are commented out and captioned "Leave commented to use the
    // built-ins shown", so each line doubles as documentation of the code default.
    // `ANT_DEFAULT_MODEL_FALLBACK` drifted (shown sonnet, bound opus) precisely
    // because the row above only checks that a value resolves, not that it matches.
    const builtin = new Map<string, string>([
      [FALLBACK_ENV_VAR, FALLBACK_BINDING],
      ...listDefaultBindings().map(({ envVar, ref }) => [envVar, ref] as [string, string]),
    ]);
    for (const file of ['.env.example.local', '.env.example.cloud']) {
      const text = fs.readFileSync(path.join(cliRoot, file), 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^#?\s*(ANT_DEFAULT_MODEL_[A-Z_]+)=(.+)$/);
        if (!m) continue;
        expect(m[2].trim(), `${file}: ${m[1]} shown as a non-built-in value`).toBe(builtin.get(m[1]));
      }
    }
  });

  it('no module outside @ant/shared hardcodes a concrete model id', () => {
    // Model ids belong to MODEL_REGISTRY; a literal anywhere else is a default
    // table growing a sixth copy. `defaultModels.ts` itself names only abstract
    // `provider:tier` refs, so it is held to the same rule.
    const idPattern = /['"](claude-(?:opus|sonnet|haiku)-[\w.-]+|gpt-5[\w.-]*|gemini-3[\w.-]*|deepseek-v\d[\w.-]*|glm-\d[\w.-]*|kimi-k\d[\w.-]*)['"]/;
    const offenders: { file: string; id: string }[] = [];
    for (const file of sourceFiles) {
      const rel = path.relative(cliRoot, file);
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      const m = src.match(idPattern);
      if (m) offenders.push({ file: rel, id: m[1] });
    }
    expect(offenders).toEqual([]);
  });
});
